import { Service } from "@sprig/kit";

@Service({ scope: "singleton" })
export class AgentApi {
  private async fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
    const res = await fetch(url, {
      credentials: "same-origin",
      ...options,
    });
    if (!res.ok) {
      if (res.status === 401) {
        globalThis.location.href = "/login";
      }
      const body = await res.json().catch(() => ({}));
      throw new Error(
        (body as Record<string, string>).error ||
          `Request failed: ${res.status}`,
      );
    }
    return res.json();
  }

  getMe() {
    return this.fetchJson<{ username?: string; email?: string }>(
      "/agent/api/me",
    );
  }

  getDashboard() {
    return this.fetchJson<{
      totalAudits: number;
      avgScore: number;
      recentAudits: unknown[];
      weeklyTrend: unknown[];
    }>("/agent/api/dashboard");
  }

  getGameState() {
    return this.fetchJson<{
      level: number;
      totalXp: number;
      tokenBalance: number;
      badges: string[];
    }>("/agent/api/game-state");
  }

  getStore() {
    return this.fetchJson<{
      balance: number;
      items: unknown[];
      purchased: string[];
    }>("/agent/api/store");
  }

  buyItem(id: string) {
    return this.fetchJson<{ newBalance: number }>("/agent/api/store/buy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: id }),
    });
  }
}
