/** HTMX fragment — refresh manager stat cards every 10s. */
import { define } from "../../../lib/define.ts";
import { apiFetch } from "../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import { StatCard } from "../../../components/StatCard.tsx";

interface ManagerStats { total?: number; pending?: number; remediated?: number; }
interface AgentList { agents?: { email: string }[]; }

export const handler = define.handlers({
  async GET(ctx) {
    try {
      const [stats, agents] = await Promise.all([
        apiFetch<ManagerStats>("/manager/api/stats", ctx.req),
        apiFetch<AgentList>("/manager/api/agents", ctx.req),
      ]);
      const html = renderToString(
        <div class="stat-grid">
          <StatCard label="Total" value={stats.total ?? 0} color="blue" />
          <StatCard label="Pending" value={stats.pending ?? 0} color="yellow" />
          <StatCard label="Remediated" value={stats.remediated ?? 0} color="green" />
          <StatCard label="Agents" value={agents.agents?.length ?? 0} color="purple" />
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
