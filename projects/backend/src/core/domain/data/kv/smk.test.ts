/**
 * Smoke test for kv module.
 * Verifies the Kv class exports exist and have the expected types.
 * Does NOT call the functions (env vars / KV are not set in test).
 */

import { assert, assertEquals } from "@std/assert";
import { Kv } from "./mod.ts";
import { KvTestHelpers } from "./test-helpers.ts";

Deno.test("Kv — is a class with static methods", () => {
  assertEquals(typeof Kv, "function"); // class is a function
  assertEquals(typeof Kv.getInstance, "function");
  assertEquals(typeof Kv.setInstance, "function");
  assertEquals(typeof Kv.resetInstance, "function");
  assertEquals(typeof Kv.orgKey, "function");
});

Deno.test("Kv — orgKey returns org-scoped key", () => {
  const key = Kv.orgKey("org1", "audit", "123");
  assertEquals(key, ["org1", "audit", "123"]);
});

Deno.test("Kv — instance has expected methods", async () => {
  const kv = await KvTestHelpers.fresh();

  const expectedMethods = [
    "getFinding",
    "saveFinding",
    "getJob",
    "saveJob",
    "getCachedAnswer",
    "cacheAnswer",
    "getCachedQuestions",
    "cacheQuestions",
    "setBatchCounter",
    "decrementBatchCounter",
    "savePopulatedQuestions",
    "getPopulatedQuestions",
    "saveBatchAnswers",
    "getAllBatchAnswers",
    "getAllAnswersForFinding",
    "trackActive",
    "trackCompleted",
    "trackError",
    "trackRetry",
    "getStats",
    "saveTranscript",
    "getTranscript",
    "getPipelineConfig",
    "setPipelineConfig",
    "getWebhookConfig",
    "saveWebhookConfig",
    "fireWebhook",
    "listEmailReportConfigs",
    "getEmailReportConfig",
    "saveEmailReportConfig",
    "deleteEmailReportConfig",
    "listSoundPacks",
    "getSoundPack",
    "saveSoundPack",
    "deleteSoundPack",
    "getGamificationSettings",
    "saveGamificationSettings",
    "getJudgeGamificationOverride",
    "saveJudgeGamificationOverride",
    "getReviewerGamificationOverride",
    "saveReviewerGamificationOverride",
    "resolveGamificationSettings",
    "listCustomStoreItems",
    "saveCustomStoreItem",
    "deleteCustomStoreItem",
    "getEarnedBadges",
    "awardBadge",
    "hasBadge",
    "getBadgeStats",
    "updateBadgeStats",
    "getGameState",
    "saveGameState",
    "awardXp",
    "purchaseStoreItem",
    "emitEvent",
    "getEvents",
    "deleteEvents",
    "getPrefabSubscriptions",
    "savePrefabSubscriptions",
    "emitBroadcastEvent",
    "getBroadcastEvents",
    "checkAndEmitPrefab",
    "sendMessage",
    "getConversation",
    "getUnreadCount",
    "markConversationRead",
    "getConversationList",
  ];

  for (const name of expectedMethods) {
    assert(
      typeof (kv as unknown as Record<string, unknown>)[name] === "function",
      `Missing instance method: ${name}`,
    );
  }

  assert(kv.db instanceof Deno.Kv, "kv.db should be a Deno.Kv instance");

  kv.db.close();
});

Deno.test("KvTestHelpers — is a class with static methods", () => {
  assertEquals(typeof KvTestHelpers, "function");
  assertEquals(typeof KvTestHelpers.fresh, "function");
  assertEquals(typeof KvTestHelpers.clear, "function");
});

Deno.test("KvTestHelpers.fresh — returns a Kv instance", async () => {
  const kv = await KvTestHelpers.fresh();
  assert(kv instanceof Kv, "fresh() should return a Kv instance");
  assert(kv.db instanceof Deno.Kv, "kv.db should be a Deno.Kv instance");
  kv.db.close();
});

Deno.test("KvTestHelpers.clear — removes all entries", async () => {
  const kv = await KvTestHelpers.fresh();
  await kv.db.set(["test", "key"], "value");
  await KvTestHelpers.clear(kv);
  const entry = await kv.db.get(["test", "key"]);
  assertEquals(entry.value, null);
  kv.db.close();
});
