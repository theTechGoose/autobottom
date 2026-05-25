/** Unit tests for the in-memory event bus — pure pub/sub, no IO. */
import { assertEquals } from "#assert";
import {
  subscribeUser, subscribeOrg, publishToUser, publishToOrg,
  _resetBusForTesting, busStats,
} from "./mod.ts";

Deno.test("subscribeUser — receives only its targeted events", () => {
  _resetBusForTesting();
  const events: unknown[] = [];
  const unsub = subscribeUser("org-1", "alice@x.com", (e) => events.push(e));

  publishToUser("org-1", "alice@x.com", "new-message", { body: "hi" });
  publishToUser("org-1", "bob@x.com", "new-message", { body: "not for alice" });
  publishToUser("org-2", "alice@x.com", "new-message", { body: "different org" });

  assertEquals(events.length, 1);
  unsub();
});

Deno.test("subscribeOrg — receives broadcasts; not per-user app events", () => {
  _resetBusForTesting();
  const events: unknown[] = [];
  const unsub = subscribeOrg("org-1", (e) => events.push(e));

  publishToOrg("org-1", "badge_earned", { badgeId: "rev_first_blood" });
  publishToUser("org-1", "alice@x.com", "new-message", { body: "hi" });
  publishToOrg("org-2", "badge_earned", { badgeId: "elsewhere" });

  assertEquals(events.length, 1);
  unsub();
});

Deno.test("unsubscribe — listener no longer receives after unsub", () => {
  _resetBusForTesting();
  const events: unknown[] = [];
  const unsub = subscribeUser("org-1", "alice@x.com", (e) => events.push(e));
  publishToUser("org-1", "alice@x.com", "test", {});
  assertEquals(events.length, 1);
  unsub();
  publishToUser("org-1", "alice@x.com", "test", {});
  assertEquals(events.length, 1);
});

Deno.test("multiple subscribers per key — all receive", () => {
  _resetBusForTesting();
  const a: unknown[] = [];
  const b: unknown[] = [];
  subscribeUser("org-1", "shared@x.com", (e) => a.push(e));
  subscribeUser("org-1", "shared@x.com", (e) => b.push(e));
  publishToUser("org-1", "shared@x.com", "ping", {});
  assertEquals(a.length, 1);
  assertEquals(b.length, 1);
});

Deno.test("listener that throws does not block other listeners", () => {
  _resetBusForTesting();
  const captured: unknown[] = [];
  subscribeUser("org-1", "boom@x.com", () => { throw new Error("intentional"); });
  subscribeUser("org-1", "boom@x.com", (e) => captured.push(e));
  publishToUser("org-1", "boom@x.com", "ping", { ok: true });
  assertEquals(captured.length, 1);
});

Deno.test("busStats — counts users and orgs separately", () => {
  _resetBusForTesting();
  assertEquals(busStats().totalListeners, 0);
  subscribeUser("org-1", "a@x.com", () => {});
  subscribeUser("org-1", "b@x.com", () => {});
  subscribeOrg("org-1", () => {});
  const stats = busStats();
  assertEquals(stats.userKeys, 2);
  assertEquals(stats.orgKeys, 1);
  assertEquals(stats.totalListeners, 3);
});
