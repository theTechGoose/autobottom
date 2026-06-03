/** Question Failures — full-page report. Popped out from the Reports modal's
 *  "Open full report ↗" link (or navigated directly). Same monthly per-question
 *  failure table as the modal, with room for the full list + a native GET range
 *  bar / config filter.
 *
 *  Plain SSR + native GET form navigation (no island). Registered in
 *  FRONTEND_EXACT_PAGES so browser nav reaches Fresh and the page-side apiFetch
 *  to the same /admin/question-failures path (Accept: json) reaches danet. */

import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { apiFetch } from "../../lib/api.ts";
import { QF_PRESETS, resolveQfRange } from "../../lib/qf-range.ts";
import { QuestionFailuresStatsAndTable, type QfRow } from "../../components/QuestionFailuresTable.tsx";

interface Resp {
  ok?: boolean;
  range?: { from: string; to: string };
  rows?: QfRow[];
  tookMs?: number;
  error?: string;
}

export default define.page(async function QuestionFailuresPage(ctx) {
  const url = new URL(ctx.req.url);
  const sp = url.searchParams;

  const presetParam = sp.get("preset") ?? "";
  const customFrom = sp.get("custom-from") ?? "";
  const customTo = sp.get("custom-to") ?? "";
  const fromParam = sp.get("from");
  const toParam = sp.get("to");
  const configKey = (sp.get("configKey") ?? "").trim();

  // Priority: explicit preset → explicit from/to (carried from the modal link) →
  // default this-month.
  let from: string, to: string, label: string, activePreset: string;
  if (presetParam) {
    ({ from, to, label } = resolveQfRange(presetParam, customFrom, customTo));
    activePreset = presetParam;
  } else if (fromParam && toParam) {
    from = fromParam; to = toParam; label = `${from} → ${to}`; activePreset = "";
  } else {
    ({ from, to, label } = resolveQfRange("this-month", "", ""));
    activePreset = "this-month";
  }

  const qs = new URLSearchParams();
  qs.set("from", from);
  qs.set("to", to);
  if (configKey) qs.set("configKey", configKey);

  let r: Resp | null = null;
  let error = "";
  try {
    r = await apiFetch<Resp>(`/admin/question-failures?${qs.toString()}`, ctx.req);
  } catch (e) {
    error = String((e as Error).message ?? e);
  }
  const rows = r?.rows ?? [];

  return (
    <Layout title="Question Failures" section="admin" user={ctx.state.user!} pathname={url.pathname} hideSidebar>
      <div class="ql-topbar">
        <div class="ql-topbar-title">
          <span class="ql-topbar-icon" aria-hidden="true">📋</span>
          <h1>Question Failures</h1>
        </div>
        <a href="/admin/dashboard" class="ql-topbar-back">← Dashboard</a>
      </div>

      <div class="ql-page-body">
        {/* Range + config filter — one native GET form; each preset is a submit
            button so the config filter is preserved across preset clicks. */}
        <form method="GET" action="/admin/question-failures"
          style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:14px;padding:10px 12px;background:var(--bg-raised);border:1px solid var(--border);border-radius:8px;">
          <span style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-right:4px;">Range</span>
          {QF_PRESETS.map((p) => (
            <button key={p.key} type="submit" name="preset" value={p.key}
              class={`sf-btn ${p.key === activePreset ? "primary" : "ghost"}`}
              style="font-size:11px;padding:4px 12px;">{p.label}</button>
          ))}
          <span style="margin:0 6px;color:var(--text-dim);">|</span>
          <span style="font-size:11px;color:var(--text-dim);">Custom:</span>
          <input type="date" name="custom-from" value={customFrom} class="sf-input" style="font-size:11px;padding:2px 6px;width:140px;" />
          <span style="color:var(--text-dim);font-size:11px;">→</span>
          <input type="date" name="custom-to" value={customTo} class="sf-input" style="font-size:11px;padding:2px 6px;width:140px;" />
          <button type="submit" name="preset" value="custom" class="sf-btn primary" style="font-size:11px;padding:4px 12px;">Apply</button>
          <input type="text" name="configKey" value={configKey} placeholder="config filter (optional)" class="sf-input" style="font-size:11px;padding:2px 6px;width:200px;margin-left:auto;" />
        </form>

        <div style="font-size:11px;color:var(--text-dim);margin-bottom:12px;">
          Per-question failure counts with flip-to-pass / flip-to-fail tracking. Data is rolled up monthly —
          sub-monthly windows round up to the containing month.
        </div>

        {error ? (
          <div class="error-text" style="font-size:12px;padding:12px;border:1px solid var(--red);border-radius:8px;">
            Failed to load: {error}
          </div>
        ) : !r?.ok ? (
          <div class="error-text" style="font-size:12px;padding:12px;border:1px solid var(--red);border-radius:8px;">
            Backend rejected: {r?.error ?? "unknown"}
          </div>
        ) : (
          <div style="border:1px solid var(--border);border-radius:8px;padding:14px;background:var(--bg);">
            <div style="font-size:13px;font-weight:700;color:var(--text-bright);margin-bottom:12px;">
              Question Failures — {label}
            </div>
            <QuestionFailuresStatsAndTable
              rows={rows}
              tookMs={r.tookMs}
              rangeFrom={r.range?.from}
              rangeTo={r.range?.to}
              rowCap={1000}
              emptyHint="No counter data in this range. If you expect data here, check Data Maintenance → Question Failures → Backfill."
            />
          </div>
        )}
      </div>
    </Layout>
  );
});
