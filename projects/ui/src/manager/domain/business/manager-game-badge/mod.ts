import { Component, Input } from "@sprig/kit";

const MANAGER_LEVEL_THRESHOLDS = [0, 100, 300, 600, 1000, 1500, 2200, 3200, 4500, 6500];

@Component({ template: "./mod.html" })
export class ManagerGameBadge {
  @Input() level: number = 1;
  @Input() totalXp: number = 0;
  @Input() tokenBalance: number = 0;
  @Input() badges: string[] = [];

  get xpForNextLevel(): number {
    const idx = this.level + 1;
    if (idx >= MANAGER_LEVEL_THRESHOLDS.length) {
      return MANAGER_LEVEL_THRESHOLDS[MANAGER_LEVEL_THRESHOLDS.length - 1];
    }
    return MANAGER_LEVEL_THRESHOLDS[idx];
  }

  get xpProgress(): number {
    const cur = MANAGER_LEVEL_THRESHOLDS[this.level] ?? 0;
    const next = MANAGER_LEVEL_THRESHOLDS[this.level + 1]
      ?? MANAGER_LEVEL_THRESHOLDS[MANAGER_LEVEL_THRESHOLDS.length - 1];
    if (next <= cur) return 100;
    return Math.min(100, ((this.totalXp - cur) / (next - cur)) * 100);
  }
}
