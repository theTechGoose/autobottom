import { Service } from "@sprig/kit";

@Service({ scope: "singleton" })
export class QuestionLabApi {
  async getConfigs(): Promise<unknown[]> {
    const res = await fetch("/question-lab/api/configs");
    if (!res.ok) return [];
    return await res.json() || [];
  }

  async createConfig(name: string): Promise<unknown> {
    const res = await fetch("/question-lab/api/configs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error("Create config failed");
    return await res.json();
  }

  async updateConfig(id: string, name: string): Promise<void> {
    const res = await fetch(`/question-lab/api/configs/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error("Update config failed");
  }

  async deleteConfig(id: string): Promise<void> {
    const res = await fetch(`/question-lab/api/configs/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error("Delete config failed");
  }

  async getConfig(id: string): Promise<unknown> {
    const res = await fetch(`/question-lab/api/configs/${id}`);
    if (!res.ok) throw new Error("Get config failed");
    return await res.json();
  }

  async createQuestion(
    configId: string,
    name: string,
    text: string,
  ): Promise<unknown> {
    const res = await fetch(
      `/question-lab/api/configs/${configId}/questions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, text }),
      },
    );
    if (!res.ok) throw new Error("Create question failed");
    return await res.json();
  }

  async getQuestion(id: string): Promise<unknown> {
    const res = await fetch(`/question-lab/api/questions/${id}`);
    if (!res.ok) throw new Error("Get question failed");
    return await res.json();
  }

  async updateQuestion(
    id: string,
    data: { name?: string; text?: string; autoYesExp?: string },
  ): Promise<void> {
    const res = await fetch(`/question-lab/api/questions/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("Update question failed");
  }

  async deleteQuestion(id: string): Promise<void> {
    const res = await fetch(`/question-lab/api/questions/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error("Delete question failed");
  }

  async restoreVersion(questionId: string, index: number): Promise<void> {
    const res = await fetch(
      `/question-lab/api/questions/${questionId}/restore/${index}`,
      { method: "POST" },
    );
    if (!res.ok) throw new Error("Restore version failed");
  }

  async createTest(
    questionId: string,
    snippet: string,
    expected: string,
  ): Promise<unknown> {
    const res = await fetch(
      `/question-lab/api/questions/${questionId}/tests`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snippet, expected }),
      },
    );
    if (!res.ok) throw new Error("Create test failed");
    return await res.json();
  }

  async deleteTest(id: string): Promise<void> {
    const res = await fetch(`/question-lab/api/tests/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error("Delete test failed");
  }

  async simulate(
    questionText: string,
    testIds: string[],
  ): Promise<Response> {
    const res = await fetch("/question-lab/api/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionText, testIds }),
    });
    if (!res.ok) throw new Error("Simulate failed");
    return res;
  }
}
