import { Component, Input } from "@sprig/kit";

@Component({ template: "./mod.html", island: true })
export class RemediationSection {
  @Input() canRemediate: boolean = false;

  notes: string = "";
  submitting: boolean = false;

  submit() {
    if (this.notes.trim().length < 20 || this.submitting) return;
    this.submitting = true;
  }
}
