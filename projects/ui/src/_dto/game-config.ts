export interface GameConfig {
  threshold?: number;
  comboTimeoutMs?: number;
  enabled?: boolean;
  sounds?: Record<string, string>;
}

export const REVIEWER_LEVEL_THRESHOLDS = [0, 100, 300, 600, 1100, 2000, 3500, 5500, 8000, 12000];
export const MANAGER_LEVEL_THRESHOLDS = [0, 100, 300, 600, 1000, 1500, 2200, 3200, 4500, 6500];

export const STREAKS = [
  { at: 2, label: "DOUBLE KILL", cls: "s-double" },
  { at: 3, label: "TRIPLE KILL", cls: "s-triple" },
  { at: 4, label: "MEGA KILL", cls: "s-mega" },
  { at: 5, label: "ULTRA KILL", cls: "s-ultra" },
  { at: 6, label: "RAMPAGE", cls: "s-rampage" },
  { at: 7, label: "GODLIKE", cls: "s-godlike" },
] as const;

export const SKIP_TIERS = [1, 5, 10] as const;
