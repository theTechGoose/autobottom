/** Root route — redirects to role-appropriate dashboard, or /login if signed out.
 *  Middleware already redirects unauthenticated requests; this handler covers the
 *  authenticated branch. Using define.handlers (not define.page) so the Response
 *  is honored cleanly instead of being wrapped as page content. */
import { define } from "../lib/define.ts";
import { roleRedirect } from "../lib/auth.ts";

export const handler = define.handlers({
  GET(ctx) {
    const user = ctx.state.user;
    const target = user ? roleRedirect(user.role) : "/login";
    return new Response(null, { status: 302, headers: { location: target } });
  },
});
