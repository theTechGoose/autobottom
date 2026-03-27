import { Component, Input } from "@sprig/kit";

@Component({ template: "./mod.html" })
export class BadgeFilterBar {
  @Input() activeFilter: string = "all";
  @Input() filters: string[] = [];
}
