import { Component, Input } from "@sprig/kit";

@Component({ template: "./mod.html" })
export class GameUi {
  @Input() combo: number = 0;
  @Input() level: number = 1;
  @Input() xpBarPct: number = 0;
  @Input() xpDisplay: string = "0 / 100";
  @Input() streakDays: number = 0;
  @Input() progressPct: number = 0;
  @Input() progressLabel: string = "0 / 0";
  @Input() timeBankVal: number = 0;
  @Input() streakBannerText: string = "";
  @Input() streakBannerVisible: boolean = false;
  @Input() streakBannerCls: string = "";
}
