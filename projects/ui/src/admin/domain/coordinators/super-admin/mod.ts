import { Component } from "@sprig/kit";

// deno-lint-ignore no-explicit-any
type AnyData = any;

interface Toast {
  id: number;
  msg: string;
  type: "success" | "error" | "info";
}

@Component({ template: "./mod.html", island: true })
export class SuperAdminCoordinator {
  orgs: AnyData[] = [];
  selectedOrg: AnyData = null;
  toasts: Toast[] = [];

  loadOrgs() {
    // Fetches orgs from AdminApi service
  }

  selectOrg(org: AnyData) {
    this.selectedOrg = org;
  }

  createOrg() {
    // Creates new org via AdminApi service
  }

  seed() {
    // Seeds selected org via AdminApi service
  }

  wipe() {
    // Wipes selected org via AdminApi service
  }

  deleteOrg() {
    // Deletes selected org via AdminApi service
  }

  impersonate() {
    // Impersonates admin for selected org via AdminApi service
  }
}
