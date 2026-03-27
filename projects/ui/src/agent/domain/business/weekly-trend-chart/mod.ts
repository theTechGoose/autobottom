import { Component, Input } from "@sprig/kit";

@Component({ template: "./mod.html" })
export class WeeklyTrendChart {
  @Input() weeklyData: { label: string; value: number }[] = [];

  get maxValue(): number {
    if (this.weeklyData.length === 0) return 0;
    return Math.max(...this.weeklyData.map((d) => d.value));
  }
}
