import { assertEquals } from "@std/assert";
import { orgKey } from "./org.ts";

// ---------------------------------------------------------------------------
// Basic structure: orgId is always the first element
// ---------------------------------------------------------------------------

Deno.test("orgKey: orgId is the first element of the returned tuple", () => {
  const key = orgKey("org-123", "findings", "abc");
  assertEquals(key[0], "org-123");
});

Deno.test("orgKey: returns array with orgId + all parts", () => {
  const key = orgKey("org-123", "findings", "abc");
  assertEquals(key, ["org-123", "findings", "abc"]);
});

// ---------------------------------------------------------------------------
// No additional parts
// ---------------------------------------------------------------------------

Deno.test("orgKey: with no extra parts returns single-element tuple", () => {
  const key = orgKey("org-only");
  assertEquals(key, ["org-only"]);
});

// ---------------------------------------------------------------------------
// One extra part
// ---------------------------------------------------------------------------

Deno.test("orgKey: with one part returns two-element tuple", () => {
  const key = orgKey("org-abc", "users");
  assertEquals(key, ["org-abc", "users"]);
});

// ---------------------------------------------------------------------------
// Multiple parts
// ---------------------------------------------------------------------------

Deno.test("orgKey: with three parts returns four-element tuple", () => {
  const key = orgKey("org-x", "a", "b", "c");
  assertEquals(key, ["org-x", "a", "b", "c"]);
});

// ---------------------------------------------------------------------------
// Numeric parts (Deno.KvKeyPart supports numbers)
// ---------------------------------------------------------------------------

Deno.test("orgKey: numeric parts are preserved as-is", () => {
  const key = orgKey("org-1", "timestamps", 1234567890);
  assertEquals(key, ["org-1", "timestamps", 1234567890]);
});

Deno.test("orgKey: mixed string and number parts", () => {
  const key = orgKey("org-mix", "token-usage", 1700000000, "askQuestion");
  assertEquals(key, ["org-mix", "token-usage", 1700000000, "askQuestion"]);
});

// ---------------------------------------------------------------------------
// Empty-string orgId
// ---------------------------------------------------------------------------

Deno.test("orgKey: empty string orgId is preserved", () => {
  const key = orgKey("", "data");
  assertEquals(key, ["", "data"]);
});

// ---------------------------------------------------------------------------
// Empty-string part
// ---------------------------------------------------------------------------

Deno.test("orgKey: empty string parts are preserved", () => {
  const key = orgKey("org-1", "");
  assertEquals(key, ["org-1", ""]);
});

// ---------------------------------------------------------------------------
// Length matches expectations
// ---------------------------------------------------------------------------

Deno.test("orgKey: length equals 1 + number of parts", () => {
  const key = orgKey("org", "a", "b", "c", "d");
  assertEquals(key.length, 5);
});

// ---------------------------------------------------------------------------
// Typical real-world KV key patterns
// ---------------------------------------------------------------------------

Deno.test("orgKey: findings key pattern", () => {
  const key = orgKey("acme", "findings", "finding-42");
  assertEquals(key, ["acme", "findings", "finding-42"]);
});

Deno.test("orgKey: cache answer key pattern", () => {
  const key = orgKey("acme", "cache", "finding-1", "Was the agent polite?");
  assertEquals(key, ["acme", "cache", "finding-1", "Was the agent polite?"]);
});
