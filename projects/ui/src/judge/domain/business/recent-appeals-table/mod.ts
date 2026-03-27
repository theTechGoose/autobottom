import { Component, Input } from "@sprig/kit";

// deno-lint-ignore no-explicit-any
type AppealHistoryRow = any;

@Component({ template: "./mod.html" })
export class RecentAppealsTable {
  @Input() appeals: AppealHistoryRow[] = [];

  scoreDelta(original: number, final: number): string {
    const delta = final - original;
    if (delta > 0) return `+${delta}%`;
    if (delta < 0) return `${delta}%`;
    return "0%";
  }

  deltaClass(original: number, final: number): string {
    const delta = final - original;
    if (delta > 0) return "green";
    if (delta < 0) return "red";
    return "blue";
  }
}
