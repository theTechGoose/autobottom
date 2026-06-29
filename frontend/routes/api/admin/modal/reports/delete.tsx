/** Delete a saved email/weekly report config. Fires the existing
 *  /admin/email-reports/delete backend call (deleteEmailReportConfig →
 *  removes the doc from Firestore). On success the whole row is removed via
 *  HX-Retarget/HX-Reswap; on failure a red note swaps into the per-row
 *  wr-del-{configId} slot so the row survives for a retry. */

import { define } from "../../../../../lib/define.ts";
import { apiFetch } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

interface Resp { ok?: boolean; error?: string }

function err(msg: string): Response {
  return new Response(
    renderToString(<span style="color:var(--red);" title={msg}>✗ {msg}</span>),
    { headers: { "content-type": "text/html" } },
  );
}

export const handler = define.handlers({
  async POST(ctx) {
    const configId = (new URL(ctx.req.url).searchParams.get("configId") ?? "").trim();
    if (!configId) return err("missing id");

    let r: Resp;
    try {
      r = await apiFetch<Resp>("/admin/email-reports/delete", ctx.req, {
        method: "POST",
        body: JSON.stringify({ id: configId }),
        headers: { "content-type": "application/json" },
      });
    } catch (e) {
      return err(String((e as Error).message ?? e));
    }
    if (r.error || r.ok === false) return err(r.error ?? "rejected");

    // Success — remove the entire row card, not just the status slot.
    return new Response("", {
      headers: {
        "content-type": "text/html",
        "HX-Retarget": `#wr-row-${configId}`,
        "HX-Reswap": "outerHTML",
      },
    });
  },
});
