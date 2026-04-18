/** Dev Tools modal — Seed Test Data + Wipe All KV.
 *  Intentionally destructive; sidebar gates it behind ?local or super-admin
 *  email, but the modal itself also requires typed confirmation for wipe. */
import { define } from "../../../../lib/define.ts";
import { renderToString } from "preact-render-to-string";
import DevToolsPanel from "../../../../islands/DevToolsPanel.tsx";

export const handler = define.handlers({
  GET() {
    const html = renderToString(
      <div style="padding:20px 24px 22px;">
        <div style="font-size:15px;font-weight:700;color:var(--text-bright);margin-bottom:4px;">Dev Tools</div>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:14px;">
          Local-dev helpers. Wipe is destructive — KV data for this org is gone.
        </div>
        <DevToolsPanel />
      </div>,
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
