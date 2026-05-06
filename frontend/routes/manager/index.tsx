/** Manager root — redirects to audit history (the manager's only page). */
import { define } from "../../lib/define.ts";

export const handler = define.handlers({
  GET() {
    return new Response(null, { status: 302, headers: { location: "/manager/audits" } });
  },
});
