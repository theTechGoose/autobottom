import { Component, Input } from "@sprig/kit";

@Component({ template: "./mod.html", island: true })
export class PackEditor {
  @Input() packId: string = "";
  @Input() packName: string = "";

  saving = false;

  saveName() {
    this.saving = true;
  }
}
