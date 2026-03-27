import { Component, Input } from "@sprig/kit";

const AGENT_LEVELS = [0, 50, 150, 350, 700, 1200, 2000, 3000, 4500, 7000];

@Component({ template: "./mod.html" })
export class AgentGameBar {
  @Input() level = 1;
  @Input() totalXp = 0;
  @Input() tokenBalance = 0;

  get xpForNextLevel(): number {
    const next = AGENT_LEVELS[this.level + 1];
    return next !== undefined ? next : AGENT_LEVELS[AGENT_LEVELS.length - 1];
  }

  get xpProgress(): number {
    const cur = AGENT_LEVELS[this.level] || 0;
    const next = this.xpForNextLevel;
    if (next <= cur) return 100;
    return Math.min(100, ((this.totalXp - cur) / (next - cur)) * 100);
  }
}
