/** Polled by the dedup progress fragment every 2s. Returns either:
 *   - another self-polling fragment with updated counts (job still running)
 *   - a final-state fragment with no hx-trigger (job done or errored)
 *  The "no trigger" final state stops the poll loop on its own. */
import { define } from "../../../lib/define.ts";
import { apiFetch } from "../../../lib/api.ts";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

interface DedupStatus {
  ok: boolean;
  error?: string;
  jobId?: string;
  phase?: "scanning" | "deleting" | "done" | "error";
  total?: number;
  deleted?: number;
  failed?: number;
  startedAt?: number;
  finishedAt?: number;
  dryRun?: boolean;
  pass?: "rows" | "records";
  plan?: { scannedRows: number; findingsWithDupes: number; staleRows: number };
  recordPlan?: { recordsWithDupes: number; losers: number; chargebacksRemoved: number; wiresRemoved: number; appealSkips: number };
}

function progressBar(deleted: number, total: number): string {
  const pct = total > 0 ? Math.min(100, Math.round((deleted / total) * 100)) : 0;
  return `<div style="background:var(--bg-2);border-radius:4px;overflow:hidden;height:8px;">
    <div style="background:var(--blue);height:100%;width:${pct}%;transition:width 0.3s ease;"></div>
  </div>`;
}

