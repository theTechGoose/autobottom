import { assertEquals } from "jsr:@std/assert";
import { GamificationSettingsTab } from "./mod.ts";

Deno.test("GamificationSettingsTab - can be instantiated", () => {
  const comp = new GamificationSettingsTab();
  assertEquals(comp instanceof GamificationSettingsTab, true);
});

Deno.test("GamificationSettingsTab - default threshold is 0", () => {
  const comp = new GamificationSettingsTab();
  assertEquals(comp.threshold, 0);
});

Deno.test("GamificationSettingsTab - default comboTimeoutMs is 10000", () => {
  const comp = new GamificationSettingsTab();
  assertEquals(comp.comboTimeoutMs, 10000);
});

Deno.test("GamificationSettingsTab - default gsEnabled is true", () => {
  const comp = new GamificationSettingsTab();
  assertEquals(comp.gsEnabled, true);
});

Deno.test("GamificationSettingsTab - default activePack is synth", () => {
  const comp = new GamificationSettingsTab();
  assertEquals(comp.activePack, "synth");
});

Deno.test("GamificationSettingsTab - default role is empty string", () => {
  const comp = new GamificationSettingsTab();
  assertEquals(comp.role, "");
});

Deno.test("GamificationSettingsTab - default packOptions is empty array", () => {
  const comp = new GamificationSettingsTab();
  assertEquals(comp.packOptions, []);
});

Deno.test("GamificationSettingsTab - has collectValues method", () => {
  const comp = new GamificationSettingsTab();
  assertEquals(typeof comp.collectValues, "function");
});

Deno.test("GamificationSettingsTab - collectValues returns current state", () => {
  const comp = new GamificationSettingsTab();
  comp.threshold = 5;
  comp.comboTimeoutMs = 8000;
  comp.gsEnabled = false;
  comp.activePack = "custom-pack";
  const values = comp.collectValues();
  assertEquals(values.threshold, 5);
  assertEquals(values.comboTimeoutMs, 8000);
  assertEquals(values.gsEnabled, false);
  assertEquals(values.activePack, "custom-pack");
});
