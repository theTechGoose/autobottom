import { Component, Input } from "@sprig/kit";

@Component({ template: "./mod.html" })
export class Modal {
  @Input() open: boolean = false;
  @Input() title: string = "";
}
