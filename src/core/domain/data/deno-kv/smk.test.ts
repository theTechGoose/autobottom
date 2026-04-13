import { assertEquals } from "jsr:@std/assert";
import { orgKey } from "./mod.ts";

Deno.test("orgKey — prefixes with orgId", () => {
  const key = orgKey("org-123", "review-pending", "finding-1", 0);
  assertEquals(key, ["org-123", "review-pending", "finding-1", 0]);
});

Deno.test("orgKey — single part", () => {
  const key = orgKey("org-1", "config");
  assertEquals(key, ["org-1", "config"]);
});

Deno.test("orgKey — no parts returns just orgId", () => {
  const key = orgKey("org-1");
  assertEquals(key, ["org-1"]);
});
