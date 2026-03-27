import { Component, Input } from "@sprig/kit";

@Component({ template: "./mod.html" })
export class StoreWalletBar {
  @Input() balance: number = 0;
  @Input() level: number = 1;
  @Input() totalXp: number = 0;
}
