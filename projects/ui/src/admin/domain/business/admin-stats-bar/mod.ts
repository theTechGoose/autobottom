import { Component, Input } from "@sprig/kit";

@Component({ template: "./mod.html" })
export class AdminStatsBar {
  @Input() inPipeline: number = 0;
  @Input() completed24h: number = 0;
  @Input() errors24h: number = 0;
  @Input() retries24h: number = 0;
  @Input() statusDot: string = "ok";
  @Input() countdown: number = 30;
}
