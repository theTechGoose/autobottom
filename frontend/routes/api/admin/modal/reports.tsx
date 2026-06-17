/** Reports modal — top-level shell with two tabs.
 *
 *  Reports is a READ destination (look at the data) vs Data Maintenance
 *  which is an OPS destination (act on the data). Question Failures
 *  rollup + Weekly Reports preview both live here. Each tab's initial
 *  markup is rendered here; child fragment routes handle the data swaps. */

import { define } from "../../../../lib/define.ts";
import { renderToString } from "preact-render-to-string";
import { ENG_PRESETS, RT_PRESETS } from "../../../../lib/report-range.ts";
import { QF_PRESETS } from "../../../../lib/qf-range.ts";

type TabKey = "qfailures" | "weekly" | "engagement" | "throughput";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "qfailures", label: "Question Failures" },
  { key: "weekly", label: "Weekly Reports" },
  { key: "engagement", label: "Email Engagement" },
  { key: "throughput", label: "Reviewer Throughput" },
];

export const handler = define.handlers({
  async GET(ctx) {
    const tab = (new URL(ctx.req.url).searchParams.get("tab") ?? "qfailures") as TabKey;
    const active = TABS.find((t) => t.key === tab) ? tab : "qfailures";

    // Every tab now starts idle — no report scans on modal/tab open. The operator
    // clicks "Run now" (or a preset) on the active tab, which fetches the data.

    const html = renderToString(
      <div id="reports-shell">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
          <div>
            <div class="modal-title">Reports</div>
            <div class="modal-sub">Run reports and preview scheduled emails</div>
          </div>
          <button data-close-modal="reports-modal" style="background:none;border:none;color:var(--text-dim);font-size:20px;cursor:pointer;padding:0 4px;line-height:1;">&times;</button>
        </div>

        <TabBar active={active} />

        <div id="reports-content" style="margin-top:14px;">
          {active === "qfailures" && <QuestionFailuresInitial />}
          {active === "weekly" && <WeeklyReportsInitial />}
          {active === "engagement" && <EngagementInitial />}
          {active === "throughput" && <ThroughputInitial />}
        </div>
      </div>,
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});

function TabBar({ active }: { active: TabKey }) {
  return (
    <div style="display:flex;gap:6px;flex-wrap:wrap;border-bottom:1px solid var(--border);padding-bottom:8px;">
      {TABS.map((t) => {
        const isActive = t.key === active;
        const color = isActive ? "var(--blue)" : "var(--text-dim)";
        const bg = isActive ? "var(--bg)" : "transparent";
        const border = isActive ? "1px solid var(--blue)" : "1px solid var(--border)";
        return (
          <button
            key={t.key}
            type="button"
            class="sf-btn ghost"
            style={`padding:6px 12px;font-size:11px;font-weight:600;color:${color};background:${bg};border:${border};border-radius:4px;`}
            hx-get={`/api/admin/modal/reports?tab=${t.key}`}
            hx-target="#reports-shell"
            hx-swap="outerHTML"
          >{t.label}</button>
        );
      })}
    </div>
  );
}

/** Idle "Run now" panel that replaces the old hx-trigger="load" auto-fire. Reports
 *  no longer scan on modal/tab open — the operator clicks Run now (or any preset
 *  above), which swaps the result into this same div. `indicator` reuses the
 *  preset bar's existing htmx-indicator span. */
function RunNowResult({ id, endpoint, indicator, note }: { id: string; endpoint: string; indicator: string; note: string }) {
  return (
    <div id={id}>
      <div style="display:flex;flex-direction:column;align-items:center;gap:10px;padding:22px;border:1px dashed var(--border);border-radius:8px;background:var(--bg);text-align:center;">
        <button
          type="button"
          class="sf-btn primary"
          hx-get={endpoint}
          hx-target={`#${id}`}
          hx-swap="innerHTML"
          hx-disabled-elt="this"
          hx-indicator={`#${indicator}`}
          style="font-size:12px;padding:6px 18px;"
        >▶ Run now</button>
        <span style="font-size:11px;color:var(--text-dim);">{note}</span>
      </div>
    </div>
  );
}

// ── Question Failures initial panel ──────────────────────────────────────────
//
// Preset buttons + custom date range form. Each control fires a POST to the
// /question-failures fragment route, which renders the result table into
// #qf-result. The "active" preset is highlighted via a data attribute set
// by the fragment route on each render.

function QuestionFailuresInitial() {
  return (
    <div>
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:10px;">
        Per-question failure counts with flip-to-pass / flip-to-fail tracking. Data is rolled up monthly —
        sub-monthly windows would require per-day buckets (future enhancement).
      </div>
      <form
        id="qf-form"
        hx-post="/api/admin/modal/reports/question-failures"
        hx-target="#qf-result"
        hx-swap="innerHTML"
        hx-disabled-elt="find button[type='submit'], find [data-qf-preset]"
        hx-indicator="find #qf-loading"
      >
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:10px;padding:10px 12px;background:var(--bg-2);border:1px solid var(--border);border-radius:8px;">
          <span style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-right:4px;">Range</span>
          {QF_PRESETS.map((p) => (
            <button
              key={p.key}
              type="submit"
              name="preset"
              value={p.key}
              data-qf-preset={p.key}
              class={`sf-btn ${p.key === "this-month" ? "primary" : "ghost"}`}
              style="font-size:11px;padding:4px 12px;"
            >{p.label}</button>
          ))}
          <span style="margin:0 6px;color:var(--text-dim);">|</span>
          <span style="font-size:11px;color:var(--text-dim);">Custom:</span>
          <input type="date" name="custom-from" class="sf-input" style="font-size:11px;padding:2px 6px;width:140px;" />
          <span style="color:var(--text-dim);font-size:11px;">→</span>
          <input type="date" name="custom-to" class="sf-input" style="font-size:11px;padding:2px 6px;width:140px;" />
          <button type="submit" name="preset" value="custom" class="sf-btn primary" style="font-size:11px;padding:4px 12px;">Apply</button>
          <input type="text" name="configKey" placeholder="config filter (optional)" class="sf-input" style="font-size:11px;padding:2px 6px;width:180px;margin-left:auto;" />
          <span id="qf-loading" class="htmx-indicator" style="font-size:11px;color:var(--text-dim);">⏳</span>
        </div>
      </form>
      <RunNowResult
        id="qf-result"
        endpoint="/api/admin/modal/reports/question-failures-initial"
        indicator="qf-loading"
        note="Not run yet — Run now (This Month), or pick a range above."
      />
    </div>
  );
}

// ── Email Engagement initial panel ───────────────────────────────────────────
//
// Preset buttons + custom date range, mirroring Question Failures. Each control
// POSTs to the /engagement fragment route, which resolves the range to ms and
// renders the co-headline open-rate / click-rate cards into #eng-result.

function EngagementInitial() {
  return (
    <div>
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:10px;">
        Audit-email engagement over the audits completed in the window. Open rate and click rate side-by-side,
        each with its own appeal rate. Opens are prefetch-filtered + deduped; clicks are exact human engagement.
      </div>
      <form
        id="eng-form"
        hx-post="/api/admin/modal/reports/engagement"
        hx-target="#eng-result"
        hx-swap="innerHTML"
        hx-disabled-elt="find button[type='submit']"
        hx-indicator="find #eng-loading"
      >
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:10px;padding:10px 12px;background:var(--bg-2);border:1px solid var(--border);border-radius:8px;">
          <span style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-right:4px;">Range</span>
          {ENG_PRESETS.map((p) => (
            <button
              key={p.key}
              type="submit"
              name="preset"
              value={p.key}
              class={`sf-btn ${p.key === "today" ? "primary" : "ghost"}`}
              style="font-size:11px;padding:4px 12px;"
            >{p.label}</button>
          ))}
          <span style="margin:0 6px;color:var(--text-dim);">|</span>
          <span style="font-size:11px;color:var(--text-dim);">Custom:</span>
          <input type="date" name="custom-from" class="sf-input" style="font-size:11px;padding:2px 6px;width:140px;" />
          <span style="color:var(--text-dim);font-size:11px;">→</span>
          <input type="date" name="custom-to" class="sf-input" style="font-size:11px;padding:2px 6px;width:140px;" />
          <button type="submit" name="preset" value="custom" class="sf-btn primary" style="font-size:11px;padding:4px 12px;">Apply</button>
          <span id="eng-loading" class="htmx-indicator" style="font-size:11px;color:var(--text-dim);">⏳</span>
        </div>
      </form>
      <RunNowResult
        id="eng-result"
        endpoint="/api/admin/modal/reports/engagement?preset=today"
        indicator="eng-loading"
        note="Not run yet — Run now (Today), or pick a range above."
      />
    </div>
  );
}

// ── Reviewer Throughput initial panel ────────────────────────────────────────
//
// Per-reviewer audit handle time + throughput. Default Today; presets This Week /
// 7d / 30d / All Time. Posts to the /reviewer-throughput fragment.

function ThroughputInitial() {
  return (
    <div>
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:10px;">
        How long reviewers take to work audits — active handle time per question + per audit, with throughput.
        Idle (&gt;60s) / tab-away questions are discarded so lunch breaks don't skew averages. Forward-only.
      </div>
      <form
        id="rt-form"
        hx-post="/api/admin/modal/reports/reviewer-throughput"
        hx-target="#rt-result"
        hx-swap="innerHTML"
        hx-disabled-elt="find button[type='submit']"
        hx-indicator="find #rt-loading"
      >
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:10px;padding:10px 12px;background:var(--bg-2);border:1px solid var(--border);border-radius:8px;">
          <span style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-right:4px;">Range</span>
          {RT_PRESETS.map((p) => (
            <button
              key={p.key}
              type="submit"
              name="preset"
              value={p.key}
              class={`sf-btn ${p.key === "today" ? "primary" : "ghost"}`}
              style="font-size:11px;padding:4px 12px;"
            >{p.label}</button>
          ))}
          <span style="margin:0 6px;color:var(--text-dim);">|</span>
          <span style="font-size:11px;color:var(--text-dim);">Custom:</span>
          <input type="date" name="custom-from" class="sf-input" style="font-size:11px;padding:2px 6px;width:140px;" />
          <span style="color:var(--text-dim);font-size:11px;">→</span>
          <input type="date" name="custom-to" class="sf-input" style="font-size:11px;padding:2px 6px;width:140px;" />
          <button type="submit" name="preset" value="custom" class="sf-btn primary" style="font-size:11px;padding:4px 12px;">Apply</button>
          <span id="rt-loading" class="htmx-indicator" style="font-size:11px;color:var(--text-dim);">⏳</span>
        </div>
      </form>
      <RunNowResult
        id="rt-result"
        endpoint="/api/admin/modal/reports/reviewer-throughput?preset=today"
        indicator="rt-loading"
        note="Not run yet — Run now (Today), or pick a range above."
      />
    </div>
  );
}

// ── Weekly Reports initial panel ─────────────────────────────────────────────
//
// Idle until "Run now": the configs + statuses are fetched on demand by the
// /weekly fragment route (previously prefetched server-side on every tab open).
// Keeps the "Open full report" pop-out to the standalone /admin/weekly-reports.

function WeeklyReportsInitial() {
  return (
    <div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <span id="weekly-loading" class="htmx-indicator" style="font-size:11px;color:var(--text-dim);">⏳ Loading…</span>
        <a href="/admin/weekly-reports" target="_blank" rel="noopener" class="sf-btn ghost"
          style="font-size:11px;padding:4px 10px;text-decoration:none;white-space:nowrap;">Open full report ↗</a>
      </div>
      <RunNowResult
        id="weekly-result"
        endpoint="/api/admin/modal/reports/weekly"
        indicator="weekly-loading"
        note="Not run yet — Run now to load the scheduled report configs + statuses."
      />
    </div>
  );
}
