import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { IndexRoute } from "./mod.ts";

Deno.test("IndexRoute - can be instantiated", () => {
  const route = new IndexRoute();
  assertEquals(route instanceof IndexRoute, true);
});
