import { Component, Input } from "@sprig/kit";

@Component({ template: "./mod.html", island: true })
export class Toast {
  @Input() msg: string = "";
  @Input() type: "success" | "error" | "info" = "info";

  visible = true;

  dismiss() {
    this.visible = false;
  }
}
