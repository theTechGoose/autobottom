import { Component, Input } from "@sprig/kit";

interface QLConfig {
  id: string;
  name: string;
  questionCount: number;
  createdAt: string;
}

interface QLQuestion {
  id: string;
  name: string;
  text: string;
  autoYes?: string;
  testCount?: number;
  versions?: unknown[];
}

@Component({ template: "./mod.html", island: true })
export class ConfigDetail {
  @Input() config: QLConfig | null = null;
  @Input() questions: QLQuestion[] = [];

  configName = "";
  showNewQuestion = false;
  newQName = "";
  newQText = "";

  toggleNewQuestion() {
    this.showNewQuestion = !this.showNewQuestion;
  }

  resetQuestionForm() {
    this.showNewQuestion = false;
    this.newQName = "";
    this.newQText = "";
  }
}
