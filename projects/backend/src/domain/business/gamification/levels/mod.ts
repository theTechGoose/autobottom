/** Unified game state for ALL roles. totalXp always increases; tokenBalance is spendable. */
export interface GameState {
  totalXp: number;
  tokenBalance: number;
  level: number;
  dayStreak: number;
  lastActiveDate: string;
  purchases: string[];
  equippedTitle: string | null;
  equippedTheme: string | null;
  animBindings: Record<string, string>; // prefab event type -> animation ID
}

export const DEFAULT_GAME_STATE: GameState = {
  totalXp: 0,
  tokenBalance: 0,
  level: 0,
  dayStreak: 0,
  lastActiveDate: "",
  purchases: [],
  equippedTitle: null,
  equippedTheme: null,
  animBindings: {},
};

export const LEVEL_THRESHOLDS = [0, 100, 300, 600, 1000, 1500, 2200, 3200, 4500, 6500];
export const AGENT_LEVEL_THRESHOLDS = [0, 50, 150, 350, 700, 1200, 2000, 3000, 4500, 7000];

export class LevelService {
  getLevel(xp: number, thresholds: number[] = LEVEL_THRESHOLDS): number {
    for (let i = thresholds.length - 1; i >= 0; i--) {
      if (xp >= thresholds[i]) return i;
    }
    return 0;
  }
}

// Old API preserved as wrappers
const _svc = new LevelService();
export function getLevel(
  ...args: Parameters<LevelService["getLevel"]>
): number {
  return _svc.getLevel(...args);
}
