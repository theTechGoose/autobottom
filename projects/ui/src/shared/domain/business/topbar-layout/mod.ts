import { Component, Input } from "@sprig/kit";

@Component({ template: "./mod.html" })
export class TopbarLayout {
  @Input({ required: true }) title!: string;
  @Input() backHref: string = "/admin/dashboard";
}
