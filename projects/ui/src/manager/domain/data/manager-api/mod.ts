import { Service } from "@sprig/kit";

export interface QueueItem {
  findingId: string;
  agentEmail: string;
  recordId: string;
  failedCount: number;
  totalCount: number;
  completedAt: string;
  status: string;
}

export interface Stats {
  outstanding: number;
  addressedThisWeek: number;
  totalAudits: number;
  avgResolution: string;
}

export interface DetailData {
  // deno-lint-ignore no-explicit-any
  finding: any;
  // deno-lint-ignore no-explicit-any
  questions: any[];
  // deno-lint-ignore no-explicit-any
  transcript: any;
  queueItem: QueueItem;
  // deno-lint-ignore no-explicit-any
  remediation: any;
}

@Service({ scope: "singleton" })
export class ManagerApi {
  private async api<T>(path: string, opts?: RequestInit): Promise<T> {
    const res = await fetch("/manager/api" + path, {
      headers: { "Content-Type": "application/json" },
      ...opts,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data as T;
  }

  getQueue(): Promise<QueueItem[]> {
    return this.api<QueueItem[]>("/queue");
  }

  getStats(): Promise<Stats> {
    return this.api<Stats>("/stats");
  }

  getFinding(id: string): Promise<DetailData> {
    return this.api<DetailData>("/finding?id=" + encodeURIComponent(id));
  }

  remediate(findingId: string, notes: string): Promise<{ xpGained?: number }> {
    return this.api("/remediate", {
      method: "POST",
      body: JSON.stringify({ findingId, notes }),
    });
  }

  getGameState(): Promise<{ level: number; totalXp: number; tokenBalance: number; badges: string[] }> {
    return this.api("/game-state");
  }

  backfill(): Promise<{ added: number }> {
    return this.api("/backfill", { method: "POST" });
  }
}
