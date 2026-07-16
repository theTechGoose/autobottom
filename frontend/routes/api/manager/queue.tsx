/** HTMX fragment — refresh manager queue table. The table markup is exported
 *  as `renderQueueTable` (pure) so it can be unit-tested directly, mirroring
 *  `renderAuditHistoryTable` in audit-history.tsx. */
import { define } from "../../../lib/define.ts";
import { apiFetch } from "../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import type { JSX } from "preact";

/** Mirrors the backend `ManagerQueueItem` shape (manager-repository/mod.ts):
 *  the queue carries `owner` + `failedCount`/`totalQuestions`, NOT a precomputed
 *  agentEmail/score. Derive the displayed score here. */
export interface QueueItem {
  findingId: string;
  owner?: string;
  voName?: string;
  status?: string;
  failedCount?: number;
  totalQuestions?: number;
  failedQuestions?: string[];
  wgs?: boolean;
  mcc?: boolean;
  department?: string;
  shift?: string;
  isPackage?: boolean;
}

/** Team member display name: enriched voName first, then a real owner email's
 *  local-part — never the "api" placeholder the pipeline writes for API audits. */
function teamMemberLabel(item: QueueItem): string {
  if (item.voName) return item.voName;
  if (item.owner && item.owner !== "api") return item.owner.split("@")[0];
  return "—";
}

function pillColor(score: number | null) {
  if (score == null) return "blue";
  if (score >= 90) return "green";
  if (score >= 70) return "yellow";
  return "red";
}

/** Pass-rate from failed/total. Returns null when total is unknown so the
 *  cell falls back to a "N failed" label instead of a misleading 0%/100%. */
function scoreOf(item: QueueItem): number | null {
  if (item.totalQuestions == null || item.totalQuestions <= 0) return null;
  const failed = item.failedCount ?? 0;
  // Clamp to [0,100] so a backend that ever reports failed > total (or a
  // stray negative) can't render a -10% / 110% pill.
  return Math.max(0, Math.min(100, Math.round((1 - failed / item.totalQuestions) * 100)));
}

/** Pure render of the queue table. Team Member = enriched voName (never the
 *  raw "api" owner token); Failed Questions = first two + a "+N more" hint;
 *  Score = derived pass-rate (or a "N failed" fallback when totals are unknown). */
export function renderQueueTable(items: QueueItem[]): JSX.Element {
  return (
    <table class="data-table">
      <thead><tr><th>Finding</th><th>Team Member</th><th>Dept / Shift</th><th>Failed Questions</th><th>Sale</th><th>Score</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>
        {items.length === 0 ? (
          <tr class="empty-row"><td colSpan={8}>No items in queue</td></tr>
        ) : items.map((item) => {
          const score = scoreOf(item);
          // Name the three Score states (derived pass-rate / 'N failed' / em-dash)
          // instead of nesting a two-level ternary inside the <td>.
          const scoreCell = score != null
            ? <span class={`pill pill-${pillColor(score)}`}>{score}%</span>
            : item.failedCount != null
              ? <span class="pill pill-red">{item.failedCount} failed</span>
              : "\u2014";
          const fails = item.failedQuestions ?? [];
          const failsCell = fails.length === 0
            ? <span style="color:var(--text-dim);font-size:11px;">\u2014</span>
            : (
              <div style="font-size:11px;color:var(--text-muted);max-width:420px;">
                {fails.slice(0, 2).map((q) => (
                  <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{q}</div>
                ))}
                {fails.length > 2 && <div style="color:var(--text-dim);">+{fails.length - 2} more</div>}
              </div>
            );
          // WGS/MCC sale tags; dim dash for none-sold or not-yet-enriched rows.
          const saleTags = [
            ...(item.wgs ? ["WGS"] : []),
            ...(item.mcc ? ["MCC"] : []),
          ];
          const saleCell = saleTags.length === 0
            ? <span style="color:var(--text-dim);font-size:11px;">—</span>
            : <span>{saleTags.map((t) => <span class={`pill pill-${t === "WGS" ? "green" : "blue"}`} style="margin-right:4px;">{t}</span>)}</span>;
          return (
          <tr
            key={item.findingId}
            style="cursor:pointer;"
            hx-get={`/api/manager/finding?findingId=${encodeURIComponent(item.findingId)}`}
            hx-target="#finding-detail-content"
            hx-swap="innerHTML"
            hx-trigger="click"
            {...{ "hx-on:click": "document.getElementById('finding-detail-modal')?.classList.add('open')" }}
          >
            <td class="mono">{item.findingId?.slice(0, 8)}</td>
            <td>{teamMemberLabel(item)}</td>
            <td style="font-size:11px;color:var(--text-muted);white-space:nowrap;">
              {item.department || "—"}{item.shift ? ` · ${item.shift}` : ""}
            </td>
            <td>{failsCell}</td>
            <td>{saleCell}</td>
            <td>{scoreCell}</td>
            <td><span class={`pill pill-${item.status === "remediated" ? "green" : "yellow"}`}>{item.status ?? "pending"}</span></td>
            <td {...{ "hx-on:click": "event.stopPropagation()" }}>
              {/* Carry the id on a data-attribute (Preact attribute-escapes it)
                  and read it via this.dataset \u2014 never inline it into the JS
                  string, where a `'` would break out of the literal. */}
              <button
                class="btn btn-ghost btn-sm"
                data-finding-id={item.findingId}
                {...{ "hx-on:click": "event.stopPropagation();document.getElementById('remediate-modal')?.classList.add('open');document.getElementById('rem-findingId').value=this.dataset.findingId" }}
              >Remediate</button>
            </td>
          </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export const handler = define.handlers({
  async GET(ctx) {
    try {
      // Forward `as` so an admin impersonating a manager (?as=<email>) gets
      // that manager's scoped queue — same convention as audit-history.
      const asEmail = new URL(ctx.req.url).searchParams.get("as");
      const qs = asEmail ? `?as=${encodeURIComponent(asEmail)}` : "";
      const { items } = await apiFetch<{ items: QueueItem[] }>(`/manager/api/queue${qs}`, ctx.req);
      const html = renderToString(renderQueueTable(items ?? []));
      return new Response(html, { headers: { "content-type": "text/html" } });
    } catch {
      return new Response(
        `<div class="placeholder-card">Failed to load queue</div>`,
        { headers: { "content-type": "text/html" } },
      );
    }
  },
});
