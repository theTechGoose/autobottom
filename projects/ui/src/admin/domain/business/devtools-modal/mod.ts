import { Component, Input } from "@sprig/kit";

@Component({ template: "./mod.html", island: true })
export class DevtoolsModal {
  @Input() open: boolean = false;

  seedBusy: boolean = false;
  wipeBusy: boolean = false;

  seedData() {
    // Coordinator handles API call
  }

  wipeData() {
    // Coordinator handles API call
  }
}
