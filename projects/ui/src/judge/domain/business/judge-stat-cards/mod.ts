import { Component, Input } from "@sprig/kit";

@Component({ template: "./mod.html" })
export class JudgeStatCards {
  @Input() totalJudged: number = 0;
  @Input() upheld: number = 0;
  @Input() overturned: number = 0;
  @Input() accuracy: string = "--";
  @Input() avgTime: string = "--";
  @Input() streak: number = 0;
}
