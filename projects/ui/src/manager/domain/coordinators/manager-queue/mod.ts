import { Component } from "@sprig/kit";

interface QueueItem {
  findingId: string;
  agentEmail: string;
  recordId: string;
  failedCount: number;
  totalCount: number;
  completedAt: string;
  status: string;
}

interface Stats {
  outstanding: number;
  addressedThisWeek: number;
  totalAudits: number;
  avgResolution: string;
}

@Component({ template: "./mod.html", island: true })
export class ManagerQueueCoordinator {
  screen: "queue" | "detail" = "queue";
  queueData: QueueItem[] = [];
  stats: Stats | null = null;
  filterVal: string = "all";
  // deno-lint-ignore no-explicit-any
  detail: any = null;
  // deno-lint-ignore no-explicit-any
  gameState: any = null;
  loading: boolean = true;
  toastMsg: string = "";
  toastType: string = "info";
  transcriptOpen: boolean = false;
  remNotes: string = "";
  remSubmitting: boolean = false;
  backfilling: boolean = false;

  // deno-lint-ignore no-explicit-any
  private async api<T = any>(path: string, opts?: RequestInit): Promise<T> {
    const res = await fetch("/manager/api" + path, {
      headers: { "Content-Type": "application/json" },
      ...opts,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data as T;
  }

  showToast(msg: string, type: string = "info") {
    this.toastMsg = msg;
    this.toastType = type;
  }

  async loadQueue() {
    this.loading = true;
    try {
      const [items, s] = await Promise.all([
        this.api<QueueItem[]>("/queue"),
        this.api<Stats>("/stats"),
      ]);
      this.queueData = items;
      this.stats = s;
    } catch (err) {
      this.showToast((err as Error).message, "error");
    } finally {
      this.loading = false;
    }
  }

  async loadDetail(findingId: string) {
    this.screen = "detail";
    this.transcriptOpen = false;
    this.remNotes = "";
    try {
      this.detail = await this.api("/finding?id=" + encodeURIComponent(findingId));
    } catch (err) {
      this.showToast((err as Error).message, "error");
      this.screen = "queue";
    }
  }

  async loadGameState() {
    try {
      this.gameState = await this.api("/game-state");
    } catch {
      // non-critical
    }
  }

  async submitRemediation() {
    if (!this.detail || this.remNotes.trim().length < 20) return;
    this.remSubmitting = true;
    try {
      await this.api("/remediate", {
        method: "POST",
        body: JSON.stringify({
          findingId: this.detail.finding.id,
          notes: this.remNotes.trim(),
        }),
      });
      this.showToast("Remediation submitted", "success");
      this.remNotes = "";
      await this.loadDetail(this.detail.finding.id);
      this.loadQueue();
      this.loadGameState();
    } catch (err) {
      this.showToast((err as Error).message, "error");
    } finally {
      this.remSubmitting = false;
    }
  }

  async backfill() {
    this.backfilling = true;
    try {
      const result = await this.api<{ added: number }>("/backfill", { method: "POST" });
      this.showToast("Backfilled " + (result.added || 0) + " items", "success");
      this.loadQueue();
    } catch (err) {
      this.showToast((err as Error).message, "error");
    } finally {
      this.backfilling = false;
    }
  }
}
