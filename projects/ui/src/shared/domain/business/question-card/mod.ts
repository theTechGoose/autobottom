import { Component, Input } from "@sprig/kit";

@Component({ template: "./mod.html", island: true })
export class QuestionCard {
  @Input({ required: true }) header!: string;
  @Input() populated: string = "";
  @Input() defense: string = "";
  @Input() thinking: string = "";
  @Input() answer: string = "";
  @Input() appealType: string = "";
  @Input() appealComment: string = "";

  thinkingOpen = false;

  toggleThinking() {
    this.thinkingOpen = !this.thinkingOpen;
  }
}
