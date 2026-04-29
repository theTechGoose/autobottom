/** Modal content: Email Reports — mounts the EmailReportEditor island.
 *  All UI logic (list/edit, rule builder, sections, preview) lives in the
 *  island; this route just renders the island shell + a close button. */
import { define } from "../../../../lib/define.ts";
import { renderToString } from "preact-render-to-string";
import EmailReportEditor from "../../../../islands/EmailReportEditor.tsx";

export const handler = define.handlers({
  GET(_ctx) {
    const html = renderToString(
      <div>
        <div style="display:flex;justify-content:flex-end;margin-bottom:6px;">
          <button class="sf-btn ghost" data-close-modal="email-reports-modal" type="button" style="font-size:11px;">Close</button>
        </div>
        <EmailReportEditor />
      </div>,
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
