/** Send Live Now — fires the actual /admin/email-reports/send-now backend
 *  call, which runs runReport and sends real email to configured recipients.
 *  Returns a small status pill that swaps into the wr-send-{configId} slot. */

import { define } from "../../../../../lib/define.ts";
import { apiFetch } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

interface Resp { ok?: boolean; error?: string; retry?: boolean }

export const handler = define.handlers({
  async POST(ctx) {
    const configId = (new URL(ctx.req.url).searchParams.get("configId") ?? "").trim();
    if (!configId) {
      return new Response(
        renderToString(<span style="color:var(--red);">missing id</span>),
        { headers: { "content-type": "text/html" } },
      );
    }
    let r: Resp;
    try {
      r = await apiFetch<Resp>("/admin/email-reports/send-now", ctx.req, {
        method: "POST",
        body: JSON.stringify({ id: configId }),
        headers: { "content-type": "application/json" },
      });
    } catch (e) {
      return new Response(
        renderToString(<span style="color:var(--red);" title={String((e as Error).message ?? e)}>✗ send failed</span>),
        { headers: { "content-type": "text/html" } },
      );
    }
    if (r.error || r.ok === false) {
      return new Response(
        renderToString(<span style="color:var(--red);" title={r.error ?? "unknown"}>✗ {r.error ?? "rejected"}</span>),
        { headers: { "content-type": "text/html" } },
      );
    }
    const time = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return new Response(
      renderToString(<span style="color:var(--green);">✓ sent at {time}</span>),
      { headers: { "content-type": "text/html" } },
    );
  },
});
