import { Component, Input } from "@sprig/kit";

// deno-lint-ignore no-explicit-any
type ReviewerRow = any;

@Component({ template: "./mod.html" })
export class ReviewerPerformanceTable {
  @Input() reviewers: ReviewerRow[] = [];
}
