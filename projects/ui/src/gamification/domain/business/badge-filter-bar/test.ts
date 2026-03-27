import { assertEquals } from "jsr:@std/assert";
import { BadgeFilterBar } from "./mod.ts";

Deno.test("BadgeFilterBar - can be instantiated", () => {
  const comp = new BadgeFilterBar();
  assertEquals(comp instanceof BadgeFilterBar, true);
});

Deno.test("BadgeFilterBar - default activeFilter is 'all'", () => {
  const comp = new BadgeFilterBar();
  assertEquals(comp.activeFilter, "all");
});

Deno.test("BadgeFilterBar - default filters is empty array", () => {
  const comp = new BadgeFilterBar();
  assertEquals(comp.filters, []);
});

Deno.test("BadgeFilterBar - filters can be set", () => {
  const comp = new BadgeFilterBar();
  comp.filters = ["title", "avatar_frame", "name_color"];
  assertEquals(comp.filters.length, 3);
});

Deno.test("BadgeFilterBar - activeFilter can be set", () => {
  const comp = new BadgeFilterBar();
  comp.activeFilter = "title";
  assertEquals(comp.activeFilter, "title");
});
