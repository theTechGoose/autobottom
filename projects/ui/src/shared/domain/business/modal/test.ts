import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { Modal } from "./mod.ts";

Deno.test("Modal - default open is false", () => {
  const modal = new Modal();
  assertEquals(modal.open, false);
});

Deno.test("Modal - default title is empty string", () => {
  const modal = new Modal();
  assertEquals(modal.title, "");
});

Deno.test("Modal - open can be set to true", () => {
  const modal = new Modal();
  modal.open = true;
  assertEquals(modal.open, true);
});

Deno.test("Modal - title can be set", () => {
  const modal = new Modal();
  modal.title = "Confirm Action";
  assertEquals(modal.title, "Confirm Action");
});
