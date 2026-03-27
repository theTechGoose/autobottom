import { Component, Input } from "@sprig/kit";

@Component({ template: "./mod.html", island: true })
export class BadgeItemModal {
  @Input() open: boolean = false;
  @Input() mode: string = "create";

  id = "";
  name = "";
  type = "title";
  price = 0;
  icon = "";
  preview = "";
  description = "";
  saving = false;

  save() {
    this.saving = true;
  }

  close() {
    this.open = false;
  }
}
