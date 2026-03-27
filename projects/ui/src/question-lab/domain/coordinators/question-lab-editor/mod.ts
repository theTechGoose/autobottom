import { Component } from "@sprig/kit";

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

type View = "list" | "config" | "question";

@Component({ template: "./mod.html", island: true })
export class QuestionLabEditorCoordinator {
  view: View = "list";
  configs: QLConfig[] = [];
  activeConfig: QLConfig | null = null;
  questions: QLQuestion[] = [];
  activeQuestion: QLQuestion | null = null;
  tests: QLTest[] = [];
  toastMsg = "";
  toastType = "success";

  private showToast(msg: string, type = "success") {
    this.toastMsg = msg;
    this.toastType = type;
    setTimeout(() => {
      this.toastMsg = "";
    }, 2000);
  }

  async loadConfigs() {
    try {
      const res = await fetch("/question-lab/api/configs");
      if (!res.ok) return;
      this.configs = (await res.json()) || [];
    } catch {
      // ignore
    }
  }

  async openConfig(id: string) {
    try {
      const res = await fetch(`/question-lab/api/configs/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      this.activeConfig = data.config || data;
      this.questions = data.questions || [];
      this.view = "config";
    } catch {
      // ignore
    }
  }

  async openQuestion(id: string) {
    try {
      const res = await fetch(`/question-lab/api/questions/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      this.activeQuestion = data.question || data;
      this.tests = data.tests || [];
      this.view = "question";
    } catch {
      // ignore
    }
  }

  async createConfig(name: string) {
    try {
      const res = await fetch("/question-lab/api/configs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error("Create failed");
      await this.loadConfigs();
    } catch (err) {
      this.showToast((err as Error).message, "error");
    }
  }

  async deleteConfig(id: string) {
    try {
      await fetch(`/question-lab/api/configs/${id}`, { method: "DELETE" });
      await this.loadConfigs();
    } catch (err) {
      this.showToast((err as Error).message, "error");
    }
  }

  async renameConfig(id: string, name: string) {
    try {
      const res = await fetch(`/question-lab/api/configs/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error("Rename failed");
      this.showToast("Config renamed");
    } catch (err) {
      this.showToast((err as Error).message, "error");
    }
  }

  async createQuestion(configId: string, name: string, text: string) {
    try {
      const res = await fetch(
        `/question-lab/api/configs/${configId}/questions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, text }),
        },
      );
      if (!res.ok) throw new Error("Create failed");
      await this.openConfig(configId);
    } catch (err) {
      this.showToast((err as Error).message, "error");
    }
  }

  async deleteQuestion(id: string) {
    try {
      await fetch(`/question-lab/api/questions/${id}`, { method: "DELETE" });
      if (this.activeConfig) {
        await this.openConfig(this.activeConfig.id);
      }
    } catch (err) {
      this.showToast((err as Error).message, "error");
    }
  }

  async saveQuestion(
    id: string,
    data: { name?: string; text?: string; autoYesExp?: string },
  ) {
    try {
      const res = await fetch(`/question-lab/api/questions/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Save failed");
      this.showToast("Question saved");
      await this.openQuestion(id);
    } catch (err) {
      this.showToast((err as Error).message, "error");
    }
  }

  async restoreVersion(questionId: string, index: number) {
    try {
      await fetch(
        `/question-lab/api/questions/${questionId}/restore/${index}`,
        { method: "POST" },
      );
      await this.openQuestion(questionId);
    } catch (err) {
      this.showToast((err as Error).message, "error");
    }
  }

  async createTest(questionId: string, snippet: string, expected: string) {
    try {
      const res = await fetch(
        `/question-lab/api/questions/${questionId}/tests`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ snippet, expected }),
        },
      );
      if (!res.ok) throw new Error("Create failed");
      await this.openQuestion(questionId);
    } catch (err) {
      this.showToast((err as Error).message, "error");
    }
  }

  async deleteTest(id: string) {
    try {
      await fetch(`/question-lab/api/tests/${id}`, { method: "DELETE" });
      if (this.activeQuestion) {
        await this.openQuestion(this.activeQuestion.id);
      }
    } catch (err) {
      this.showToast((err as Error).message, "error");
    }
  }

  async simulateAll(questionText: string, testIds: string[]) {
    try {
      const res = await fetch("/question-lab/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionText, testIds }),
      });
      if (!res.ok) throw new Error("Simulate failed");

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop()!;
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = JSON.parse(line.slice(6));
          if (data.done && this.activeQuestion) {
            await this.openQuestion(this.activeQuestion.id);
            return;
          }
        }
      }
    } catch (err) {
      this.showToast((err as Error).message, "error");
    }
  }
}
