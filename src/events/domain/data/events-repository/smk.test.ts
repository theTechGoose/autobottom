/** Smoke tests for events repository. */
import { assertEquals, assert } from "#assert";
import { emitEvent, getEvents, deleteEvents, savePrefabSubscriptions, getPrefabSubscriptions, emitBroadcastEvent, getBroadcastEvents, checkAndEmitPrefab } from "./mod.ts";

const kvOpts = { sanitizeResources: false, sanitizeOps: false };
const ORG = "test-org-" + crypto.randomUUID().slice(0, 8);

Deno.test({ name: "events — emit and retrieve", ...kvOpts, fn: async () => {
  await emitEvent(ORG, "user@test.com", "audit-completed", { score: 100 });
  const events = await getEvents(ORG, "user@test.com");
  assert(events.length > 0);
  assertEquals(events[0].type, "audit-completed");
}});

Deno.test({ name: "events — delete by id", ...kvOpts, fn: async () => {
  await emitEvent(ORG, "del@test.com", "review-decided", {});
  const events = await getEvents(ORG, "del@test.com");
  await deleteEvents(ORG, "del@test.com", events.map((e) => e.id));
  assertEquals((await getEvents(ORG, "del@test.com")).length, 0);
}});

Deno.test({ name: "prefab subscriptions — save and get", ...kvOpts, fn: async () => {
  await savePrefabSubscriptions(ORG, { sale_completed: true, perfect_score: false });
  const subs = await getPrefabSubscriptions(ORG);
  assertEquals(subs.sale_completed, true);
}});

Deno.test({ name: "broadcast — emit and retrieve", ...kvOpts, fn: async () => {
  await emitBroadcastEvent(ORG, "sale_completed", "a@b.com", "Test!", null);
  const events = await getBroadcastEvents(ORG);
  assert(events.some((e) => e.type === "sale_completed"));
}});

Deno.test({ name: "checkAndEmitPrefab — only emits when subscription is enabled", ...kvOpts, fn: async () => {
  const ORG2 = "test-prefab-" + crypto.randomUUID().slice(0, 8);
  await savePrefabSubscriptions(ORG2, { sale_completed: true, perfect_score: false });

  // Subscribed: should emit
  await checkAndEmitPrefab(ORG2, "sale_completed", "agent@x.com", "Sale!");
  let broadcasts = await getBroadcastEvents(ORG2);
  assert(broadcasts.some((b) => b.type === "sale_completed"));

  // Unsubscribed: should NOT emit
  await checkAndEmitPrefab(ORG2, "perfect_score", "agent@x.com", "100%");
  broadcasts = await getBroadcastEvents(ORG2);
  assert(!broadcasts.some((b) => b.type === "perfect_score"));

  // Unknown prefab type: defaults to disabled, no emit
  await checkAndEmitPrefab(ORG2, "completely_unknown", "agent@x.com", "?");
  broadcasts = await getBroadcastEvents(ORG2);
  assert(!broadcasts.some((b) => b.type === "completely_unknown"));
}});
