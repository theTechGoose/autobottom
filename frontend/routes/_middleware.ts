/** Auth middleware — resolves user from session cookie via direct in-process authenticate().
 *  Does NOT make HTTP self-requests — Deno Deploy isolates can't fetch their own localhost. */
import { define } from "../lib/define.ts";
import { isPublicPath, roleRedirect } from "../lib/auth.ts";
import { authenticate } from "@core/business/auth/mod.ts";
import { listUsers } from "@core/business/auth/mod.ts";

/** Build a redirect that's safe for both browser navigation and HTMX swaps.
 *  Without this, an HTMX widget XHR receiving a 302 to /login follows the
 *  redirect, gets 200 + login HTML, and HTMX cheerfully swaps that login
 *  page into the widget's target div. The fix is the HX-Redirect header,
 *  which tells HTMX to do a full-page navigation instead of a swap. */
function authRedirect(req: Request, location: string): Response {
  const isHtmx = req.headers.get("hx-request") === "true";
  if (isHtmx) {
    return new Response(null, { status: 401, headers: { "hx-redirect": location } });
  }
  return new Response(null, { status: 302, headers: { location } });
}

export default define.middleware(async (ctx) => {
  const url = new URL(ctx.req.url);
  const path = url.pathname;

  // Static files pass through
  if (path.startsWith("/static") || path === "/favicon.svg" || path.startsWith("/_fresh")) {
    return ctx.next();
  }

  // Public paths pass through
  if (isPublicPath(path)) {
    console.log(`[MIDDLEWARE] ${path} — public, pass through`);
    return ctx.next();
  }

  // Authenticate directly in-process — no HTTP self-request.
  // CRITICAL: only the authenticate() call is wrapped in try/catch. Handler errors from
  // ctx.next() must propagate as-is — if we catch them here they get misinterpreted as
  // auth failures and we redirect to /login (confusing to debug). See tests/e2e/modal-endpoints.test.ts.
  let auth: Awaited<ReturnType<typeof authenticate>> = null;
  try {
    auth = await authenticate(ctx.req);
  } catch (e) {
    console.error(`[MIDDLEWARE] ${path} — auth error:`, e);
  }

  if (auth?.email && auth?.role) {
    ctx.state.user = {
      email: auth.email,
      orgId: auth.orgId,
      role: auth.role as "admin" | "judge" | "manager" | "reviewer" | "user",
    };

    // /super-admin/* is gated to a single email. Super Admin bypasses the org
    // impersonation swap below because we want the REAL user's view.
    if (path.startsWith("/super-admin")) {
      if (auth.email !== "ai@monsterrg.com") {
        return authRedirect(ctx.req, "/admin/dashboard");
      }
      return ctx.next();
    }

    // Admin impersonation via ?as=<email> — swap ctx.state.user for the target
    // so the downstream page renders as that user, and stash the real admin
    // email for the golden banner.
    const asEmail = url.searchParams.get("as");
    if (asEmail && auth.role === "admin" && asEmail !== auth.email) {
      try {
        const users = await listUsers(auth.orgId);
        const target = users.find((u) => u.email === asEmail);
        if (target) {
          ctx.state.impersonatedBy = auth.email;
          ctx.state.user = {
            email: target.email,
            orgId: auth.orgId,
            role: target.role as "admin" | "judge" | "manager" | "reviewer" | "user",
          };
        }
      } catch (e) {
        console.error(`[MIDDLEWARE] impersonation lookup failed:`, e);
      }
    }

    // /admin/* and /api/admin/* are gated to real admins. Use the REAL role
    // (auth.role, captured via impersonatedBy) so an admin impersonating a
    // manager can still access admin tools — ctx.state.user.role here may
    // be "manager" because of the impersonation swap above.
    const isAdminPath = path.startsWith("/admin") || path.startsWith("/api/admin");
    const realRole = ctx.state.impersonatedBy ? "admin" : ctx.state.user.role;
    if (isAdminPath && realRole !== "admin") {
      return authRedirect(ctx.req, roleRedirect(ctx.state.user.role));
    }

    return ctx.next();
  }

  // Unauthenticated — redirect to login (HX-Redirect for HTMX so widgets
  // don't get the login page swapped into their target slots).
  return authRedirect(ctx.req, `/login?redirect=${encodeURIComponent(path)}`);
});
