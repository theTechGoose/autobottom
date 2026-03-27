import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { LoginRoute } from "./mod.ts";

Deno.test("LoginRoute - can be instantiated", () => {
  const route = new LoginRoute();
  assertEquals(route instanceof LoginRoute, true);
});
