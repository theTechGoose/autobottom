import { Component, Input } from "@sprig/kit";

// deno-lint-ignore no-explicit-any
type AuditorRow = any;

@Component({ template: "./mod.html" })
export class AuditorStatsTable {
  @Input() auditors: AuditorRow[] = [];
}
