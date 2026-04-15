/** Modal content: Impersonate a specific user. */
import { define } from "../../../../lib/define.ts";
import { renderToString } from "preact-render-to-string";

export const handler = define.handlers({
  GET() {
    const html = renderToString(
      <div>
        <div class="modal-sub">Enter a user's email to view the app as them.</div>
        <div style="display:flex;gap:8px;align-items:flex-end;">
          <div style="flex:1;"><label class="sf-label">Email</label><input type="email" id="imp-email" placeholder="user@example.com" class="sf-input" /></div>
          <button class="btn btn-primary" style="padding:8px 20px;font-size:12px;">Go</button>
        </div>
      </div>
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
