import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { GameUi } from "./mod.ts";

// --- Default property values ---

Deno.test("GameUi - default combo is 0", () => {
  const ui = new GameUi();
  assertEquals(ui.combo, 0);
});

Deno.test("GameUi - default level is 1", () => {
  const ui = new GameUi();
  assertEquals(ui.level, 1);
});

Deno.test("GameUi - default xpBarPct is 0", () => {
  const ui = new GameUi();
  assertEquals(ui.xpBarPct, 0);
});

Deno.test("GameUi - default xpDisplay is '0 / 100'", () => {
  const ui = new GameUi();
  assertEquals(ui.xpDisplay, "0 / 100");
});

Deno.test("GameUi - default streakDays is 0", () => {
  const ui = new GameUi();
  assertEquals(ui.streakDays, 0);
});

Deno.test("GameUi - default progressPct is 0", () => {
  const ui = new GameUi();
  assertEquals(ui.progressPct, 0);
});

Deno.test("GameUi - default progressLabel is '0 / 0'", () => {
  const ui = new GameUi();
  assertEquals(ui.progressLabel, "0 / 0");
});

Deno.test("GameUi - default timeBankVal is 0", () => {
  const ui = new GameUi();
  assertEquals(ui.timeBankVal, 0);
});

Deno.test("GameUi - default streakBannerText is empty string", () => {
  const ui = new GameUi();
  assertEquals(ui.streakBannerText, "");
});

Deno.test("GameUi - default streakBannerVisible is false", () => {
  const ui = new GameUi();
  assertEquals(ui.streakBannerVisible, false);
});

Deno.test("GameUi - default streakBannerCls is empty string", () => {
  const ui = new GameUi();
  assertEquals(ui.streakBannerCls, "");
});

// --- Properties can be set ---

Deno.test("GameUi - combo can be set", () => {
  const ui = new GameUi();
  ui.combo = 5;
  assertEquals(ui.combo, 5);
});

Deno.test("GameUi - level can be set", () => {
  const ui = new GameUi();
  ui.level = 7;
  assertEquals(ui.level, 7);
});

Deno.test("GameUi - xpBarPct can be set", () => {
  const ui = new GameUi();
  ui.xpBarPct = 75.5;
  assertEquals(ui.xpBarPct, 75.5);
});

Deno.test("GameUi - xpDisplay can be set", () => {
  const ui = new GameUi();
  ui.xpDisplay = "500 / 1000";
  assertEquals(ui.xpDisplay, "500 / 1000");
});

Deno.test("GameUi - streakDays can be set", () => {
  const ui = new GameUi();
  ui.streakDays = 14;
  assertEquals(ui.streakDays, 14);
});

Deno.test("GameUi - progressPct can be set", () => {
  const ui = new GameUi();
  ui.progressPct = 42;
  assertEquals(ui.progressPct, 42);
});

Deno.test("GameUi - progressLabel can be set", () => {
  const ui = new GameUi();
  ui.progressLabel = "12 / 30";
  assertEquals(ui.progressLabel, "12 / 30");
});

Deno.test("GameUi - streakBannerText and visibility can be set", () => {
  const ui = new GameUi();
  ui.streakBannerText = "TRIPLE KILL";
  ui.streakBannerVisible = true;
  ui.streakBannerCls = "s-triple";
  assertEquals(ui.streakBannerText, "TRIPLE KILL");
  assertEquals(ui.streakBannerVisible, true);
  assertEquals(ui.streakBannerCls, "s-triple");
});

Deno.test("GameUi - timeBankVal can be set", () => {
  const ui = new GameUi();
  ui.timeBankVal = 8.5;
  assertEquals(ui.timeBankVal, 8.5);
});
