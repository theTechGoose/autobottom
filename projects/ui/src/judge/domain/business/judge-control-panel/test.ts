import { assertEquals } from "jsr:@std/assert";
import { JudgeControlPanel } from "./mod.ts";

Deno.test("JudgeControlPanel - default busy is false", () => {
  const panel = new JudgeControlPanel();
  assertEquals(panel.busy, false);
});

Deno.test("JudgeControlPanel - default hasItem is false", () => {
  const panel = new JudgeControlPanel();
  assertEquals(panel.hasItem, false);
});

Deno.test("JudgeControlPanel - busy can be set to true", () => {
  const panel = new JudgeControlPanel();
  panel.busy = true;
  assertEquals(panel.busy, true);
});

Deno.test("JudgeControlPanel - hasItem can be set to true", () => {
  const panel = new JudgeControlPanel();
  panel.hasItem = true;
  assertEquals(panel.hasItem, true);
});
