import { assertEquals } from "jsr:@std/assert";
import { StoreCoordinator } from "./mod.ts";

Deno.test("StoreCoordinator - can be instantiated", () => {
  const comp = new StoreCoordinator();
  assertEquals(comp instanceof StoreCoordinator, true);
});

Deno.test("StoreCoordinator - default loading is true", () => {
  const comp = new StoreCoordinator();
  assertEquals(comp.loading, true);
});

Deno.test("StoreCoordinator - default items is empty array", () => {
  const comp = new StoreCoordinator();
  assertEquals(comp.items, []);
});

Deno.test("StoreCoordinator - default balance is 0", () => {
  const comp = new StoreCoordinator();
  assertEquals(comp.balance, 0);
});

Deno.test("StoreCoordinator - default purchased is empty array", () => {
  const comp = new StoreCoordinator();
  assertEquals(comp.purchased, []);
});

Deno.test("StoreCoordinator - default level is 1", () => {
  const comp = new StoreCoordinator();
  assertEquals(comp.level, 1);
});

Deno.test("StoreCoordinator - default totalXp is 0", () => {
  const comp = new StoreCoordinator();
  assertEquals(comp.totalXp, 0);
});

Deno.test("StoreCoordinator - default activeCategory is empty string", () => {
  const comp = new StoreCoordinator();
  assertEquals(comp.activeCategory, "");
});

Deno.test("StoreCoordinator - default toasts is empty array", () => {
  const comp = new StoreCoordinator();
  assertEquals(comp.toasts, []);
});

Deno.test("StoreCoordinator - has loadStore method", () => {
  const comp = new StoreCoordinator();
  assertEquals(typeof comp.loadStore, "function");
});

Deno.test("StoreCoordinator - has buyItem method", () => {
  const comp = new StoreCoordinator();
  assertEquals(typeof comp.buyItem, "function");
});
