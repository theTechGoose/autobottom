/** Unit tests for redactCreditCards.
 *  Run: deno test --allow-all src/audit/domain/data/bad-word/redact.test.ts */

import { assertEquals } from "#assert";
import { redactCreditCards } from "./mod.ts";

Deno.test("redactCreditCards — masks Visa/MC 16-digit dashes", () => {
  assertEquals(
    redactCreditCards("CC: 4111-1111-1111-1234"),
    "CC: ****-****-****-1234",
  );
});

Deno.test("redactCreditCards — masks 16-digit space separators", () => {
  assertEquals(
    redactCreditCards("CC: 4111 1111 1111 1234"),
    "CC: **** **** **** 1234",
  );
});

Deno.test("redactCreditCards — masks Amex 15-digit (4-6-5)", () => {
  // Amex card-face format is 4-6-5; the pattern here matches 4-4-4 then
  // optional trailing groups, so the 4-4-4-3 dash form people commonly
  // dictate ("3782-8224-6310-005") is what we catch. 15 digits total →
  // mask first 11, keep last 4: digit 12 ("0") + the trailing "005".
  assertEquals(
    redactCreditCards("Amex: 3782-8224-6310-005"),
    "Amex: ****-****-***0-005",
  );
});

Deno.test("redactCreditCards — masks the truncated 12-digit ASR shape (4-4-4)", () => {
  // The exact transcript shape that triggered this fix:
  // "[CUSTOMER]: Go ahead. 5155-6100-0747etc..."
  assertEquals(
    redactCreditCards("[CUSTOMER]: Go ahead. 5155-6100-0747"),
    "[CUSTOMER]: Go ahead. ****-****-0747",
  );
});

Deno.test("redactCreditCards — masks 16-digit no separators", () => {
  // The 4-4-4 shape requires an optional separator after each group of four.
  // "4111111111111234" has no separators — the (?:[-\s]?\d{1,7})? trailing
  // group still picks up the last 4 because `\d{4}\d{4}\d{4}\d{4}` with all
  // optional separators absent collapses into a 16-digit literal.
  assertEquals(
    redactCreditCards("Number: 4111111111111234"),
    "Number: ************1234",
  );
});

Deno.test("redactCreditCards — masks 19-digit Maestro (4-4-4-4-3)", () => {
  // 19 digits total → mask first 15, keep last 4: digit 16 ("2") plus "345".
  assertEquals(
    redactCreditCards("Card: 6011-1234-5678-9012-345"),
    "Card: ****-****-****-***2-345",
  );
});

Deno.test("redactCreditCards — multiple cards in same transcript", () => {
  const input = "Old: 4111-1111-1111-1111. New: 5555-4444-3333-2222.";
  const expected = "Old: ****-****-****-1111. New: ****-****-****-2222.";
  assertEquals(redactCreditCards(input), expected);
});

Deno.test("redactCreditCards — leaves phone numbers alone (10 digits, 3-3-4)", () => {
  assertEquals(
    redactCreditCards("Call us at 555-123-4567 today."),
    "Call us at 555-123-4567 today.",
  );
});

Deno.test("redactCreditCards — leaves 7-digit phone alone", () => {
  assertEquals(
    redactCreditCards("Ext. 555-1234"),
    "Ext. 555-1234",
  );
});

Deno.test("redactCreditCards — leaves dates and short order numbers alone", () => {
  assertEquals(
    redactCreditCards("Order #12345 placed on 2026-05-06"),
    "Order #12345 placed on 2026-05-06",
  );
});

Deno.test("redactCreditCards — leaves 4-4 (8-digit) order/reference numbers alone", () => {
  // Critical false-positive guard: the {2,3} repeat in the regex requires at
  // least three 4-digit groups (12+ digits), so a typical 4-4 reference
  // ("1234-5678") doesn't trip the masker.
  assertEquals(
    redactCreditCards("Confirmation 1234-5678 received."),
    "Confirmation 1234-5678 received.",
  );
});

Deno.test("redactCreditCards — does not match inside a longer digit run", () => {
  // "1234567890123456789012" is 22 digits — no separators, longer than 19.
  // Our (?!\d) lookahead means the pattern can't anchor at any 4-digit
  // sub-window without bumping into more digits, so nothing matches.
  assertEquals(
    redactCreditCards("ID 1234567890123456789012"),
    "ID 1234567890123456789012",
  );
});

Deno.test("redactCreditCards — preserves character positions (length-preserving)", () => {
  const input = "AAA 5155-6100-0747-1234 BBB";
  const out = redactCreditCards(input);
  assertEquals(out.length, input.length, "length must be preserved so highlight offsets line up");
  // Specific positions: AAA at 0-2 unchanged; CC starts at 4.
  assertEquals(out.slice(0, 4), "AAA ");
  assertEquals(out.slice(4, 23), "****-****-****-1234");
  assertEquals(out.slice(23), " BBB");
});

Deno.test("redactCreditCards — handles empty / undefined", () => {
  assertEquals(redactCreditCards(""), "");
  // Type system guarantees string, but defensive zero-input behaviour matters.
});

Deno.test("redactCreditCards — leaves alphabetic content untouched", () => {
  assertEquals(
    redactCreditCards("[CUSTOMER]: Go ahead. We accept cash only."),
    "[CUSTOMER]: Go ahead. We accept cash only.",
  );
});
