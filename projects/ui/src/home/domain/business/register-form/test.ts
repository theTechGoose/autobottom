import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { RegisterForm } from "./mod.ts";

Deno.test("RegisterForm - default loading is false", () => {
  const form = new RegisterForm();
  assertEquals(form.loading, false);
});

Deno.test("RegisterForm - default error is empty string", () => {
  const form = new RegisterForm();
  assertEquals(form.error, "");
});
