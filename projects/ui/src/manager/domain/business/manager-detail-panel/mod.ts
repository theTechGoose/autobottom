import { Component, Input } from "@sprig/kit";

@Component({ template: "./mod.html" })
export class ManagerDetailPanel {
  // deno-lint-ignore no-explicit-any
  @Input() detail: any = null;
  @Input() transcriptOpen: boolean = false;
}
