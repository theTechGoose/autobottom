/** Shared stat grid — rendered by dashboard SSR and /api/admin/stats refresh.
 *  Keeping both in one component prevents drift (was: refresh showed "In Pipe",
 *  SSR showed "In Pipeline"). */
import { StatCard } from "./StatCard.tsx";

interface ActiveItem { step: string; }
interface ErrorItem { step: string; recovered?: boolean; }

export interface PipelineStatsShape {
  inPipe?: number;
  active?: ActiveItem[];
  completed24h?: number;
  completedCount?: number;
  errors24h?: number;
  /** Authoritative count of non-recovered faults in the 24h window, computed
   *  backend-side in getStats over the full error set (the row list has an
   *  8-day TTL and isn't the 24h set). Preferred for the red headline number. */
  genuineErrors24h?: number;
  /** Companion 24h count of recovered (self-healed) rows, so the "M recovered"
   *  sub-label lives in the same window as genuineErrors24h. */
  recoveredErrors24h?: number;
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

  // Red count = genuine (non-"recovered") faults only — see
  // stats-repository.isFindingRecovered. Both the fault value and the recovered
  // sub-count prefer the backend's authoritative 24h numbers; when those are
  // absent both derive from the display row list, so the value and the
  // "M recovered" label always sit in the same window as each other. (Final
  // fallback: pre-aggregated errors24h when no detailed rows were delivered.)
  const rowRecovered = errorList.filter(e => e.recovered).length;
  const recoveredErrors = p.recoveredErrors24h ?? rowRecovered;
  const errorValue = p.genuineErrors24h
    ?? (errorList.length ? errorList.length - rowRecovered : (p.errors24h ?? 0));
  // sub: "M recovered" when any self-healed; else "N unique" faults; else "Clean".
  const errorSub = recoveredErrors
    ? `${recoveredErrors} recovered`
    : (errorValue ? `${errorValue} unique` : "Clean");

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
      <StatCard label="Errors (24h)" value={errorValue} color="red" sub={errorSub} />
      <StatCard label="Retries (24h)" value={p.retries24h ?? 0} color="yellow" />
    </div>
  );
}
