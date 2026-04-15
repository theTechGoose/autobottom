/** HTMX fragment — returns refreshed stat cards HTML for dashboard auto-refresh. */
import { define } from "../../../lib/define.ts";
import { apiFetch } from "../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import { StatCard } from "../../../components/StatCard.tsx";

export const handler = define.handlers({
  async GET(ctx) {
    try {
      const data = await apiFetch<{ pipeline: Record<string, unknown>; review: Record<string, unknown> }>(
        "/admin/dashboard/data", ctx.req,
      );
      const p = data.pipeline as { inPipe?: number; active?: unknown[]; completed24h?: number; errors24h?: number; errors?: unknown[]; retries24h?: number };
      const r = data.review as { pending?: number; decided?: number; pendingAuditCount?: number };

      const html = renderToString(
        <div class="stat-grid">
          <StatCard label="In Pipe" value={p.inPipe ?? 0} color="blue" sub={`${p.active?.length ?? 0} active`} />
          <StatCard label="Completed 24h" value={p.completed24h ?? 0} color="green" />
          <StatCard label="Errors 24h" value={p.errors24h ?? 0} color="red" sub={p.errors24h ? `${p.errors?.length ?? 0} unique` : "Clean"} />
          <StatCard label="Retries 24h" value={p.retries24h ?? 0} color="yellow" />
          <StatCard label="Review Pending" value={r.pending ?? 0} color="purple" sub={`${r.pendingAuditCount ?? 0} audits`} />
          <StatCard label="Decided" value={r.decided ?? 0} color="green" />
        </div>
      );
      return new Response(html, { headers: { "content-type": "text/html" } });
    } catch {
      return new Response(`<div class="stat-grid"><div class="placeholder-card">Failed to load stats</div></div>`, {
        headers: { "content-type": "text/html" },
      });
    }
  },
});
