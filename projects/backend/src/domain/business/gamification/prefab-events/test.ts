import { assertEquals, assertNotEquals } from "@std/assert";
import { getPrefabEventsJson, PREFAB_EVENTS, PrefabEventService } from "./mod.ts";
import type { PrefabEventDef } from "./mod.ts";

// ---------------------------------------------------------------------------
// PREFAB_EVENTS constant
// ---------------------------------------------------------------------------

Deno.test("PREFAB_EVENTS is a non-empty array", () => {
  assertEquals(Array.isArray(PREFAB_EVENTS), true);
  assertNotEquals(PREFAB_EVENTS.length, 0);
});

Deno.test("PREFAB_EVENTS has 8 entries", () => {
  assertEquals(PREFAB_EVENTS.length, 8);
});

Deno.test("every PREFAB_EVENTS entry has required shape", () => {
  for (const entry of PREFAB_EVENTS) {
    assertEquals(typeof entry.type, "string");
    assertEquals(typeof entry.label, "string");
    assertEquals(typeof entry.description, "string");
    assertEquals(typeof entry.icon, "string");
    assertEquals(typeof entry.defaultMessage, "function");
  }
});

Deno.test("all PREFAB_EVENTS type values are unique", () => {
  const types = PREFAB_EVENTS.map((e) => e.type);
  const unique = new Set(types);
  assertEquals(unique.size, types.length);
});

// ---------------------------------------------------------------------------
// PrefabEventService
// ---------------------------------------------------------------------------

Deno.test("PrefabEventService.getPrefabEventsJson returns valid JSON string", () => {
  const svc = new PrefabEventService();
  const json = svc.getPrefabEventsJson();
  assertEquals(typeof json, "string");
  // Should not throw
  const parsed = JSON.parse(json);
  assertEquals(Array.isArray(parsed), true);
});

Deno.test("PrefabEventService.getPrefabEventsJson excludes defaultMessage", () => {
  const svc = new PrefabEventService();
  const parsed = JSON.parse(svc.getPrefabEventsJson());
  for (const entry of parsed) {
    assertEquals(entry.defaultMessage, undefined);
  }
});

Deno.test("getPrefabEventsJson parsed result has same length as PREFAB_EVENTS", () => {
  const svc = new PrefabEventService();
  const parsed = JSON.parse(svc.getPrefabEventsJson());
  assertEquals(parsed.length, PREFAB_EVENTS.length);
});

// ---------------------------------------------------------------------------
// Wrapper function
// ---------------------------------------------------------------------------

Deno.test("wrapper getPrefabEventsJson matches class method behavior", () => {
  const svc = new PrefabEventService();
  assertEquals(getPrefabEventsJson(), svc.getPrefabEventsJson());
});
