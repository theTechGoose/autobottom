import { Service } from "@sprig/kit";

const API = "/judge/api";

@Service({ scope: "singleton" })
export class JudgeApi {
  async getNext(): Promise<unknown> {
    const res = await fetch(`${API}/next`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async decide(data: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(`${API}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const body = await res.json();
    if (res.status === 409) return body;
    if (!res.ok) throw new Error(body.error || "Request failed");
    return body;
  }

  async goBack(): Promise<unknown> {
    const res = await fetch(`${API}/back`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "Back failed");
    return body;
  }

  async getMe(): Promise<unknown> {
    const res = await fetch(`${API}/me`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async getDashboard(): Promise<unknown> {
    const res = await fetch(`${API}/dashboard`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async getReviewers(): Promise<unknown> {
    const res = await fetch(`${API}/reviewers`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async addReviewer(email: string, password: string): Promise<unknown> {
    const res = await fetch(`${API}/reviewers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "Failed");
    return body;
  }

  async removeReviewer(email: string): Promise<unknown> {
    const res = await fetch(`${API}/reviewers`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) throw new Error("Failed");
    return res.json();
  }

  getRecording(findingId: string): string {
    return `/audit/recording?id=${encodeURIComponent(findingId)}`;
  }

  async getGameConfig(): Promise<unknown> {
    const res = await fetch(`${API}/gamification`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async getBadges(): Promise<unknown> {
    const res = await fetch("/api/badges");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
}
