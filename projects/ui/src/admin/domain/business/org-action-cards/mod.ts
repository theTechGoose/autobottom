import { Component, Input } from "@sprig/kit";

// deno-lint-ignore no-explicit-any
type AnyRecord = any;

@Component({ template: "./mod.html", island: true })
export class OrgActionCards {
  @Input() selectedOrg: AnyRecord = null;

  loading: Record<string, boolean> = {};

  seed() {
    // Coordinator handles API call
  }

  wipe() {
    // Coordinator handles API call
  }

  deleteOrg() {
    // Coordinator handles API call
  }

  impersonate() {
    // Coordinator handles API call
  }
}
