import { assertEquals, assertExists } from "jsr:@std/assert";
import { ImpersonateBar } from "./mod.ts";

Deno.test("ImpersonateBar: class can be instantiated", () => {
  const bar = new ImpersonateBar();
  assertExists(bar);
});

Deno.test("ImpersonateBar: targetRole property exists", () => {
  const bar = new ImpersonateBar();
  assertEquals(typeof bar.targetRole, "string");
});

Deno.test("ImpersonateBar: currentAsEmail defaults to empty string", () => {
  const bar = new ImpersonateBar();
  assertEquals(bar.currentAsEmail, "");
});

Deno.test("ImpersonateBar: users defaults to empty array", () => {
  const bar = new ImpersonateBar();
  assertEquals(bar.users.length, 0);
});

Deno.test("ImpersonateBar: targetRole can be set", () => {
  const bar = new ImpersonateBar();
  bar.targetRole = "agent";
  assertEquals(bar.targetRole, "agent");
});

Deno.test("ImpersonateBar: currentAsEmail can be set", () => {
  const bar = new ImpersonateBar();
  bar.currentAsEmail = "test@example.com";
  assertEquals(bar.currentAsEmail, "test@example.com");
});

Deno.test("ImpersonateBar: users can be populated", () => {
  const bar = new ImpersonateBar();
  bar.users = [
    { email: "user1@example.com", role: "agent" },
    { email: "user2@example.com", role: "agent" },
  ];
  assertEquals(bar.users.length, 2);
  assertEquals(bar.users[0].email, "user1@example.com");
});
