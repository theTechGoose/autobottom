import { Component, Input } from "@sprig/kit";

@Component({ template: "./mod.html", island: true })
export class JudgeControlPanel {
  @Input() busy: boolean = false;
  @Input() hasItem: boolean = false;
}
