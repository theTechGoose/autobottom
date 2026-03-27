import { Component, Input } from "@sprig/kit";

@Component({ template: "./mod.html" })
export class SidebarLayout {
  @Input({ required: true }) role!: string;
  @Input() active: string = "";
}
