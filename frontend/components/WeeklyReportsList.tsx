/** Shared Weekly Reports config list with Preview / Send-Live HTMX buttons.
 *  Rendered by the modal's Weekly tab (routes/api/admin/modal/reports.tsx) and
 *  the full-page report (routes/admin/weekly-reports.tsx). The Preview/Send
 *  buttons POST to the same /api/admin/modal/reports/{preview,send-now} fragment
 *  routes and swap into the per-row #wr-preview / #wr-send slots — plain HTMX,
 *  works identically on the modal and the full page. */

export interface EmailReportConfig {
  id?: string;
  name: string;
  schedule?: { cron: string; tz?: string };
  enabled?: boolean;
  disabled?: boolean;
  recipients?: string[];
}
export interface StatusEntry { lastRunAt?: number; lastRunStatus?: string }

/** Humanize a 5-field cron into "Daily @ HH:MM EST" etc. Kept in sync with
 *  EmailReportEditor's ListView. */
export function humanizeCron(cron: string | undefined): string {
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

export function WeeklyReportsList(
  { configs, statuses }: { configs: EmailReportConfig[]; statuses: Record<string, StatusEntry> },
) {
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
        const isActive = c.enabled === true;
        const st = statuses[id];
        return (
          <div key={id} id={`wr-row-${id}`} style="border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-bottom:10px;background:var(--bg);">
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
                <button
                  type="button"
                  class="sf-btn danger"
                  style="font-size:11px;padding:4px 10px;"
                  hx-post={`/api/admin/modal/reports/delete?configId=${encodeURIComponent(id)}`}
                  hx-target={`#wr-del-${id}`}
                  hx-swap="innerHTML"
                  hx-confirm={`Delete "${c.name || "this report"}" permanently? This removes it from Firestore and it will stop sending.`}
                  hx-disabled-elt="this"
                  disabled={!id}
                >Delete</button>
                <span id={`wr-del-${id}`} style="font-size:10px;color:var(--text-dim);min-width:40px;"></span>
              </div>
            </div>
            <div id={`wr-preview-${id}`} style="margin-top:10px;"></div>
          </div>
        );
      })}
    </div>
  );
}
