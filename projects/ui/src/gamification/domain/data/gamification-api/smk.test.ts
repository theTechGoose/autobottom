import { assertEquals, assertExists } from "jsr:@std/assert";
import { GamificationApi } from "./mod.ts";

Deno.test("GamificationApi: class can be instantiated", () => {
  const api = new GamificationApi();
  assertExists(api);
});

Deno.test("GamificationApi: has getSettings method", () => {
  const api = new GamificationApi();
  assertEquals(typeof api.getSettings, "function");
});

Deno.test("GamificationApi: has saveSettings method", () => {
  const api = new GamificationApi();
  assertEquals(typeof api.saveSettings, "function");
});

Deno.test("GamificationApi: has getPacks method", () => {
  const api = new GamificationApi();
  assertEquals(typeof api.getPacks, "function");
});

Deno.test("GamificationApi: has createPack method", () => {
  const api = new GamificationApi();
  assertEquals(typeof api.createPack, "function");
});

Deno.test("GamificationApi: has updatePack method", () => {
  const api = new GamificationApi();
  assertEquals(typeof api.updatePack, "function");
});

Deno.test("GamificationApi: has deletePack method", () => {
  const api = new GamificationApi();
  assertEquals(typeof api.deletePack, "function");
});

Deno.test("GamificationApi: has uploadSlot method", () => {
  const api = new GamificationApi();
  assertEquals(typeof api.uploadSlot, "function");
});

Deno.test("GamificationApi: has seedPacks method", () => {
  const api = new GamificationApi();
  assertEquals(typeof api.seedPacks, "function");
});

Deno.test("GamificationApi: has getStore method", () => {
  const api = new GamificationApi();
  assertEquals(typeof api.getStore, "function");
});

Deno.test("GamificationApi: has buyItem method", () => {
  const api = new GamificationApi();
  assertEquals(typeof api.buyItem, "function");
});

Deno.test("GamificationApi: has getBadgeItems method", () => {
  const api = new GamificationApi();
  assertEquals(typeof api.getBadgeItems, "function");
});

Deno.test("GamificationApi: has saveBadgeItem method", () => {
  const api = new GamificationApi();
  assertEquals(typeof api.saveBadgeItem, "function");
});

Deno.test("GamificationApi: has deleteBadgeItem method", () => {
  const api = new GamificationApi();
  assertEquals(typeof api.deleteBadgeItem, "function");
});
