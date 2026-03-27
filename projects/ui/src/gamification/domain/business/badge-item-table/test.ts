import { assertEquals } from "jsr:@std/assert";
import { BadgeItemTable } from "./mod.ts";

Deno.test("BadgeItemTable - can be instantiated", () => {
  const comp = new BadgeItemTable();
  assertEquals(comp instanceof BadgeItemTable, true);
});

Deno.test("BadgeItemTable - default items is empty array", () => {
  const comp = new BadgeItemTable();
  assertEquals(comp.items, []);
});

Deno.test("BadgeItemTable - items can be set", () => {
  const comp = new BadgeItemTable();
  comp.items = [{ id: "t1", name: "Title 1", type: "title", icon: "A", price: 100 }];
  assertEquals(comp.items.length, 1);
  assertEquals(comp.items[0].id, "t1");
});
