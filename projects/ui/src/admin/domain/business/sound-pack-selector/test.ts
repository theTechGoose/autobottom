import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { SoundPackSelector } from "./mod.ts";

Deno.test("SoundPackSelector - default packs has 3 items", () => {
  const selector = new SoundPackSelector();
  assertEquals(selector.packs.length, 3);
  assertEquals(selector.packs, ["default", "retro", "arcade"]);
});

Deno.test("SoundPackSelector - default selectedPacks is empty array", () => {
  const selector = new SoundPackSelector();
  assertEquals(selector.selectedPacks, []);
});

Deno.test("SoundPackSelector - has togglePack method", () => {
  const selector = new SoundPackSelector();
  assertEquals(typeof selector.togglePack, "function");
});

Deno.test("SoundPackSelector - has isSelected method", () => {
  const selector = new SoundPackSelector();
  assertEquals(typeof selector.isSelected, "function");
});

Deno.test("SoundPackSelector - togglePack adds pack to selectedPacks", () => {
  const selector = new SoundPackSelector();
  selector.togglePack("retro");
  assertEquals(selector.selectedPacks, ["retro"]);
});

Deno.test("SoundPackSelector - togglePack removes already-selected pack", () => {
  const selector = new SoundPackSelector();
  selector.togglePack("retro");
  selector.togglePack("retro");
  assertEquals(selector.selectedPacks, []);
});

Deno.test("SoundPackSelector - isSelected returns correct boolean", () => {
  const selector = new SoundPackSelector();
  assertEquals(selector.isSelected("retro"), false);
  selector.togglePack("retro");
  assertEquals(selector.isSelected("retro"), true);
});
