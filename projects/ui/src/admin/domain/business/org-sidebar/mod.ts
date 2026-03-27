import { Component, Input } from "@sprig/kit";

// deno-lint-ignore no-explicit-any
type AnyRecord = any;

@Component({ template: "./mod.html", island: true })
export class OrgSidebar {
  @Input() orgs: AnyRecord[] = [];
  @Input() selectedOrg: AnyRecord = null;

  newOrgName: string = "";

  createOrg() {
    // Coordinator handles API call
  }
}
