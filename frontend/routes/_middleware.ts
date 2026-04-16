/** Auth middleware — resolves user from session cookie via direct in-process authenticate().
 *  Does NOT make HTTP self-requests — Deno Deploy isolates can't fetch their own localhost. */
import { define } from "../lib/define.ts";
import { isPublicPath } from "../lib/auth.ts";
import { authenticate } from "@core/business/auth/mod.ts";

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
    return ctx.next();
  }

  // Unauthenticated — redirect to login
  return new Response(null, {
    status: 302,
    headers: { location: `/login?redirect=${encodeURIComponent(path)}` },
  });
});
