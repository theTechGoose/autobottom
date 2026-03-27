import { Component, Input } from "@sprig/kit";

interface QLTest {
  id: string;
  snippet: string;
  expected: string;
  result?: string;
  lastRun?: string;
  thinking?: string;
  defense?: string;
  rawAnswer?: string;
}

@Component({ template: "./mod.html", island: true })
export class TestRunner {
  @Input() questionId = "";
  @Input() tests: QLTest[] = [];

  showNew = false;
  testSnippet = "";
  testExpected = "yes";
  testStatuses: Record<string, string> = {};
  expandedTests: string[] = [];

  toggleNew() {
    this.showNew = !this.showNew;
  }

  toggleExpanded(id: string) {
    const idx = this.expandedTests.indexOf(id);
    if (idx >= 0) {
      this.expandedTests = this.expandedTests.filter((e) => e !== id);
    } else {
      this.expandedTests = [...this.expandedTests, id];
    }
  }

  isExpanded(id: string): boolean {
    return this.expandedTests.includes(id);
  }

  getStatus(id: string): string {
    return this.testStatuses[id] || "";
  }

  simulate() {
    // Imperative SSE streaming method - implemented by coordinator
  }
}
