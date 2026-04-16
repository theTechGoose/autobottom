/** Shared Review Queue panel — rendered by dashboard SSR and /api/admin/dashboard/review refresh. */

export interface ReviewStatsShape {
  pending?: number;
  decided?: number;
  pendingAuditCount?: number;
  dateLegPending?: number;
  dateLegDecided?: number;
  packagePending?: number;
  packageDecided?: number;
}

export function ReviewQueuePanel({ r }: { r: ReviewStatsShape }) {
  // Production sends dateLeg/package split; we fall back to single 'pending'/'decided' if absent.
  const dlPending = r.dateLegPending ?? r.pending ?? 0;
  const dlDecided = r.dateLegDecided ?? r.decided ?? 0;
  const pkgPending = r.packagePending ?? 0;
  const pkgDecided = r.packageDecided ?? 0;

  return (
    <>
      <div class="panel-title" style="display:flex;justify-content:space-between;align-items:center;">
        <span>Review Queue</span>
        <button class="sf-btn danger" hx-post="/api/admin/queue-action" hx-vals='{"action":"clear-review"}' hx-swap="none" hx-confirm="Clear the review queue?" style="padding:3px 10px;font-size:9px;">Clear Queue</button>
      </div>
      <table class="data-table" style="margin-top:10px;">
        <thead><tr><th></th><th>Pending</th><th>Decided</th></tr></thead>
        <tbody>
          <tr style="cursor:pointer;" hx-get="/api/admin/review-drill?type=internal" hx-target="#review-drill" hx-swap="innerHTML">
            <td style="font-weight:600;color:var(--text-bright);">Internal</td>
            <td class="mono" style="color:var(--yellow);font-variant-numeric:tabular-nums;">{dlPending}</td>
            <td class="mono" style="color:var(--green);font-variant-numeric:tabular-nums;">{dlDecided}</td>
          </tr>
          <tr style="cursor:pointer;" hx-get="/api/admin/review-drill?type=partner" hx-target="#review-drill" hx-swap="innerHTML">
            <td style="font-weight:600;color:var(--text-bright);">Partner</td>
            <td class="mono" style="color:var(--yellow);font-variant-numeric:tabular-nums;">{pkgPending}</td>
            <td class="mono" style="color:var(--green);font-variant-numeric:tabular-nums;">{pkgDecided}</td>
          </tr>
        </tbody>
      </table>
      <div id="review-drill"></div>
    </>
  );
}
