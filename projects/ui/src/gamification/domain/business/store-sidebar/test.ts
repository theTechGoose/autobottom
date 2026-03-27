import { assertEquals } from "jsr:@std/assert";
import { StoreSidebar } from "./mod.ts";

Deno.test("StoreSidebar - can be instantiated", () => {
  const comp = new StoreSidebar();
  assertEquals(comp instanceof StoreSidebar, true);
});

Deno.test("StoreSidebar - default categories is empty array", () => {
  const comp = new StoreSidebar();
  assertEquals(comp.categories, []);
});

Deno.test("StoreSidebar - default activeCategory is empty string", () => {
  const comp = new StoreSidebar();
  assertEquals(comp.activeCategory, "");
});

Deno.test("StoreSidebar - categories can be set", () => {
  const comp = new StoreSidebar();
  comp.categories = [{ key: "title", label: "Titles", count: 5 }];
  assertEquals(comp.categories.length, 1);
  assertEquals(comp.categories[0].key, "title");
});
