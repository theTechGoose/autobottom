/** HTMX fragment — refresh review dashboard stat cards every 10s. */
import { define } from "../../../lib/define.ts";
import { apiFetch } from "../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import { StatCard } from "../../../components/StatCard.tsx";

interface ReviewStats { pending?: number; decided?: number; pendingAuditCount?: number; }

export const handler = define.handlers({
  async GET(ctx) {
    try {
      const stats = await apiFetch<ReviewStats>("/review/api/dashboard", ctx.req);
      const pending = stats.pending ?? 0;
      const decided = stats.decided ?? 0;
      const total = pending + decided;
      const confirmRate = total > 0 ? Math.round((decided / total) * 100) : 0;
      const html = renderToString(
        <div class="stat-grid">
          <StatCard label="Queue Pending" value={pending} color="purple" sub={`${stats.pendingAuditCount ?? 0} audits`} />
          <StatCard label="Decided" value={decided} color="green" />
          <StatCard label="Total Processed" value={total} color="blue" />
          <StatCard label="Decision Rate" value={`${confirmRate}%`} color={confirmRate >= 90 ? "green" : "yellow"} />
        </div>,
      );
      return new Response(html, { headers: { "content-type": "text/html" } });
    } catch {
      return new Response(
        `<div class="stat-grid"><div class="placeholder-card">Failed to load stats</div></div>`,
        { headers: { "content-type": "text/html" } },
      );
    }
  },
});
