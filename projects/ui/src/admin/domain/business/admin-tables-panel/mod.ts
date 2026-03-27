import { Component, Input } from "@sprig/kit";

// deno-lint-ignore no-explicit-any
type AnyRecord = any;

@Component({ template: "./mod.html" })
export class AdminTablesPanel {
  @Input() activeAudits: AnyRecord[] = [];
  @Input() recentErrors: AnyRecord[] = [];
  @Input() tokensByFunction: AnyRecord = null;
}
