/** Backfill the failed-finding index from historical audit-done-idx + findings.
 *  POSTs since/until as ms to the backend, which rebuilds one row per failed
 *  question. Idempotent (delete-then-emit per finding). */

import { define } from "../../../../../lib/define.ts";
import { apiFetch } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

interface Resp { ok?: boolean; message?: string; error?: string }

function parseDateToMs(s: string, endOfDay = false): number | null {
  if (!s) return null;
  const ts = Date.parse(s + "T00:00:00Z");
  if (!Number.isFinite(ts)) return null;
  return endOfDay ? ts + 86_400_000 - 1 : ts;
}

function errBox(msg: string): Response {
  const html = renderToString(
    <div class="error-text" style="font-size:11px;padding:10px;border:1px solid var(--red);border-radius:6px;">{msg}</div>,
  );
  return new Response(html, { headers: { "content-type": "text/html" } });
}

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const sinceMs = parseDateToMs(String(form.get("since") ?? "").trim());
    const untilMs = parseDateToMs(String(form.get("until") ?? "").trim(), true);
    if (sinceMs == null || untilMs == null || untilMs <= sinceMs) {
      return errBox("Both From and To dates are required and To must be after From.");
    }
    let r: Resp;
    try {
      r = await apiFetch<Resp>("/admin/failed-audits/backfill", ctx.req, {
        method: "POST",
        body: JSON.stringify({ sinceMs, untilMs }),
        headers: { "content-type": "application/json" },
      });
    } catch (e) {
      return errBox(`Backfill failed: ${String((e as Error).message ?? e)}`);
    }
    if (!r.ok) return errBox(`Backend rejected: ${r.error ?? "unknown"}`);
    const html = renderToString(
      <div style="border:1px solid var(--border);border-radius:6px;padding:12px;background:var(--bg);">
        <div style="font-size:12px;font-weight:700;color:var(--green);margin-bottom:6px;">✓ Failed Audits backfill complete</div>
        <div style="font-size:11px;color:var(--text-dim);">{r.message ?? "done"}</div>
      </div>,
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
