/** Shared stat grid — rendered by dashboard SSR and /api/admin/stats refresh.
 *  Keeping both in one component prevents drift (was: refresh showed "In Pipe",
 *  SSR showed "In Pipeline"). */
import { StatCard } from "./StatCard.tsx";

interface ActiveItem { step: string; }
interface ErrorItem { step: string; }

export interface PipelineStatsShape {
  inPipe?: number;
  active?: ActiveItem[];
  completed24h?: number;
  completedCount?: number;
  errors24h?: number;
  errors?: ErrorItem[];
  retries24h?: number;
}

const ACTIVE_STEPS = ["ask-all", "cleanup", "genie-retry", "init", "prepare", "transcribe"];

export function StatGrid({ p }: { p: PipelineStatsShape }) {
  const activeList = p.active ?? [];
  const errorList = p.errors ?? [];
  const completed = p.completed24h ?? p.completedCount ?? 0;

  const steps: Record<string, number> = {};
  activeList.forEach(a => { steps[a.step] = (steps[a.step] ?? 0) + 1; });

  return (
    <div class="stat-grid">
      <StatCard label="In Pipeline" value={p.inPipe ?? 0} color="yellow" />
      <div class="stat-card blue">
        <div class="stat-label">Active</div>
        <div class="stat-value">{activeList.length}</div>
        <div class="stat-sub" style="line-height:1.6;">
          {ACTIVE_STEPS.map(s => {
            const count = steps[s] ?? 0;
            return <div key={s} style={`color:${count > 0 ? "var(--blue)" : "var(--text-dim)"};`}>{s}: {count}</div>;
          })}
        </div>
      </div>
      <StatCard label="Completed (24h)" value={completed} color="green" />
      <StatCard label="Errors (24h)" value={p.errors24h ?? errorList.length} color="red" sub={errorList.length ? `${errorList.length} unique` : "Clean"} />
      <StatCard label="Retries (24h)" value={p.retries24h ?? 0} color="yellow" />
    </div>
  );
}