export const handler = define.handlers({
  async GET(ctx) {
   try {
    const jobId = new URL(ctx.req.url).searchParams.get("jobId") ?? "";
    if (!jobId) {
      return new Response(`<div id="maint-progress"><span class="error-text">Missing jobId</span></div>`, {
        headers: { "content-type": "text/html" },
      });
    }
    let status: DedupStatus;
    try {
      status = await apiFetch<DedupStatus>(`/admin/deduplicate-status?jobId=${encodeURIComponent(jobId)}`, ctx.req);
    } catch (e) {
      // Soft fallback: the polling loop is alive, the status fetch just
      // hiccuped (typically backend FS pressure). Re-emit the polling
      // fragment so the UI keeps trying instead of going red and
      // halting. Halt only on definitive backend "job not found" below.
      const jobIdEnc = encodeURIComponent(jobId);
      return new Response(
        `<div id="maint-progress"
              hx-get="/api/admin/dedup-progress?jobId=${jobIdEnc}"
              hx-trigger="load delay:2s"
              hx-swap="outerHTML"
              style="font-size:12px;color:var(--text-dim);">
          status check failed (${escapeHtml(String(e).slice(0, 80))}) — retrying…
        </div>`,
        { headers: { "content-type": "text/html" } },
      );
    }
    if (!status.ok) {
      return new Response(
        `<div id="maint-progress"><span class="error-text">${escapeHtml(status.error ?? "unknown error")}</span></div>`,
        { headers: { "content-type": "text/html" } },
      );
    }

    const { phase, total = 0, deleted = 0, failed = 0, plan, recordPlan, pass, error, dryRun, startedAt, finishedAt } = status;
    const isRecords = pass === "records";
    const elapsedSec = startedAt ? Math.round(((finishedAt ?? Date.now()) - startedAt) / 1000) : 0;

    // Final states — no hx-trigger so polling stops.
    if (phase === "error") {
      return new Response(
        `<div id="maint-progress" style="font-size:12px;color:var(--red);display:grid;gap:6px;">
          <div><strong>Failed.</strong> ${escapeHtml(error ?? "unknown error")}</div>
        </div>`,
        { headers: { "content-type": "text/html" } },
      );
    }
    if (phase === "done") {
      const lines: string[] = [];
      // Unmistakable mode banner — a dry run must never be mistakable for a real
      // delete (the original "Done in 1s" confusion was exactly this).
      if (isRecords) {
        lines.push(dryRun
          ? `<div style="display:inline-block;background:rgba(245,158,11,0.15);color:var(--amber,#f59e0b);border:1px solid var(--amber,#f59e0b);border-radius:4px;padding:3px 10px;font-weight:700;font-size:11px;">DRY RUN — nothing was retired</div>`
          : `<div style="display:inline-block;background:rgba(34,197,94,0.15);color:var(--green);border:1px solid var(--green);border-radius:4px;padding:3px 10px;font-weight:700;font-size:11px;">EXECUTED — duplicate audits retired</div>`);
        if (recordPlan) lines.push(`<div><strong>Records audited more than once:</strong> ${recordPlan.recordsWithDupes}</div>`);
        if (dryRun) {
          lines.push(`<div><strong>Would retire:</strong> ${total} duplicate audits — re-run with <strong>Mode = Execute</strong>. Each record keeps one; losers stripped from payroll + queues, raw audit kept.</div>`);
        } else {
          lines.push(`<div><strong>Retired:</strong> ${deleted} / ${total} duplicate audits${
            failed > 0 ? ` <span style="color:var(--red);font-weight:700;">(⚠️ ${failed} failed — re-run to retry)</span>` : ""
          }</div>`);
          if (recordPlan) lines.push(`<div style="color:var(--text-dim);font-size:11px;">Removed ${recordPlan.chargebacksRemoved} chargeback + ${recordPlan.wiresRemoved} wire payroll rows.</div>`);
        }
        if (recordPlan?.appealSkips) lines.push(`<div style="color:var(--amber,#f59e0b);font-size:11px;">${recordPlan.appealSkips} record(s) skipped — pending appeal.</div>`);
        lines.push(`<div style="color:var(--text-dim);font-size:11px;">Only records with 2+ audits inside the window are detected — widen the range for a full sweep.</div>`);
      } else {
        lines.push(dryRun
          ? `<div style="display:inline-block;background:rgba(245,158,11,0.15);color:var(--amber,#f59e0b);border:1px solid var(--amber,#f59e0b);border-radius:4px;padding:3px 10px;font-weight:700;font-size:11px;">DRY RUN — nothing was removed</div>`
          : `<div style="display:inline-block;background:rgba(34,197,94,0.15);color:var(--green);border:1px solid var(--green);border-radius:4px;padding:3px 10px;font-weight:700;font-size:11px;">EXECUTED — duplicate rows removed</div>`);
        if (plan) {
          lines.push(`<div><strong>Scanned:</strong> ${plan.scannedRows} index rows</div>`);
          lines.push(`<div><strong>Findings with duplicate rows:</strong> ${plan.findingsWithDupes}</div>`);
        }
        if (dryRun) {
          lines.push(`<div><strong>Would remove:</strong> ${total} stale rows — re-run with <strong>Mode = Execute</strong> to actually remove them. Each finding keeps one row (never hidden).</div>`);
        } else {
          lines.push(`<div><strong>Removed:</strong> ${deleted} / ${total} stale rows${
            failed > 0 ? ` <span style="color:var(--red);font-weight:700;">(⚠️ ${failed} failed — re-run to retry)</span>` : ""
          }</div>`);
        }
        lines.push(`<div style="color:var(--text-dim);font-size:11px;">Counts only dupes whose rows both fall in the window — widen the range for a full sweep.</div>`);
      }
      lines.push(`<div style="color:var(--text-dim);font-size:11px;">Done in ${elapsedSec}s.</div>`);
      const color = (!dryRun && failed > 0) ? "var(--text-bright)" : "var(--green)";
      return new Response(
        `<div id="maint-progress" style="font-size:12px;color:${color};display:grid;gap:6px;">${lines.join("")}</div>`,
        { headers: { "content-type": "text/html" } },
      );
    }

    // Still running — re-emit polling fragment.
    const phaseLabel = phase === "scanning" ? "Scanning index rows…"
      : phase === "deleting"
        ? (isRecords ? `Retiring duplicate audits… ${deleted} / ${total}` : `Removing stale rows… ${deleted} / ${total}`)
        : "Running…";
    const bar = phase === "deleting" && total > 0
      ? progressBar(deleted, total)
      : `<div style="background:var(--bg-2);border-radius:4px;height:8px;overflow:hidden;position:relative;">
          <div style="background:var(--blue);height:100%;width:30%;animation:dedup-pulse 1.4s ease-in-out infinite;"></div>
        </div>
        <style>@keyframes dedup-pulse { 0%,100% { transform: translateX(-30%); } 50% { transform: translateX(330%); } }</style>`;

    return new Response(
      `<div id="maint-progress"
            hx-get="/api/admin/dedup-progress?jobId=${encodeURIComponent(jobId)}"
            hx-trigger="load delay:2s"
            hx-swap="outerHTML"
            style="font-size:12px;color:var(--text-dim);display:grid;gap:6px;">
        <div><strong>${escapeHtml(phaseLabel)}</strong> <span style="color:var(--text-dim);font-size:11px;">(${elapsedSec}s)</span></div>
        ${bar}
      </div>`,
      { headers: { "content-type": "text/html" } },
    );
   } catch (e) {
    // Outer guard. Anything that escapes inner blocks (URL parsing, weird
    // request, unexpected throw) shouldn't 500 the dedup poll — emit a
    // self-polling retry fragment so the UI keeps going.
    console.warn(`[FRAGMENT] dedup-progress fell through to fallback:`, e);
    const jobIdEnc = encodeURIComponent(new URL(ctx.req.url).searchParams.get("jobId") ?? "");
    return new Response(
      `<div id="maint-progress"
            hx-get="/api/admin/dedup-progress?jobId=${jobIdEnc}"
            hx-trigger="load delay:2s"
            hx-swap="outerHTML"
            style="font-size:11px;color:var(--text-dim);">
        progress check failed — retrying…
      </div>`,
      { headers: { "content-type": "text/html" } },
    );
   }
  },
});
