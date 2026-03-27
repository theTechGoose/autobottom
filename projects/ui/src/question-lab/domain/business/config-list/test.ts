import { assertEquals } from "jsr:@std/assert";
import { ConfigList } from "./mod.ts";

Deno.test("ConfigList: default configs is empty array", () => {
  const c = new ConfigList();
  assertEquals(c.configs, []);
});

Deno.test("ConfigList: default showNew is false", () => {
  const c = new ConfigList();
  assertEquals(c.showNew, false);
});

Deno.test("ConfigList: default newName is empty string", () => {
  const c = new ConfigList();
  assertEquals(c.newName, "");
});

Deno.test("ConfigList: toggleNew flips showNew from false to true", () => {
  const c = new ConfigList();
  c.toggleNew();
  assertEquals(c.showNew, true);
});

Deno.test("ConfigList: toggleNew flips showNew from true to false", () => {
  const c = new ConfigList();
  c.showNew = true;
  c.toggleNew();
  assertEquals(c.showNew, false);
});

Deno.test("ConfigList: resetForm clears newName and hides form", () => {
  const c = new ConfigList();
  c.showNew = true;
  c.newName = "Test Config";
  c.resetForm();
  assertEquals(c.showNew, false);
  assertEquals(c.newName, "");
});
