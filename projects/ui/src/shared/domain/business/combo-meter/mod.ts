import { Component, Input } from "@sprig/kit";

@Component({ template: "./mod.html" })
export class ComboMeter {
  @Input() combo: number = 0;
  @Input() streakThreshold: number = 0;
  @Input() timeBank: number = 0;

  get comboClass(): string {
    if (this.combo <= 0) return "combo-dim";
    if (this.combo >= 23) return "combo-godlike";
    if (this.combo >= 12) return "combo-inferno";
    if (this.combo >= 5) return "combo-fire";
    if (this.combo >= 3) return "combo-hot";
    return "combo-dim";
  }

  get showTimeBank(): boolean {
    return this.streakThreshold > 0;
  }
}
