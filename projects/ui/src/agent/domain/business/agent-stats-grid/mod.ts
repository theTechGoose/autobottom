import { Component, Input } from "@sprig/kit";

@Component({ template: "./mod.html" })
export class AgentStatsGrid {
  @Input() totalAudits = 0;
  @Input() averageScore = 0;
  @Input() thisWeek = 0;
  @Input() completionRate: string = "--";
}
