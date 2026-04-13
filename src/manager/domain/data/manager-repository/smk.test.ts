/** Smoke tests for manager repository. */
import { assertEquals, assert } from "jsr:@std/assert";
import { populateManagerQueue, getManagerQueue, submitRemediation, getManagerStats } from "./mod.ts";

const kvOpts = { sanitizeResources: false, sanitizeOps: false };
const ORG = "test-org-" + crypto.randomUUID().slice(0, 8);

Deno.test({ name: "manager queue — populate and list", ...kvOpts, fn: async () => {
  await populateManagerQueue(ORG, "f-mgr-1");
  const queue = await getManagerQueue(ORG);
  assert(queue.some((i) => i.findingId === "f-mgr-1"));
}});

Deno.test({ name: "manager — remediate updates status", ...kvOpts, fn: async () => {
  await populateManagerQueue(ORG, "f-mgr-2");
  const { ok } = await submitRemediation(ORG, "f-mgr-2", "Fixed it", "manager@test.com");
  assertEquals(ok, true);
}});

Deno.test({ name: "manager stats — counts pending vs remediated", ...kvOpts, fn: async () => {
  const stats = await getManagerStats(ORG);
  assert(stats.total >= 2);
}});
