import { Component, Input } from "@sprig/kit";

// deno-lint-ignore no-explicit-any
type DecisionRow = any;

@Component({ template: "./mod.html" })
export class RecentDecisionsTable {
  @Input() decisions: DecisionRow[] = [];
}
