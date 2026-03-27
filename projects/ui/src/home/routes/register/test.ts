import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { RegisterRoute } from "./mod.ts";

Deno.test("RegisterRoute - can be instantiated", () => {
  const route = new RegisterRoute();
  assertEquals(route instanceof RegisterRoute, true);
});
