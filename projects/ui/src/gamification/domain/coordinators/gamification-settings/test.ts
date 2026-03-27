import { assertEquals } from "jsr:@std/assert";
import { GamificationSettingsCoordinator } from "./mod.ts";

Deno.test("GamificationSettingsCoordinator - can be instantiated", () => {
  const comp = new GamificationSettingsCoordinator();
  assertEquals(comp instanceof GamificationSettingsCoordinator, true);
});

Deno.test("GamificationSettingsCoordinator - default tab is 'settings'", () => {
  const comp = new GamificationSettingsCoordinator();
  assertEquals(comp.tab, "settings");
});

Deno.test("GamificationSettingsCoordinator - default threshold is 0", () => {
  const comp = new GamificationSettingsCoordinator();
  assertEquals(comp.threshold, 0);
});

Deno.test("GamificationSettingsCoordinator - default comboTimeoutMs is 10000", () => {
  const comp = new GamificationSettingsCoordinator();
  assertEquals(comp.comboTimeoutMs, 10000);
});

Deno.test("GamificationSettingsCoordinator - default gsEnabled is true", () => {
  const comp = new GamificationSettingsCoordinator();
  assertEquals(comp.gsEnabled, true);
});

Deno.test("GamificationSettingsCoordinator - default activePack is 'synth'", () => {
  const comp = new GamificationSettingsCoordinator();
  assertEquals(comp.activePack, "synth");
});

Deno.test("GamificationSettingsCoordinator - default role is empty string", () => {
  const comp = new GamificationSettingsCoordinator();
  assertEquals(comp.role, "");
});

Deno.test("GamificationSettingsCoordinator - default packs is empty array", () => {
  const comp = new GamificationSettingsCoordinator();
  assertEquals(comp.packs, []);
});

Deno.test("GamificationSettingsCoordinator - default selectedPackId is empty string", () => {
  const comp = new GamificationSettingsCoordinator();
  assertEquals(comp.selectedPackId, "");
});

Deno.test("GamificationSettingsCoordinator - default toasts is empty array", () => {
  const comp = new GamificationSettingsCoordinator();
  assertEquals(comp.toasts, []);
});

Deno.test("GamificationSettingsCoordinator - has loadSettings method", () => {
  const comp = new GamificationSettingsCoordinator();
  assertEquals(typeof comp.loadSettings, "function");
});

Deno.test("GamificationSettingsCoordinator - has loadPacks method", () => {
  const comp = new GamificationSettingsCoordinator();
  assertEquals(typeof comp.loadPacks, "function");
});

Deno.test("GamificationSettingsCoordinator - has saveSettings method", () => {
  const comp = new GamificationSettingsCoordinator();
  assertEquals(typeof comp.saveSettings, "function");
});

Deno.test("GamificationSettingsCoordinator - has selectPack method", () => {
  const comp = new GamificationSettingsCoordinator();
  assertEquals(typeof comp.selectPack, "function");
});

Deno.test("GamificationSettingsCoordinator - has createPack method", () => {
  const comp = new GamificationSettingsCoordinator();
  assertEquals(typeof comp.createPack, "function");
});

Deno.test("GamificationSettingsCoordinator - has deletePack method", () => {
  const comp = new GamificationSettingsCoordinator();
  assertEquals(typeof comp.deletePack, "function");
});
