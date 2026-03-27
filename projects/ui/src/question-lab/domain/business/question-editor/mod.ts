import { Component, Input } from "@sprig/kit";

interface QLQuestion {
  id: string;
  name: string;
  text: string;
  autoYes?: string;
  testCount?: number;
  versions?: unknown[];
}

@Component({ template: "./mod.html", island: true })
export class QuestionEditor {
  @Input() question: QLQuestion | null = null;
  @Input() versions: unknown[] = [];

  qName = "";
  qText = "";
  qAutoYes = "";

  loadFromQuestion() {
    if (!this.question) return;
    this.qName = this.question.name;
    this.qText = this.question.text;
    this.qAutoYes = this.question.autoYes || "";
  }
}
