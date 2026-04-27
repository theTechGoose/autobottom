/** HTMX fragment — refresh agent dashboard stat cards every 10s. */
import { define } from "../../../lib/define.ts";
import { apiFetch } from "../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import { StatCard } from "../../../components/StatCard.tsx";

interface AgentStats {
  totalAudits?: number;
  avgScore?: number;
  perfectCount?: number;
}

export const handler = define.handlers({
  async GET(ctx) {
    try {
      const data = await apiFetch<AgentStats>("/agent/api/dashboard", ctx.req);
      const html = renderToString(
        <div class="stat-grid">
          <StatCard label="Total Audits" value={data.totalAudits ?? 0} color="blue" />
          <StatCard
            label="Avg Score"
            value={data.avgScore != null ? `${data.avgScore}%` : "\u2014"}
            color={data.avgScore && data.avgScore >= 90 ? "green" : data.avgScore && data.avgScore >= 70 ? "yellow" : "blue"}
          />
          <StatCard label="Perfect Scores" value={data.perfectCount ?? 0} color="green" />
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
