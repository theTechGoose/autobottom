/** Auth middleware — resolves user from session cookie via direct in-process authenticate().
 *  Does NOT make HTTP self-requests — Deno Deploy isolates can't fetch their own localhost. */
import { define } from "../lib/define.ts";
import { isPublicPath } from "../lib/auth.ts";
import { authenticate } from "@core/business/auth/mod.ts";
import { listUsers } from "@core/business/auth/mod.ts";

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
        return new Response(null, { status: 302, headers: { location: "/admin/dashboard" } });
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

    return ctx.next();
  }

  // Unauthenticated — redirect to login
  return new Response(null, {
    status: 302,
    headers: { location: `/login?redirect=${encodeURIComponent(path)}` },
  });
});
