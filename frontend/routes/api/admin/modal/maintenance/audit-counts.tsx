/** Audit Counts runner — calls /admin/audit-counts and renders the result
 *  as a verbatim JSON pre-block plus a small summary. Optional since/until
 *  date inputs (passed as ms timestamps) and an "include KV" toggle.
 *
 *  Tradeoff: the backend walks audit-done-idx (fast, indexed) and KV
 *  audit-finding (slower per finding). Without a date range, a year of
 *  history can take 10–20s; with a date range it's typically subsecond
 *  to a few seconds. Both walks are independently try/catch'd on the
 *  backend so a partial failure still returns numbers for whichever
 *  source succeeded. */

import { define } from "../../../../../lib/define.ts";
import { apiFetch } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

interface CountBlock {
  packagesUnique?: number;
  dateLegsUnique?: number;
  recordsUnique?: number;
  rowsScanned?: number;
  tookMs?: number;
  error?: string;
  skipped?: boolean;
}

interface KvFindingsBlock {
  count?: number;
  rowsScanned?: number;
  tookMs?: number;
  error?: string;
  skipped?: boolean;
  capped?: string;
}

interface KvDeepBlock {
  total?: number;
  packagesUnique?: number;
  dateLegsUnique?: number;
  packageRids?: string[];
  dateLegRids?: string[];
  rowsScanned?: number;
  chunkZeroSeen?: number;
  tookMs?: number;
  error?: string;
  skipped?: boolean;
  capped?: string;
}

interface Resp {
  ok?: boolean;
  range?: { sinceMs: number; untilMs: number; allTime: boolean };
  firestore?: CountBlock;
  kv?: CountBlock;
  kvFindings?: KvFindingsBlock;
  kvDeep?: KvDeepBlock;
  combined?: { packagesUnique: number; dateLegsUnique: number; recordsUnique: number };
  totalTookMs?: number;
  error?: string;
}

