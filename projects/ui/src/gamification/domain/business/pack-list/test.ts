import { assertEquals } from "jsr:@std/assert";
import { PackList } from "./mod.ts";

Deno.test("PackList - can be instantiated", () => {
  const comp = new PackList();
  assertEquals(comp instanceof PackList, true);
});

Deno.test("PackList - default packs is empty array", () => {
  const comp = new PackList();
  assertEquals(comp.packs, []);
});

Deno.test("PackList - default selectedId is empty string", () => {
  const comp = new PackList();
  assertEquals(comp.selectedId, "");
});

Deno.test("PackList - packs can be set", () => {
  const comp = new PackList();
  comp.packs = [{ id: "p1", name: "Pack 1" }];
  assertEquals(comp.packs.length, 1);
  assertEquals(comp.packs[0].id, "p1");
});

Deno.test("PackList - selectedId can be set", () => {
  const comp = new PackList();
  comp.selectedId = "p1";
  assertEquals(comp.selectedId, "p1");
});
