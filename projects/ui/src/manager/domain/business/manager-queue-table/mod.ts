import { Component, Input } from "@sprig/kit";

export interface QueueItem {
  findingId: string;
  agentEmail: string;
  recordId: string;
  failedCount: number;
  totalCount: number;
  completedAt: string;
  status: string;
}

@Component({ template: "./mod.html", island: true })
export class ManagerQueueTable {
  @Input() items: QueueItem[] = [];
  @Input() filter: string = "all";

  localFilter: string = "all";

  setFilter(val: string) {
    this.localFilter = val;
  }

  get filteredItems(): QueueItem[] {
    const f = this.localFilter;
    const subset = f === "all"
      ? this.items
      : this.items.filter((i) => i.status === f);
    return [...subset].sort((a, b) => {
      if (a.status !== b.status) return a.status === "pending" ? -1 : 1;
      return b.completedAt.localeCompare(a.completedAt);
    });
  }
}
