import { Component, Input } from "@sprig/kit";

@Component({ template: "./mod.html" })
export class StatCard {
  @Input({ required: true }) label!: string;
  @Input({ required: true }) value!: string;
  @Input() color: string = "var(--blue)";
}
