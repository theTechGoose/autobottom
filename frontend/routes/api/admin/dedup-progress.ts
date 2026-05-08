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
  startedAt?: number;
  finishedAt?: number;
  dryRun?: boolean;
  plan?: { scanned: number; groups: number; orphaned: number };
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

    const { phase, total = 0, deleted = 0, plan, error, dryRun, startedAt, finishedAt } = status;
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
      if (plan) {
        lines.push(`<div><strong>Scanned:</strong> ${plan.scanned}</div>`);
        lines.push(`<div><strong>Duplicate groups:</strong> ${plan.groups}</div>`);
        if (plan.orphaned > 0) lines.push(`<div><strong>Orphaned:</strong> ${plan.orphaned}</div>`);
      }
      if (dryRun) {
        lines.push(`<div><strong>Would delete:</strong> ${total} (dry run — re-run with Execute checked to actually delete)</div>`);
      } else {
        lines.push(`<div><strong>Deleted:</strong> ${deleted} / ${total}</div>`);
      }
      lines.push(`<div style="color:var(--text-dim);font-size:11px;">Done in ${elapsedSec}s.</div>`);
      return new Response(
        `<div id="maint-progress" style="font-size:12px;color:var(--green);display:grid;gap:4px;">${lines.join("")}</div>`,
        { headers: { "content-type": "text/html" } },
      );
    }

    // Still running — re-emit polling fragment.
    const phaseLabel = phase === "scanning" ? "Scanning for duplicates…"
      : phase === "deleting" ? `Deleting duplicates… ${deleted} / ${total}`
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
