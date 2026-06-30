/** HTMX — admin Manager Queue maintenance. Preview (dry run) or clear pending
 *  manager-queue (remediation) items by department / shift / date range, so a
 *  stale queue can be scoped to a manager's team before onboarding them.
 *  Renders into #maint-msg in the Data Maintenance modal. Admin-only: the
 *  backend (/manager/api/queue/clear) enforces the role. */
import { define } from "../../../lib/define.ts";
import { apiPost, parseHtmxBody } from "../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

export interface ClearMatch { findingId: string; owner?: string; department?: string; shift?: string; date?: number; }
export interface ClearResult { total: number; matched: number; deleted: number; dryRun: boolean; sample: ClearMatch[]; }

/** "YYYY-MM-DD" → ms at UTC midnight — the SAME basis as fmtDate's toISOString(),
 *  so the previewed From/through dates and the backend window agree on one
 *  timezone regardless of the server's local zone (parsing as local-midnight made
 *  the preview off-by-one on a non-UTC server). For `since` (the From date) return
 *  midnight as-is (inclusive). For `until` (the To date) add a day so the picked
 *  day is included, since the backend window is `until`-exclusive. Exported for tests. */
export function dayMs(d: string, endExclusive = false): number | undefined {
  if (!d) return undefined;
  const t = new Date(d + "T00:00:00Z").getTime();
  if (!Number.isFinite(t)) return undefined;
  return endExclusive ? t + 86_400_000 : t;
}

function fmtDate(ms?: number): string {
  if (!ms) return "—";
  try { return new Date(ms).toISOString().slice(0, 10); } catch { return "—"; }
}

export function filterSummary(dept: string, shift: string, since?: number, until?: number): string {
  const parts: string[] = [];
  if (dept) parts.push(`dept "${dept}"`);
  if (shift) parts.push(`shift "${shift}"`);
  if (since != null) parts.push(`from ${fmtDate(since)}`);
  if (until != null) parts.push(`through ${fmtDate(until - 86_400_000)}`);
  return parts.length ? ` for ${parts.join(" · ")}` : "";
}

function frag(node: unknown): Response {
  return new Response(renderToString(node as never), { headers: { "content-type": "text/html" } });
}

/** Pure render of the preview / commit / empty fragment — exported for tests. */
export function renderManagerQueueClear(
  result: ClearResult,
  opts: { commit: boolean; summary: string },
) {
  const { commit, summary } = opts;
  if (commit) {
    return (
      <div class="placeholder-card" style="border-color:var(--green);color:var(--green);">
        ✓ Cleared <strong>{result.deleted}</strong> manager-queue item{result.deleted === 1 ? "" : "s"}{summary}.
      </div>
    );
  }
  if (result.matched === 0) {
    return (
      <div class="placeholder-card">
        No items match{summary} — nothing to clear. ({result.total} in the queue.)
      </div>
    );
  }
  return (
    <div>
      <div style="margin-bottom:8px;font-size:12px;">
        <strong>{result.matched}</strong> of {result.total} queue items match{summary}.
        {result.matched > result.sample.length ? ` Showing first ${result.sample.length}.` : ""}
      </div>
      <table class="data-table">
        <thead><tr><th>Finding</th><th>Agent</th><th>Dept</th><th>Shift</th><th>Audit date</th></tr></thead>
        <tbody>
          {result.sample.map((m) => (
            <tr key={m.findingId}>
              <td class="mono">{m.findingId.slice(0, 10)}</td>
              <td>{m.owner ?? "—"}</td>
              <td>{m.department ?? "—"}</td>
              <td>{m.shift ?? "—"}</td>
              <td>{fmtDate(m.date)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        class="sf-btn danger"
        style="margin-top:10px;padding:8px 16px;"
        hx-post="/api/admin/manager-queue-clear"
        hx-include="#mq-dept,#mq-shift,#mq-since,#mq-until"
        hx-vals='{"mode":"commit"}'
        hx-target="#maint-msg"
        hx-swap="innerHTML"
        hx-confirm={`Permanently clear ${result.matched} manager-queue item${result.matched === 1 ? "" : "s"}${summary}? This cannot be undone.`}
      >Clear {result.matched} item{result.matched === 1 ? "" : "s"}</button>
    </div>
  );
}

export const handler = define.handlers({
  async POST(ctx) {
    const body = await parseHtmxBody(ctx.req);
    const department = String(body.department ?? "").trim();
    const shift = String(body.shift ?? "").trim();
    const since = dayMs(String(body.since ?? ""));
    const until = dayMs(String(body.until ?? ""), true);
    const commit = String(body.mode ?? "") === "commit";
    const summary = filterSummary(department, shift, since, until);

    const filters: Record<string, unknown> = { dryRun: !commit };
    if (department) filters.department = department;
    if (shift) filters.shift = shift;
    if (since != null) filters.since = since;
    if (until != null) filters.until = until;

    let result: ClearResult;
    try {
      result = await apiPost<ClearResult>("/manager/api/queue/clear", ctx.req, filters);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const friendly = msg.includes("at least one filter")
        ? "Pick at least one filter (department, shift, or a date range) before previewing."
        : "Failed to run — see logs.";
      return frag(<div class="placeholder-card error-text">{friendly}</div>);
    }

    return frag(renderManagerQueueClear(result, { commit, summary }));
  },
});
