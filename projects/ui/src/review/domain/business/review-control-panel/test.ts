import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ReviewControlPanel } from "./mod.ts";

Deno.test("ReviewControlPanel - can be instantiated", () => {
  const panel = new ReviewControlPanel();
  assertEquals(typeof panel, "object");
});

Deno.test("ReviewControlPanel - busy defaults to false", () => {
  const panel = new ReviewControlPanel();
  assertEquals(panel.busy, false);
});

Deno.test("ReviewControlPanel - hasItem defaults to false", () => {
  const panel = new ReviewControlPanel();
  assertEquals(panel.hasItem, false);
});

Deno.test("ReviewControlPanel - has onConfirm method", () => {
  const panel = new ReviewControlPanel();
  assertEquals(typeof panel.onConfirm, "function");
});

Deno.test("ReviewControlPanel - has onFlip method", () => {
  const panel = new ReviewControlPanel();
  assertEquals(typeof panel.onFlip, "function");
});

Deno.test("ReviewControlPanel - has onUndo method", () => {
  const panel = new ReviewControlPanel();
  assertEquals(typeof panel.onUndo, "function");
});
