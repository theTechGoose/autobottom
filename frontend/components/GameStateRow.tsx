/** GameStateRow — three card row: XP / Level (with progress bar to next),
 *  Streak, Badges. Drop into any role dashboard. SSR-only; pass the
 *  user's resolved game state + earned badge list.
 *
 *  All inputs are optional so the row can render zero state when a user
 *  hasn't accrued anything yet. */

import {
  LEVEL_THRESHOLDS, AGENT_LEVEL_THRESHOLDS,
} from "@gamification/domain/business/badge-system/mod.ts";

interface GameStateRowProps {
  role: "user" | "reviewer" | "judge" | "manager";
  totalXp?: number;
  level?: number;
  dayStreak?: number;
  earnedBadgeCount?: number;
  accent?: string;
}

function nextThreshold(xp: number, thresholds: number[]): { current: number; next: number | null } {
  let current = 0;
  let next: number | null = null;
  for (let i = 0; i < thresholds.length; i++) {
    if (xp >= thresholds[i]) {
      current = thresholds[i];
    } else {
      next = thresholds[i];
      break;
    }
  }
  return { current, next };
}

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent: string }) {
  return (
    <div style={`flex:1;min-width:160px;border:1px solid var(--border);border-radius:8px;padding:12px 14px;background:var(--bg);`}>
      <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">{label}</div>
      <div style={`font-size:22px;font-weight:700;color:${accent};line-height:1.2;`}>{value}</div>
      {sub && <div style="font-size:11px;color:var(--text-dim);margin-top:2px;">{sub}</div>}
    </div>
  );
}

export function GameStateRow(props: GameStateRowProps) {
  const accent = props.accent ?? "var(--accent)";
  const xp = props.totalXp ?? 0;
  const level = props.level ?? 0;
  const dayStreak = props.dayStreak ?? 0;
  const badgeCount = props.earnedBadgeCount ?? 0;

  const thresholds = props.role === "user" ? AGENT_LEVEL_THRESHOLDS : LEVEL_THRESHOLDS;
  const { current, next } = nextThreshold(xp, thresholds);
  const pctToNext = next == null ? 100 : Math.max(0, Math.min(100, Math.round(((xp - current) / (next - current)) * 100)));

  const xpSub = next == null
    ? "Max level"
    : `Level ${level + 1} in ${(next - xp).toLocaleString()} XP`;

  return (
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;">
      <div style={`flex:1;min-width:240px;border:1px solid var(--border);border-radius:8px;padding:12px 14px;background:var(--bg);`}>
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;">
          <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;">XP / Level</div>
          <div style="font-size:11px;color:var(--text-dim);font-family:var(--mono);">L{level}</div>
        </div>
        <div style={`font-size:22px;font-weight:700;color:${accent};line-height:1.2;`}>
          {xp.toLocaleString()}<span style="color:var(--text-dim);font-weight:400;font-size:13px;"> xp</span>
        </div>
        <div style="margin-top:8px;height:6px;background:var(--bg-2);border-radius:3px;overflow:hidden;">
          <div style={`height:100%;width:${pctToNext}%;background:${accent};border-radius:3px;`} />
        </div>
        <div style="font-size:11px;color:var(--text-dim);margin-top:4px;">{xpSub}</div>
      </div>

      <StatCard
        label="Day Streak"
        value={dayStreak > 0 ? `🔥 ${dayStreak}` : "—"}
        sub={dayStreak === 0 ? "Start a streak today" : dayStreak === 1 ? "Keep it going" : `${dayStreak} days in a row`}
        accent={accent}
      />

      <StatCard
        label="Badges Earned"
        value={badgeCount}
        sub={badgeCount === 0 ? "No badges yet" : badgeCount === 1 ? "1 badge collected" : `${badgeCount} badges collected`}
        accent={accent}
      />
    </div>
  );
}
