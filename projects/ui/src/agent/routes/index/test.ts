import { assertEquals } from "jsr:@std/assert";
import { IndexRoute } from "./mod.ts";

Deno.test("IndexRoute - can be instantiated", () => {
  const route = new IndexRoute();
  assertEquals(route instanceof IndexRoute, true);
});
