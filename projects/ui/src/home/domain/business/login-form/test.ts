import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { LoginForm } from "./mod.ts";

Deno.test("LoginForm - default loading is false", () => {
  const form = new LoginForm();
  assertEquals(form.loading, false);
});

Deno.test("LoginForm - default error is empty string", () => {
  const form = new LoginForm();
  assertEquals(form.error, "");
});

Deno.test("LoginForm - ROLE_REDIRECTS has expected keys", () => {
  const form = new LoginForm();
  const keys = Object.keys(form.ROLE_REDIRECTS);
  assertEquals(keys.includes("admin"), true);
  assertEquals(keys.includes("judge"), true);
  assertEquals(keys.includes("manager"), true);
  assertEquals(keys.includes("reviewer"), true);
  assertEquals(keys.includes("user"), true);
});

Deno.test("LoginForm - ROLE_REDIRECTS maps to correct paths", () => {
  const form = new LoginForm();
  assertEquals(form.ROLE_REDIRECTS["admin"], "/admin/dashboard");
  assertEquals(form.ROLE_REDIRECTS["judge"], "/judge/dashboard");
  assertEquals(form.ROLE_REDIRECTS["manager"], "/manager");
  assertEquals(form.ROLE_REDIRECTS["reviewer"], "/review/dashboard");
  assertEquals(form.ROLE_REDIRECTS["user"], "/agent");
});
