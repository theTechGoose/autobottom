import { Component, Input } from "@sprig/kit";

@Component({ template: "./mod.html" })
export class ReviewStatCards {
  @Input() totalReviewed: number = 0;
  @Input() confirmed: number = 0;
  @Input() flipped: number = 0;
  @Input() accuracy: string = "--";
  @Input() avgTime: string = "--";
  @Input() streak: number = 0;
}
