/** Manager root — redirects to audit history (the manager's only page).
 *  Forwards the incoming query string so admin impersonation via `?as=<email>`
 *  survives the hop. Without this, `/admin/impersonate-go?dest=/manager`
 *  lands on `/manager?as=annab` → 302 → `/manager/audits` (no `?as=`) →
 *  middleware doesn't swap → page renders with admin's empty manager-scope
 *  → admin sees ALL reviewed audits instead of annab's team-scoped view. */
import { define } from "../../lib/define.ts";

export const handler = define.handlers({
  GET(ctx) {
    const url = new URL(ctx.req.url);
    return new Response(null, { status: 302, headers: { location: `/manager/audits${url.search}` } });
  },
});
