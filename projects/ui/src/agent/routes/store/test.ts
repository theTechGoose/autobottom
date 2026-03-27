import { assertEquals } from "jsr:@std/assert";
import { StoreRoute } from "./mod.ts";

Deno.test("StoreRoute - can be instantiated", () => {
  const route = new StoreRoute();
  assertEquals(route instanceof StoreRoute, true);
});