function parseDateInputToMs(value: string): number | null {
  if (!value) return null;
  // <input type="date"> gives YYYY-MM-DD; we treat as midnight UTC for both
  // ends. Backend just compares against epoch ms — exact tz doesn't matter
  // for this report, but we use UTC consistently so the same input window
  // produces the same result regardless of where the operator's browser is.
  const ts = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(ts) ? ts : null;
}

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const sinceStr = String(form.get("since") ?? "").trim();
    const untilStr = String(form.get("until") ?? "").trim();
    const skipKv = String(form.get("skipKv") ?? "") === "true";

    const sinceMs = parseDateInputToMs(sinceStr);
    // For untilMs we want end-of-day so a "to: 2026-05-15" includes audits
    // completed during the 15th. Add 24h - 1ms.
    const untilMsRaw = parseDateInputToMs(untilStr);
    const untilMs = untilMsRaw != null ? untilMsRaw + 86_400_000 - 1 : null;

    const qs = new URLSearchParams();
    if (sinceMs != null) qs.set("since", String(sinceMs));
    if (untilMs != null) qs.set("until", String(untilMs));
    if (skipKv) qs.set("skipKv", "true");

    let r: Resp;
    try {
      r = await apiFetch<Resp>(`/admin/audit-counts?${qs.toString()}`, ctx.req);
    } catch (e) {
      const html = renderToString(
        <div class="error-text" style="font-size:11px;padding:10px;border:1px solid var(--red);border-radius:6px;">
          Audit Counts failed: {String((e as Error).message ?? e)}
        </div>,
      );
      return new Response(html, { headers: { "content-type": "text/html" } });
    }

    const fmt = (n: number | undefined) => (n == null ? "—" : n.toLocaleString());
    const fsErr = r.firestore?.error;
    const kvErr = r.kv?.error;
    const kvSkipped = r.kv?.skipped === true;
    const kvJobsErr = r.kvFindings?.error;
    const kvJobsSkipped = r.kvFindings?.skipped === true;
    const kvDeepErr = r.kvDeep?.error;
    const kvDeepSkipped = r.kvDeep?.skipped === true;
    const rangeLabel = r.range?.allTime ? "All time" :
      `${r.range?.sinceMs ? new Date(r.range.sinceMs).toISOString().slice(0, 10) : "epoch"} → ${r.range?.untilMs ? new Date(r.range.untilMs).toISOString().slice(0, 10) : "now"}`;

    // RecordId list rendering (collapsible — only when the deep scan ran).
    const pkgRids = r.kvDeep?.packageRids ?? [];
    const dlRids = r.kvDeep?.dateLegRids ?? [];

    const html = renderToString(
      <div style="border:1px solid var(--border);border-radius:6px;padding:12px;background:var(--bg);">
        <div style="font-size:12px;font-weight:700;color:var(--text-bright);margin-bottom:8px;">
          Audit Counts — {rangeLabel}
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin-bottom:12px;">
          <div style="border:1px solid var(--border);border-radius:6px;padding:10px;background:var(--bg-2);">
            <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Combined</div>
            <div style="font-size:18px;font-weight:700;color:var(--text-bright);">{fmt(r.combined?.recordsUnique)}</div>
            <div style="font-size:10px;color:var(--text-dim);margin-top:4px;">
              {fmt(r.combined?.packagesUnique)} packages · {fmt(r.combined?.dateLegsUnique)} date-legs
            </div>
          </div>
          <div style="border:1px solid var(--border);border-radius:6px;padding:10px;background:var(--bg-2);">
            <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Firestore</div>
            <div style={`font-size:18px;font-weight:700;color:${fsErr ? "var(--red)" : "var(--text-bright)"};`}>
              {fsErr ? "error" : fmt(r.firestore?.recordsUnique)}
            </div>
            <div style="font-size:10px;color:var(--text-dim);margin-top:4px;">
              {fsErr ? fsErr : <>
                {fmt(r.firestore?.packagesUnique)} packages · {fmt(r.firestore?.dateLegsUnique)} date-legs
                <br />
                {fmt(r.firestore?.rowsScanned)} rows · {fmt(r.firestore?.tookMs)}ms
              </>}
            </div>
          </div>
          <div style="border:1px solid var(--border);border-radius:6px;padding:10px;background:var(--bg-2);">
            <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">KV (audit-job)</div>
            <div style={`font-size:18px;font-weight:700;color:${kvJobsErr ? "var(--red)" : "var(--text-bright)"};`}>
              {kvJobsSkipped ? "skipped" : kvJobsErr ? "error" : fmt(r.kvFindings?.count)}
            </div>
            <div style="font-size:10px;color:var(--text-dim);margin-top:4px;">
              {kvJobsSkipped ? "Include KV unchecked" : kvJobsErr ? kvJobsErr : <>
                exact total — one job per pipeline run
                <br />
                {fmt(r.kvFindings?.rowsScanned)} rows · {fmt(r.kvFindings?.tookMs)}ms
                {r.kvFindings?.capped && <><br /><span style="color:var(--yellow);">⚠ {r.kvFindings.capped}</span></>}
              </>}
            </div>
          </div>
          <div style="border:1px solid var(--border);border-radius:6px;padding:10px;background:var(--bg-2);">
            <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">KV (completed)</div>
            <div style={`font-size:18px;font-weight:700;color:${kvErr ? "var(--red)" : "var(--text-bright)"};`}>
              {kvSkipped ? "skipped" : kvErr ? "error" : fmt(r.kv?.recordsUnique)}
            </div>
            <div style="font-size:10px;color:var(--text-dim);margin-top:4px;">
              {kvSkipped ? "Include KV unchecked" : kvErr ? kvErr : <>
                {fmt(r.kv?.packagesUnique)} packages · {fmt(r.kv?.dateLegsUnique)} date-legs
                <br />
                {fmt(r.kv?.rowsScanned)} rows · {fmt(r.kv?.tookMs)}ms
                <br />
                <span style="color:var(--text-dim);font-style:italic;">subset — finalize-only</span>
              </>}
            </div>
          </div>
          <div style="border:1px solid var(--border);border-radius:6px;padding:10px;background:var(--bg-2);">
            <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">KV (audit-finding deep)</div>
            <div style={`font-size:18px;font-weight:700;color:${kvDeepErr ? "var(--red)" : "var(--text-bright)"};`}>
              {kvDeepSkipped ? "skipped" : kvDeepErr ? "error" : fmt(r.kvDeep?.total)}
            </div>
            <div style="font-size:10px;color:var(--text-dim);margin-top:4px;">
              {kvDeepSkipped ? "Include KV unchecked" : kvDeepErr ? kvDeepErr : <>
                {fmt(r.kvDeep?.packagesUnique)} packages · {fmt(r.kvDeep?.dateLegsUnique)} date-legs
                <br />
                {fmt(r.kvDeep?.rowsScanned)} rows · {fmt(r.kvDeep?.tookMs)}ms
                {r.kvDeep?.capped && <><br /><span style="color:var(--yellow);">⚠ {r.kvDeep.capped}</span></>}
              </>}
            </div>
          </div>
        </div>

        {(pkgRids.length > 0 || dlRids.length > 0) && (
          <details style="margin-bottom:8px;">
            <summary style="font-size:11px;color:var(--text-dim);cursor:pointer;">
              Raw recordIds from deep scan ({pkgRids.length + dlRids.length} unique)
            </summary>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px;">
              <div>
                <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">
                  Packages ({pkgRids.length})
                </div>
                <pre style="font-size:10px;font-family:var(--mono);background:var(--bg-2);border:1px solid var(--border);border-radius:6px;padding:8px;max-height:280px;overflow:auto;white-space:pre-wrap;word-break:break-all;">{pkgRids.join("\n")}</pre>
              </div>
              <div>
                <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">
                  Date-legs ({dlRids.length})
                </div>
                <pre style="font-size:10px;font-family:var(--mono);background:var(--bg-2);border:1px solid var(--border);border-radius:6px;padding:8px;max-height:280px;overflow:auto;white-space:pre-wrap;word-break:break-all;">{dlRids.join("\n")}</pre>
              </div>
            </div>
          </details>
        )}
        <details>
          <summary style="font-size:11px;color:var(--text-dim);cursor:pointer;">Raw JSON</summary>
          <pre style="font-size:10px;font-family:var(--mono);background:var(--bg-2);border:1px solid var(--border);border-radius:6px;padding:10px;margin-top:8px;white-space:pre-wrap;">
            {JSON.stringify(r, null, 2)}
          </pre>
        </details>
        <div style="font-size:10px;color:var(--text-dim);margin-top:8px;">
          Total {fmt(r.totalTookMs)}ms. Re-run with a tighter date range if you need to slice further.
        </div>
      </div>,
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
