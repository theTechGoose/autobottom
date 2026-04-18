/** HTMX fragment body for the Bulk Audit modal. The actual form + stagger
 *  loop lives in the BulkAuditRunner island — this route just mounts it. */
import { define } from "../../../../lib/define.ts";
import { renderToString } from "preact-render-to-string";
import BulkAuditRunner from "../../../../islands/BulkAuditRunner.tsx";

export const handler = define.handlers({
  GET() {
    const html = renderToString(
      <div>
        <div style="padding:14px 20px 0;">
          <div style="font-size:15px;font-weight:700;color:var(--text-bright);margin-bottom:4px;">Bulk Audit</div>
          <div style="font-size:11px;color:var(--text-muted);">
            Paste a list of QuickBase record IDs — each will be queued as a real audit with the stagger below.
          </div>
        </div>
        <BulkAuditRunner />
      </div>,
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
