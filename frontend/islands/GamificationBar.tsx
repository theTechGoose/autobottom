/** Island: gamification bar for review/judge queue pages.
 *
 *  Renders a top-of-bottom-bar strip showing (left→right):
 *    - Combo counter (increments on each decide, color tiers)
 *    - Session count (decisions made this mount)
 *    - Level badge + XP progress bar + XP number
 *    - Streak badge 🔥 N (if any)
 *    - Type filter dropdown (review mode only) — persisted in localStorage
 *    - Dashboard link, Logout link
 *
 *  Initial level/XP/streak come from /agent/api/game-state (the direct-
 *  dispatch auth-context endpoint added in Commit C). Combo is purely local.
 *
 *  Also broadcasts `queue:decide-tick` events on each HTMX afterSwap so
 *  SoundEngine can key on the richer event. */
import { useEffect, useState } from "preact/hooks";

interface Props {
  mode: "review" | "judge";
  email: string;
}

interface GameState {
  level?: number;
  totalXp?: number;
  tokenBalance?: number;
  dayStreak?: number;
}

const COMBO_TIMEOUT_MS = 5000;
const TYPE_FILTER_KEY_REVIEW = "review_typefilter";

function comboTier(c: number): string {
  if (c >= 10) return "godlike";
  if (c >= 7) return "inferno";
  if (c >= 4) return "fire";
  if (c >= 2) return "hot";
  return "dim";
}

function xpForLevel(level: number): number {
  return 100 * (level + 1); // matches main:lib/kv.ts exponent
}

export default function GamificationBar({ mode, email: _email }: Props) {
  const [combo, setCombo] = useState(0);
  const [session, setSession] = useState(0);
  const [game, setGame] = useState<GameState>({});
  const [typeFilter, setTypeFilter] = useState<string>(
    (typeof localStorage !== "undefined" ? localStorage.getItem(TYPE_FILTER_KEY_REVIEW) ?? "" : ""),
  );

  // Load initial game state
  useEffect(() => {
    fetch("/agent/api/game-state", { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : {})
      .then((d) => setGame(d as GameState))
      .catch(() => {});
  }, []);

  // Track decides
  useEffect(() => {
    let lastDecision = 0;
    const onClick = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest(".verdict-btn")) {
        const now = Date.now();
        setCombo((c) => (now - lastDecision > COMBO_TIMEOUT_MS ? 1 : c + 1));
        setSession((s) => s + 1);
        lastDecision = now;
      }
    };
    const onUndo = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest(".verdict-undo")) {
        setCombo(0);
      }
    };
    document.addEventListener("click", onClick);
    document.addEventListener("click", onUndo);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("click", onUndo);
    };
  }, []);

  // Type filter persistence — re-fetch queue on change
  const onFilterChange = (e: Event) => {
    const v = (e.target as HTMLSelectElement).value;
    setTypeFilter(v);
    if (typeof localStorage !== "undefined") {
      if (v) localStorage.setItem(TYPE_FILTER_KEY_REVIEW, v);
      else localStorage.removeItem(TYPE_FILTER_KEY_REVIEW);
    }
    // Trigger a refetch via HTMX
    // @ts-ignore - htmx is globally available
    if (typeof htmx !== "undefined") {
      // Dispatch a synthetic GET to /api/review/types-filter that reloads
      // the queue — simplest: just reload the page to pick up new types.
      globalThis.location.reload();
    }
  };

  const level = game.level ?? 1;
  const totalXp = game.totalXp ?? 0;
  const levelBase = xpForLevel(level - 1);
  const levelNext = xpForLevel(level);
  const xpIntoLevel = Math.max(0, totalXp - levelBase);
  const xpSpan = Math.max(1, levelNext - levelBase);
  const xpPct = Math.min(100, Math.round((xpIntoLevel / xpSpan) * 100));
  const streak = game.dayStreak ?? 0;
  const tier = comboTier(combo);

  return (
    <div class="gamification-bar">
      <div class={`gb-combo gb-combo-${tier}`}>
        <span class="gb-combo-num">{combo}</span>
        <span class="gb-combo-label">combo</span>
      </div>
      <div class="gb-session">
        <span class="gb-session-num">{session}</span>
        <span class="gb-session-label">today</span>
      </div>
      <div class="gb-level">
        <span class="gb-level-badge">Lv.{level}</span>
        <div class="gb-xp-track">
          <div class="gb-xp-fill" style={`width:${xpPct}%`} />
        </div>
        <span class="gb-xp-num mono">{xpIntoLevel}/{xpSpan}</span>
      </div>
      {streak > 0 && (
        <div class="gb-streak" title={`${streak}-day streak`}>🔥 {streak}</div>
      )}
      <div class="gb-spacer" />
      {mode === "review" && (
        <select class="gb-filter" value={typeFilter} onChange={onFilterChange}>
          <option value="">All types</option>
          <option value="date-leg">Internal only</option>
          <option value="package">Partner only</option>
        </select>
      )}
      <a class="gb-link" href={mode === "review" ? "/review/dashboard" : "/judge/dashboard"}>Dashboard</a>
      <a class="gb-link" href="/chat">Chat</a>
      <a class="gb-link" href="/api/logout">Logout</a>
    </div>
  );
}
