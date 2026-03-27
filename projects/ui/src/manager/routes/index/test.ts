import { assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ManagerRoute } from "./mod.ts";

Deno.test("ManagerRoute - can be instantiated", () => {
  const route = new ManagerRoute();
  assertExists(route);
});
