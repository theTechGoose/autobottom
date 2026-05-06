/** End-to-end exclusion-rule tests for detectBadWords. */
import { assertEquals, assert } from "#assert";
import { detectBadWords, type BadWordEntry } from "./mod.ts";

Deno.test("detectBadWords — prefix exclusion suppresses match when keyword precedes within buffer", () => {
  const entries: BadWordEntry[] = [{
    word: "free",
    exclusions: [{ word: "toll", buffer: 1, type: "prefix" }],
  }];
  const result = detectBadWords("Please call our toll free number now", entries);
  assertEquals(result.violations.length, 0);
  assertEquals(result.matches.length, 0);
});

Deno.test("detectBadWords — prefix exclusion does NOT fire when keyword is outside buffer", () => {
  const entries: BadWordEntry[] = [{
    word: "free",
    exclusions: [{ word: "toll", buffer: 1, type: "prefix" }],
  }];
  // "toll" is 3 words before "free" → outside buffer of 1 → match should fire
  const result = detectBadWords("a toll booth on the highway is free today", entries);
  assert(result.violations.includes("free"));
});

Deno.test("detectBadWords — suffix exclusion suppresses match when keyword follows within buffer", () => {
  const entries: BadWordEntry[] = [{
    word: "free",
    exclusions: [{ word: "shipping", buffer: 2, type: "suffix" }],
  }];
  const result = detectBadWords("we offer free shipping today", entries);
  assertEquals(result.violations.length, 0);
});

Deno.test("detectBadWords — match fires when transcript has no exclusion keyword", () => {
  const entries: BadWordEntry[] = [{
    word: "free",
    exclusions: [{ word: "toll", buffer: 1, type: "prefix" }],
  }];
  const result = detectBadWords("everything is free for our guests", entries);
  assert(result.violations.includes("free"));
  assert(result.matches.length > 0);
});

Deno.test("detectBadWords — string-typed entry (no exclusions) still works alongside object entries", () => {
  const entries: (BadWordEntry | string)[] = [
    "guaranteed",
    { word: "free", exclusions: [{ word: "toll", buffer: 1, type: "prefix" }] },
  ];
  const result = detectBadWords("we guaranteed a toll free number", entries);
  // "guaranteed" plain word matches, "free" is excluded by toll-prefix
  assertEquals(result.violations.includes("guaranteed"), true);
  assertEquals(result.violations.includes("free"), false);
});

Deno.test("detectBadWords — multiple exclusion rules — any rule firing suppresses the match", () => {
  const entries: BadWordEntry[] = [{
    word: "free",
    exclusions: [
      { word: "toll", buffer: 1, type: "prefix" },
      { word: "shipping", buffer: 1, type: "suffix" },
    ],
  }];
  // Suffix rule fires
  const r1 = detectBadWords("we offer free shipping today", entries);
  assertEquals(r1.violations.length, 0);
  // Prefix rule fires
  const r2 = detectBadWords("call our toll free number", entries);
  assertEquals(r2.violations.length, 0);
  // Neither fires
  const r3 = detectBadWords("everything is free here", entries);
  assert(r3.violations.includes("free"));
});
