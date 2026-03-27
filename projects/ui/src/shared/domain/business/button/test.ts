import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { Button } from "./mod.ts";

Deno.test("Button - default disabled is false", () => {
  const btn = new Button();
  assertEquals(btn.disabled, false);
});

Deno.test("Button - disabled can be set to true", () => {
  const btn = new Button();
  btn.disabled = true;
  assertEquals(btn.disabled, true);
});
