import { Component, Input } from "@sprig/kit";

export interface PackOption {
  id: string;
  name: string;
}

export interface SettingsValues {
  threshold: number;
  comboTimeoutMs: number;
  gsEnabled: boolean;
  activePack: string;
}

@Component({ template: "./mod.html", island: true })
export class GamificationSettingsTab {
  @Input() threshold: number = 0;
  @Input() comboTimeoutMs: number = 10000;
  @Input() gsEnabled: boolean = true;
  @Input() activePack: string = "synth";
  @Input() role: string = "";
  @Input() packOptions: PackOption[] = [];

  collectValues(): SettingsValues {
    return {
      threshold: this.threshold,
      comboTimeoutMs: this.comboTimeoutMs,
      gsEnabled: this.gsEnabled,
      activePack: this.activePack,
    };
  }
}
