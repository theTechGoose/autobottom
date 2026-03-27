import { Service } from "@sprig/kit";

const API = "/review/api";

@Service({ scope: "singleton" })
export class ReviewApi {
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
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async goBack(): Promise<unknown> {
    const res = await fetch(`${API}/back`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
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

  getRecording(findingId: string): string {
    return `/audit/recording?id=${encodeURIComponent(findingId)}`;
  }

  async getGameConfig(): Promise<unknown> {
    const res = await fetch(`${API}/gamification`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
}
