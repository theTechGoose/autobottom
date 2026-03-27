import { Component, Input } from "@sprig/kit";

interface QLConfig {
  id: string;
  name: string;
  questionCount: number;
  createdAt: string;
}

@Component({ template: "./mod.html", island: true })
export class ConfigList {
  @Input() configs: QLConfig[] = [];

  showNew = false;
  newName = "";

  toggleNew() {
    this.showNew = !this.showNew;
  }

  resetForm() {
    this.showNew = false;
    this.newName = "";
  }
}
