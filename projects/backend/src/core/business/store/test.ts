import { assertEquals, assert } from "@std/assert";
import { rarityFromPrice, getStoreCatalogJson, StoreService, STORE_CATALOG } from "./mod.ts";
import type { StoreRarity, StoreItem } from "./mod.ts";

// ---------------------------------------------------------------------------
// rarityFromPrice (wrapper)
// ---------------------------------------------------------------------------

Deno.test("rarityFromPrice: >= 1000 returns legendary", () => {
  assertEquals(rarityFromPrice(1000), "legendary");
  assertEquals(rarityFromPrice(2000), "legendary");
  assertEquals(rarityFromPrice(1500), "legendary");
});

Deno.test("rarityFromPrice: >= 700 and < 1000 returns epic", () => {
  assertEquals(rarityFromPrice(700), "epic");
  assertEquals(rarityFromPrice(800), "epic");
  assertEquals(rarityFromPrice(999), "epic");
});

Deno.test("rarityFromPrice: >= 400 and < 700 returns rare", () => {
  assertEquals(rarityFromPrice(400), "rare");
  assertEquals(rarityFromPrice(500), "rare");
  assertEquals(rarityFromPrice(699), "rare");
});

Deno.test("rarityFromPrice: >= 200 and < 400 returns uncommon", () => {
  assertEquals(rarityFromPrice(200), "uncommon");
  assertEquals(rarityFromPrice(300), "uncommon");
  assertEquals(rarityFromPrice(399), "uncommon");
});

Deno.test("rarityFromPrice: < 200 returns common", () => {
  assertEquals(rarityFromPrice(0), "common");
  assertEquals(rarityFromPrice(100), "common");
  assertEquals(rarityFromPrice(199), "common");
});

// ---------------------------------------------------------------------------
// STORE_CATALOG
// ---------------------------------------------------------------------------

Deno.test("STORE_CATALOG: is a non-empty array", () => {
  assert(Array.isArray(STORE_CATALOG));
  assert(STORE_CATALOG.length > 0);
});

Deno.test("STORE_CATALOG: every entry has required StoreItem shape", () => {
  const validTypes = new Set([
    "title", "avatar_frame", "name_color", "animation",
    "theme", "flair", "font", "bubble_font", "bubble_color",
  ]);
  const validRarities = new Set(["common", "uncommon", "rare", "epic", "legendary"]);

  for (const item of STORE_CATALOG) {
    assert(typeof item.id === "string" && item.id.length > 0, `item.id invalid: ${item.id}`);
    assert(typeof item.name === "string", `item.name invalid for ${item.id}`);
    assert(typeof item.description === "string", `item.description invalid for ${item.id}`);
    assert(typeof item.price === "number" && item.price >= 0, `item.price invalid for ${item.id}`);
    assert(validTypes.has(item.type), `item.type invalid for ${item.id}: ${item.type}`);
    assert(typeof item.icon === "string", `item.icon invalid for ${item.id}`);
    assert(validRarities.has(item.rarity), `item.rarity invalid for ${item.id}: ${item.rarity}`);
  }
});

// ---------------------------------------------------------------------------
// StoreService class
// ---------------------------------------------------------------------------

Deno.test("StoreService.rarityFromPrice — returns correct rarity for each threshold", () => {
  const svc = new StoreService();
  assertEquals(svc.rarityFromPrice(1000), "legendary");
  assertEquals(svc.rarityFromPrice(700), "epic");
  assertEquals(svc.rarityFromPrice(400), "rare");
  assertEquals(svc.rarityFromPrice(200), "uncommon");
  assertEquals(svc.rarityFromPrice(100), "common");
});

Deno.test("StoreService.getStoreCatalogJson — returns valid JSON string", () => {
  const svc = new StoreService();
  const json = svc.getStoreCatalogJson();
  assert(typeof json === "string", "Expected a string");
  const parsed = JSON.parse(json);
  assert(Array.isArray(parsed), "Expected parsed JSON to be an array");
  assert(parsed.length === STORE_CATALOG.length, "Expected same number of items as STORE_CATALOG");
});

Deno.test("StoreService.getStoreCatalogJson — each item matches STORE_CATALOG entry", () => {
  const svc = new StoreService();
  const parsed = JSON.parse(svc.getStoreCatalogJson());
  for (let i = 0; i < parsed.length; i++) {
    assertEquals(parsed[i].id, STORE_CATALOG[i].id);
    assertEquals(parsed[i].name, STORE_CATALOG[i].name);
    assertEquals(parsed[i].price, STORE_CATALOG[i].price);
  }
});

// ---------------------------------------------------------------------------
// getStoreCatalogJson wrapper
// ---------------------------------------------------------------------------

Deno.test("getStoreCatalogJson wrapper — returns valid JSON string", () => {
  const json = getStoreCatalogJson();
  assert(typeof json === "string", "Expected a string");
  const parsed = JSON.parse(json);
  assert(Array.isArray(parsed), "Expected parsed JSON to be an array");
  assert(parsed.length === STORE_CATALOG.length, "Expected same number of items as STORE_CATALOG");
});

Deno.test("getStoreCatalogJson wrapper — round-trips STORE_CATALOG faithfully", () => {
  const parsed = JSON.parse(getStoreCatalogJson());
  for (let i = 0; i < parsed.length; i++) {
    assertEquals(parsed[i].id, STORE_CATALOG[i].id);
  }
});
