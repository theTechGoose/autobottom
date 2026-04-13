/** Smoke tests for gamification repository. */

import { assertEquals, assert } from "jsr:@std/assert";
import {
  listSoundPacks, saveSoundPack, getSoundPack, deleteSoundPack,
  saveGamificationSettings, getGamificationSettings,
  listCustomStoreItems, saveCustomStoreItem, deleteCustomStoreItem,
  awardBadge, getEarnedBadges, getBadgeStats, updateBadgeStats,
  getGameState, saveGameState, purchaseStoreItem,
} from "./mod.ts";

const kvOpts = { sanitizeResources: false, sanitizeOps: false };
const ORG = "test-org-" + crypto.randomUUID().slice(0, 8);

Deno.test({ name: "sound packs — CRUD", ...kvOpts, fn: async () => {
  await saveSoundPack(ORG, { id: "sp-1", name: "Test Pack", slots: {}, createdAt: Date.now(), createdBy: "test" });
  const got = await getSoundPack(ORG, "sp-1");
  assertEquals(got?.name, "Test Pack");
  const list = await listSoundPacks(ORG);
  assert(list.some((p) => p.id === "sp-1"));
  await deleteSoundPack(ORG, "sp-1");
  assertEquals(await getSoundPack(ORG, "sp-1"), null);
}});

Deno.test({ name: "gamification settings — save and get", ...kvOpts, fn: async () => {
  await saveGamificationSettings(ORG, { threshold: 5, comboTimeoutMs: 8000, enabled: true, sounds: null });
  const got = await getGamificationSettings(ORG);
  assertEquals(got?.threshold, 5);
}});

Deno.test({ name: "store items — CRUD", ...kvOpts, fn: async () => {
  await saveCustomStoreItem(ORG, { id: "item-1", name: "Crown", description: "Fancy", price: 100, icon: "👑", category: "cosmetics" });
  const list = await listCustomStoreItems(ORG);
  assert(list.some((i) => i.id === "item-1"));
  await deleteCustomStoreItem(ORG, "item-1");
}});

Deno.test({ name: "badges — award and check", ...kvOpts, fn: async () => {
  const badge = { id: "b-1", name: "First Audit", description: "", icon: "", xpReward: 10, rarity: "common" as const };
  const awarded = await awardBadge(ORG, "user@test.com", badge);
  assertEquals(awarded, true);
  const duplicate = await awardBadge(ORG, "user@test.com", badge);
  assertEquals(duplicate, false); // can't award twice
  const earned = await getEarnedBadges(ORG, "user@test.com");
  assert(earned.some((e) => e.badgeId === "b-1"));
}});

Deno.test({ name: "badge stats — get defaults and update", ...kvOpts, fn: async () => {
  const defaults = await getBadgeStats(ORG, "new@test.com");
  assertEquals(defaults.totalAudits, 0);
  const updated = await updateBadgeStats(ORG, "new@test.com", { totalAudits: 5 });
  assertEquals(updated.totalAudits, 5);
}});

Deno.test({ name: "game state — defaults, save, purchase", ...kvOpts, fn: async () => {
  const state = await getGameState(ORG, "player@test.com");
  assertEquals(state.level, 1);
  await saveGameState(ORG, "player@test.com", { ...state, tokenBalance: 200 });
  const result = await purchaseStoreItem(ORG, "player@test.com", "item-x", 50);
  assert(result.ok);
  if (result.ok) assertEquals(result.newBalance, 150);
}});

Deno.test({ name: "purchase — insufficient tokens rejected", ...kvOpts, fn: async () => {
  await saveGameState(ORG, "broke@test.com", { xp: 0, level: 1, dayStreak: 0, cosmetics: {}, totalXp: 0, tokenBalance: 10, purchases: [], lastActiveDate: "" });
  const result = await purchaseStoreItem(ORG, "broke@test.com", "expensive", 100);
  assertEquals(result.ok, false);
}});

Deno.test({ name: "purchase — duplicate rejected", ...kvOpts, fn: async () => {
  await saveGameState(ORG, "dup@test.com", { xp: 0, level: 1, dayStreak: 0, cosmetics: {}, totalXp: 0, tokenBalance: 1000, purchases: ["item-y"], lastActiveDate: "" });
  const result = await purchaseStoreItem(ORG, "dup@test.com", "item-y", 50);
  assertEquals(result.ok, false);
}});
