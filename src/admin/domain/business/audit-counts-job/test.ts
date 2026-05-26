import { assert } from "#assert";
Deno.test("audit-counts-job — exports are present", async () => {
  const mod = await import("./mod.ts");
  assert(typeof mod.startAuditCountsJob === "function");
  assert(typeof mod.tickAuditCountsJob === "function");
  assert(typeof mod.getAuditCountsJob === "function");
});
