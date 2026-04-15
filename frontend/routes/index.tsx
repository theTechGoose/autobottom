/** Root route — redirects to role-appropriate dashboard. */
import { define } from "../lib/define.ts";
import { roleRedirect } from "../lib/auth.ts";

export default define.page(function Index(ctx) {
  const user = ctx.state.user;
  if (user) {
    const target = roleRedirect(user.role);
    return new Response(null, { status: 302, headers: { location: target } }) as any;
  }
  return new Response(null, { status: 302, headers: { location: "/login" } }) as any;
});
