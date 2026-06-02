/** Reports modal — top-level shell with two tabs.
 *
 *  Reports is a READ destination (look at the data) vs Data Maintenance
 *  which is an OPS destination (act on the data). Question Failures
 *  rollup + Weekly Reports preview both live here. Each tab's initial
 *  markup is rendered here; child fragment routes handle the data swaps. */

import { define } from "../../../../lib/define.ts";
import { renderToString } from "preact-render-to-string";
import { apiFetch } from "../../../../lib/api.ts";
import { ENG_PRESETS } from "../../../../lib/report-range.ts";

type TabKey = "qfailures" | "weekly" | "engagement";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "qfailures", label: "Question Failures" },
  { key: "weekly", label: "Weekly Reports" },
  { key: "engagement", label: "Email Engagement" },
];

interface EmailReportConfig {
  id?: string;
  name: string;
  schedule?: { cron: string; tz?: string };
  enabled?: boolean;
  disabled?: boolean;
  recipients?: string[];
}
interface StatusEntry { lastRunAt?: number; lastRunStatus?: string }

export const handler = define.handlers({
  async GET(ctx) {
    const tab = (new URL(ctx.req.url).searchParams.get("tab") ?? "qfailures") as TabKey;
    const active = TABS.find((t) => t.key === tab) ? tab : "qfailures";

    // For Weekly Reports we need the configs + statuses up-front so the
    // initial render shows the rows. Question Failures starts empty until
    // operator hits a preset or "Apply".
    let configs: EmailReportConfig[] = [];
    let statuses: Record<string, StatusEntry> = {};
    if (active === "weekly") {
      try {
        const c = await apiFetch<{ configs?: EmailReportConfig[] }>("/admin/email-reports", ctx.req);
        configs = c.configs ?? [];
      } catch (e) { console.error("[reports/weekly] configs load:", e); }
      try {
        const s = await apiFetch<{ statuses?: Record<string, StatusEntry> }>("/admin/email-reports/all-status", ctx.req);
        statuses = s.statuses ?? {};
      } catch (e) { console.error("[reports/weekly] statuses load:", e); }
    }

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
          {active === "weekly" && <WeeklyReportsInitial configs={configs} statuses={statuses} />}
          {active === "engagement" && <EngagementInitial />}
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

// ── Question Failures initial panel ──────────────────────────────────────────
//
// Preset buttons + custom date range form. Each control fires a POST to the
// /question-failures fragment route, which renders the result table into
// #qf-result. The "active" preset is highlighted via a data attribute set
// by the fragment route on each render.

const QF_PRESETS: Array<{ key: string; label: string }> = [
  { key: "this-month", label: "This Month" },
  { key: "last-month", label: "Last Month" },
  { key: "last-3", label: "Last 3 Months" },
  { key: "last-6", label: "Last 6 Months" },
  { key: "all-time", label: "All Time" },
];

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
      <div id="qf-result" hx-get="/api/admin/modal/reports/question-failures-initial" hx-trigger="load" hx-swap="innerHTML">
        <div style="font-size:11px;color:var(--text-dim);padding:18px;text-align:center;">Loading current-month data…</div>
      </div>
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
      <div id="eng-result" hx-get="/api/admin/modal/reports/engagement?preset=today" hx-trigger="load" hx-swap="innerHTML">
        <div style="font-size:11px;color:var(--text-dim);padding:18px;text-align:center;">Loading today's data…</div>
      </div>
    </div>
  );
}

// ── Weekly Reports initial panel ─────────────────────────────────────────────

function WeeklyReportsInitial({ configs, statuses }: { configs: EmailReportConfig[]; statuses: Record<string, StatusEntry> }) {
  if (configs.length === 0) {
    return (
      <div style="font-size:13px;color:var(--text-dim);padding:24px;text-align:center;">
        No email report configs saved yet. Configure one via <strong style="color:var(--text-bright);">Email Reports</strong> in the sidebar.
      </div>
    );
  }
  return (
    <div>
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:10px;">
        Click Preview to generate the report HTML and view it in-browser without sending. Click Send Live Now to fire the actual email to configured recipients.
      </div>
      {configs.map((c) => {
        const id = c.id ?? "";
        const isActive = c.enabled !== false && !c.disabled;
        const st = statuses[id];
        return (
          <div key={id} style="border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-bottom:10px;background:var(--bg);">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
              <div>
                <div style="font-weight:600;color:var(--text-bright);font-size:13px;">{c.name || "Untitled"}</div>
                <div style="font-size:10px;color:var(--text-dim);margin-top:2px;">
                  {humanizeCron(c.schedule?.cron)} · {c.recipients?.length ?? 0} recipient(s) ·{" "}
                  <span class={`pill pill-${isActive ? "green" : "red"}`} style="font-size:9px;padding:1px 6px;">
                    {isActive ? "Active" : "Off"}
                  </span>
                  {st?.lastRunAt && (
                    <>
                      {" · last ran "}
                      <span style={`color:${st.lastRunStatus === "ok" ? "var(--green)" : "var(--red)"};`}>
                        {st.lastRunStatus === "ok" ? "✓" : "✗"} {new Date(st.lastRunAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div style="display:flex;align-items:center;gap:6px;">
                <button
                  type="button"
                  class="sf-btn ghost"
                  style="font-size:11px;padding:4px 10px;"
                  hx-post={`/api/admin/modal/reports/preview?configId=${encodeURIComponent(id)}`}
                  hx-target={`#wr-preview-${id}`}
                  hx-swap="innerHTML"
                  hx-disabled-elt="this"
                  hx-indicator={`#wr-preview-${id}`}
                  disabled={!id}
                >Preview ▶</button>
                <button
                  type="button"
                  class="sf-btn primary"
                  style="font-size:11px;padding:4px 10px;"
                  hx-post={`/api/admin/modal/reports/send-now?configId=${encodeURIComponent(id)}`}
                  hx-target={`#wr-send-${id}`}
                  hx-swap="innerHTML"
                  hx-confirm={`Send "${c.name || "this report"}" live to ${c.recipients?.length ?? 0} recipient(s) right now?`}
                  hx-disabled-elt="this"
                  disabled={!id}
                >Send Live Now</button>
                <span id={`wr-send-${id}`} style="font-size:10px;color:var(--text-dim);min-width:60px;"></span>
              </div>
            </div>
            <div id={`wr-preview-${id}`} style="margin-top:10px;"></div>
          </div>
        );
      })}
    </div>
  );
}

// Same cron humanizer used in EmailReportEditor's ListView — kept in sync.
function humanizeCron(cron: string | undefined): string {
  if (!cron) return "No schedule";
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return cron;
  const [minF, hourF, domF, monF, dowF] = fields;
  const min = Number(minF);
  const hour = Number(hourF);
  if (!Number.isFinite(min) || !Number.isFinite(hour)) return cron;
  if (monF !== "*") return `Custom: ${cron}`;
  const time = `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  if (domF === "*" && dowF === "*") return `Daily @ ${time} EST`;
  if (domF === "*") {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const d = Number(dowF);
    if (Number.isFinite(d)) return `${days[d % 7]} @ ${time} EST`;
  }
  if (dowF === "*") {
    const d = Number(domF);
    if (Number.isFinite(d)) return `Day ${d} @ ${time} EST`;
  }
  return `Custom: ${cron}`;
}
