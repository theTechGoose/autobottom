import { assertEquals } from "@std/assert";
import { strToBool } from "./mod.ts";

// ---------------------------------------------------------------------------
// Truthy values
// ---------------------------------------------------------------------------

Deno.test("strToBool: 'yes' returns true", () => {
  assertEquals(strToBool("yes"), true);
});

Deno.test("strToBool: 'y' returns true", () => {
  assertEquals(strToBool("y"), true);
});

Deno.test("strToBool: 'true' returns true", () => {
  assertEquals(strToBool("true"), true);
});

Deno.test("strToBool: '1' returns true", () => {
  assertEquals(strToBool("1"), true);
});

// ---------------------------------------------------------------------------
// Truthy values — case insensitive
// ---------------------------------------------------------------------------

Deno.test("strToBool: 'YES' returns true", () => {
  assertEquals(strToBool("YES"), true);
});

Deno.test("strToBool: 'Yes' returns true", () => {
  assertEquals(strToBool("Yes"), true);
});

Deno.test("strToBool: 'TRUE' returns true", () => {
  assertEquals(strToBool("TRUE"), true);
});

Deno.test("strToBool: 'Y' returns true", () => {
  assertEquals(strToBool("Y"), true);
});

// ---------------------------------------------------------------------------
// Falsy values
// ---------------------------------------------------------------------------

Deno.test("strToBool: 'no' returns false", () => {
  assertEquals(strToBool("no"), false);
});

Deno.test("strToBool: 'n' returns false", () => {
  assertEquals(strToBool("n"), false);
});

Deno.test("strToBool: 'false' returns false", () => {
  assertEquals(strToBool("false"), false);
});

Deno.test("strToBool: '0' returns false", () => {
  assertEquals(strToBool("0"), false);
});

// ---------------------------------------------------------------------------
// Falsy values — case insensitive
// ---------------------------------------------------------------------------

Deno.test("strToBool: 'NO' returns false", () => {
  assertEquals(strToBool("NO"), false);
});

Deno.test("strToBool: 'No' returns false", () => {
  assertEquals(strToBool("No"), false);
});

Deno.test("strToBool: 'FALSE' returns false", () => {
  assertEquals(strToBool("FALSE"), false);
});

Deno.test("strToBool: 'N' returns false", () => {
  assertEquals(strToBool("N"), false);
});

// ---------------------------------------------------------------------------
// Whitespace trimming
// ---------------------------------------------------------------------------

Deno.test("strToBool: '  yes  ' returns true (trims whitespace)", () => {
  assertEquals(strToBool("  yes  "), true);
});

Deno.test("strToBool: '  no  ' returns false (trims whitespace)", () => {
  assertEquals(strToBool("  no  "), false);
});

Deno.test("strToBool: '  true  ' returns true (trims whitespace)", () => {
  assertEquals(strToBool("  true  "), true);
});

// ---------------------------------------------------------------------------
// Unrecognized values return null
// ---------------------------------------------------------------------------

Deno.test("strToBool: empty string returns null", () => {
  assertEquals(strToBool(""), null);
});

Deno.test("strToBool: 'maybe' returns null", () => {
  assertEquals(strToBool("maybe"), null);
});

Deno.test("strToBool: 'ok' returns null", () => {
  assertEquals(strToBool("ok"), null);
});

Deno.test("strToBool: '2' returns null", () => {
  assertEquals(strToBool("2"), null);
});

Deno.test("strToBool: arbitrary string returns null", () => {
  assertEquals(strToBool("some random text"), null);
});
