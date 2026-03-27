import { Component, Input } from "@sprig/kit";

@Component({ template: "./mod.html" })
export class ManagerStatsBar {
  @Input() outstanding: number = 0;
  @Input() addressedThisWeek: number = 0;
  @Input() totalAudits: number = 0;
  @Input() avgResolution: string = "--";
}
