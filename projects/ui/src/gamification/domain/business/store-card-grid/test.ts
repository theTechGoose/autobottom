import { assertEquals } from "jsr:@std/assert";
import { StoreCardGrid } from "./mod.ts";

Deno.test("StoreCardGrid - can be instantiated", () => {
  const comp = new StoreCardGrid();
  assertEquals(comp instanceof StoreCardGrid, true);
});

Deno.test("StoreCardGrid - default items is empty array", () => {
  const comp = new StoreCardGrid();
  assertEquals(comp.items, []);
});

Deno.test("StoreCardGrid - default purchased is empty array", () => {
  const comp = new StoreCardGrid();
  assertEquals(comp.purchased, []);
});

Deno.test("StoreCardGrid - default buying is empty string", () => {
  const comp = new StoreCardGrid();
  assertEquals(comp.buying, "");
});

Deno.test("StoreCardGrid - has buy method", () => {
  const comp = new StoreCardGrid();
  assertEquals(typeof comp.buy, "function");
});

Deno.test("StoreCardGrid - buy sets buying to itemId", () => {
  const comp = new StoreCardGrid();
  comp.buy("item-1");
  assertEquals(comp.buying, "item-1");
});
