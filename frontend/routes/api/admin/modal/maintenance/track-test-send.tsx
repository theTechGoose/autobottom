/** TEMPORARY email-tracking spike — POST handler. Forwards the recipient +
 *  label to the backend /admin/track-test/send, which mints a tid, records the
 *  send, and sends the instrumented email. Renders a small confirmation.
 *  Remove with the rest of the track-test feature. */

import { define } from "../../../../../lib/define.ts";
import { apiPost } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

interface Resp { ok?: boolean; tid?: string; error?: string }

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const to = String(form.get("to") ?? "").trim();
    const label = String(form.get("label") ?? "workspace").trim();

    let r: Resp;
    try {
      r = await apiPost<Resp>("/admin/track-test/send", ctx.req, { to, label });
    } catch (e) {
      r = { ok: false, error: String((e as Error).message ?? e) };
    }

    const ok = r.ok === true;
    const html = renderToString(
      <div
        style={`font-size:12px;padding:10px 12px;border:1px solid ${ok ? "var(--green)" : "var(--red)"};border-radius:6px;background:var(--bg);`}
      >
        {ok ? (
          <span>
            ✓ Sent to <strong>{to}</strong>. tid <code style="color:var(--text-bright);">{r.tid}</code>. Now run phases
            A→C and hit <strong>Refresh results</strong> below.
          </span>
        ) : (
          <span style="color:var(--red);">Send failed: {r.error ?? "unknown"}</span>
        )}
      </div>,
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
