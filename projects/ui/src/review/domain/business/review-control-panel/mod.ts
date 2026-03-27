import { Component, Input } from "@sprig/kit";

@Component({ template: "./mod.html", island: true })
export class ReviewControlPanel {
  @Input() busy: boolean = false;
  @Input() hasItem: boolean = false;

  onConfirm() {
    // Event emission placeholder — coordinator handles actual logic
  }

  onFlip() {
    // Event emission placeholder — coordinator handles actual logic
  }

  onUndo() {
    // Event emission placeholder — coordinator handles actual logic
  }
}
