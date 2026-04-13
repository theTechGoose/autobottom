/** Tests for KvRepository base class — uses in-memory Deno KV. */

import { assertEquals, assert } from "jsr:@std/assert";
import { KvRepository } from "./mod.ts";

const kvOpts = { sanitizeResources: false, sanitizeOps: false };

class TestRepo extends KvRepository<{ name: string; value: number }> {
  constructor() { super("test-entity"); }
}

Deno.test({ name: "KvRepository — set and get", ...kvOpts, fn: async () => {
  const repo = new TestRepo();
  await repo.set("org-1", ["item-1"], { name: "alpha", value: 42 });
  const result = await repo.get("org-1", "item-1");
  assertEquals(result, { name: "alpha", value: 42 });
}});

Deno.test({ name: "KvRepository — get returns null for missing", ...kvOpts, fn: async () => {
  const repo = new TestRepo();
  const result = await repo.get("org-1", "nonexistent");
  assertEquals(result, null);
}});

Deno.test({ name: "KvRepository — delete removes entry", ...kvOpts, fn: async () => {
  const repo = new TestRepo();
  await repo.set("org-1", ["to-delete"], { name: "temp", value: 0 });
  await repo.delete("org-1", "to-delete");
  const result = await repo.get("org-1", "to-delete");
  assertEquals(result, null);
}});

Deno.test({ name: "KvRepository — list returns all under prefix", ...kvOpts, fn: async () => {
  const repo = new TestRepo();
  await repo.set("org-2", ["list", "a"], { name: "a", value: 1 });
  await repo.set("org-2", ["list", "b"], { name: "b", value: 2 });
  await repo.set("org-2", ["list", "c"], { name: "c", value: 3 });
  const results = await repo.list("org-2", "list");
  assertEquals(results.length, 3);
  const names = results.map((r) => r.value.name).sort();
  assertEquals(names, ["a", "b", "c"]);
}});

Deno.test({ name: "KvRepository — list isolates by orgId", ...kvOpts, fn: async () => {
  const repo = new TestRepo();
  await repo.set("org-A", ["item"], { name: "A", value: 1 });
  await repo.set("org-B", ["item"], { name: "B", value: 2 });
  const resultsA = await repo.list("org-A");
  const resultsB = await repo.list("org-B");
  assert(resultsA.some((r) => r.value.name === "A"));
  assert(resultsB.some((r) => r.value.name === "B"));
}});

Deno.test({ name: "KvRepository — chunked set and get for large values", ...kvOpts, fn: async () => {
  const repo = new TestRepo();
  const bigName = "x".repeat(50_000);
  await repo.setChunked("org-1", ["big"], { name: bigName, value: 99 });
  const result = await repo.getChunked("org-1", "big");
  assert(result !== null);
  assertEquals(result!.name.length, 50_000);
  assertEquals(result!.value, 99);
}});

Deno.test({ name: "KvRepository — chunked get returns null for missing", ...kvOpts, fn: async () => {
  const repo = new TestRepo();
  const result = await repo.getChunked("org-1", "no-such-chunked");
  assertEquals(result, null);
}});

Deno.test({ name: "KvRepository — chunked delete removes all chunks", ...kvOpts, fn: async () => {
  const repo = new TestRepo();
  const bigName = "y".repeat(50_000);
  await repo.setChunked("org-1", ["del-big"], { name: bigName, value: 1 });
  await repo.deleteChunked("org-1", "del-big");
  const result = await repo.getChunked("org-1", "del-big");
  assertEquals(result, null);
}});
