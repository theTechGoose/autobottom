import { Component, Input } from "@sprig/kit";

@Component({ template: "./mod.html" })
export class Button {
  @Input() disabled: boolean = false;
}
