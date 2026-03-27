import { assertEquals } from "jsr:@std/assert";
import { PackEditor } from "./mod.ts";

Deno.test("PackEditor - can be instantiated", () => {
  const comp = new PackEditor();
  assertEquals(comp instanceof PackEditor, true);
});

Deno.test("PackEditor - default packId is empty string", () => {
  const comp = new PackEditor();
  assertEquals(comp.packId, "");
});

Deno.test("PackEditor - default packName is empty string", () => {
  const comp = new PackEditor();
  assertEquals(comp.packName, "");
});

Deno.test("PackEditor - default saving is false", () => {
  const comp = new PackEditor();
  assertEquals(comp.saving, false);
});

Deno.test("PackEditor - has saveName method", () => {
  const comp = new PackEditor();
  assertEquals(typeof comp.saveName, "function");
});

Deno.test("PackEditor - packName can be set", () => {
  const comp = new PackEditor();
  comp.packName = "My Custom Pack";
  assertEquals(comp.packName, "My Custom Pack");
});
