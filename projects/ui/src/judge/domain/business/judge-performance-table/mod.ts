import { Component, Input } from "@sprig/kit";

// deno-lint-ignore no-explicit-any
type JudgeRow = any;

@Component({ template: "./mod.html" })
export class JudgePerformanceTable {
  @Input() judges: JudgeRow[] = [];

  overturnPct(overturns: number, decisions: number): string {
    if (decisions <= 0) return "0.0";
    return ((overturns / decisions) * 100).toFixed(1);
  }
}
