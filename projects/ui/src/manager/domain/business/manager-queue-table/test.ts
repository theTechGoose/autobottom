import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ManagerQueueTable } from "./mod.ts";
import type { QueueItem } from "./mod.ts";

Deno.test("ManagerQueueTable - default items is empty array", () => {
  const table = new ManagerQueueTable();
  assertEquals(table.items, []);
});

Deno.test("ManagerQueueTable - default filter is 'all'", () => {
  const table = new ManagerQueueTable();
  assertEquals(table.filter, "all");
});

Deno.test("ManagerQueueTable - default localFilter is 'all'", () => {
  const table = new ManagerQueueTable();
  assertEquals(table.localFilter, "all");
});

Deno.test("ManagerQueueTable - setFilter updates localFilter", () => {
  const table = new ManagerQueueTable();
  table.setFilter("pending");
  assertEquals(table.localFilter, "pending");
});

Deno.test("ManagerQueueTable - setFilter to 'addressed'", () => {
  const table = new ManagerQueueTable();
  table.setFilter("addressed");
  assertEquals(table.localFilter, "addressed");
});

Deno.test("ManagerQueueTable - filteredItems returns all when localFilter is 'all'", () => {
  const table = new ManagerQueueTable();
  const items: QueueItem[] = [
    { findingId: "1", agentEmail: "a@b.com", recordId: "r1", failedCount: 1, totalCount: 5, completedAt: "2025-01-01", status: "pending" },
    { findingId: "2", agentEmail: "c@d.com", recordId: "r2", failedCount: 2, totalCount: 5, completedAt: "2025-01-02", status: "addressed" },
  ];
  table.items = items;
  table.localFilter = "all";
  assertEquals(table.filteredItems.length, 2);
});

Deno.test("ManagerQueueTable - filteredItems filters by status", () => {
  const table = new ManagerQueueTable();
  const items: QueueItem[] = [
    { findingId: "1", agentEmail: "a@b.com", recordId: "r1", failedCount: 1, totalCount: 5, completedAt: "2025-01-01", status: "pending" },
    { findingId: "2", agentEmail: "c@d.com", recordId: "r2", failedCount: 2, totalCount: 5, completedAt: "2025-01-02", status: "addressed" },
  ];
  table.items = items;
  table.setFilter("pending");
  assertEquals(table.filteredItems.length, 1);
  assertEquals(table.filteredItems[0].findingId, "1");
});

Deno.test("ManagerQueueTable - filteredItems sorts pending first", () => {
  const table = new ManagerQueueTable();
  const items: QueueItem[] = [
    { findingId: "1", agentEmail: "a@b.com", recordId: "r1", failedCount: 1, totalCount: 5, completedAt: "2025-01-01", status: "addressed" },
    { findingId: "2", agentEmail: "c@d.com", recordId: "r2", failedCount: 2, totalCount: 5, completedAt: "2025-01-02", status: "pending" },
  ];
  table.items = items;
  table.localFilter = "all";
  assertEquals(table.filteredItems[0].status, "pending");
});
