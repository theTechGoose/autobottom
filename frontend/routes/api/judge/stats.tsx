/** HTMX fragment — refresh judge dashboard stat cards every 10s. */
import { define } from "../../../lib/define.ts";
import { apiFetch } from "../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import { StatCard } from "../../../components/StatCard.tsx";

interface JudgeStats { pending?: number; decided?: number; }

export const handler = define.handlers({
  async GET(ctx) {
    try {
      const stats = await apiFetch<JudgeStats>("/judge/api/dashboard", ctx.req);
      const pending = stats.pending ?? 0;
      const decided = stats.decided ?? 0;
      const html = renderToString(
        <div class="stat-grid">
          <StatCard label="Appeals Pending" value={pending} color="purple" />
          <StatCard label="Decided" value={decided} color="green" />
          <StatCard label="Total" value={pending + decided} color="blue" />
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
