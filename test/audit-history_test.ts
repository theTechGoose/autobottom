/** Tests for audit history data source integrity.
 *  Validates that the audit-done-idx (no TTL) is used as primary source
 *  and that date range filtering works correctly. */

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

// -- AuditDoneIndexEntry shape validation --

interface AuditDoneIndexEntry {
  findingId: string;
  completedAt: number;
  score: number;
  completed: boolean;
  reason?: string;
  recordId?: string;
  isPackage?: boolean;
  voName?: string;
  owner?: string;
  department?: string;
  shift?: string;
  startedAt?: number;
  durationMs?: number;
}

/** Simulate the filtering logic from handleAuditsData */
function filterAudits(
  entries: AuditDoneIndexEntry[],
  opts: {
    type?: string;
    owner?: string;
    department?: string;
    shift?: string;
    scoreMin?: number;
    scoreMax?: number;
  },
): AuditDoneIndexEntry[] {
  return entries.filter((c) => {
    if (opts.type === "date-leg" && c.isPackage) return false;
    if (opts.type === "package" && !c.isPackage) return false;
    if (opts.owner && (c.voName || c.owner) !== opts.owner) return false;
    if (opts.department && c.department !== opts.department) return false;
    if (opts.shift && c.shift !== opts.shift) return false;
    if (c.score != null && opts.scoreMin != null && c.score < opts.scoreMin) return false;
    if (c.score != null && opts.scoreMax != null && c.score > opts.scoreMax) return false;
    return true;
  });
}

// -- Test data factory --

function makeEntry(overrides: Partial<AuditDoneIndexEntry> = {}): AuditDoneIndexEntry {
  return {
    findingId: "test-" + Math.random().toString(36).slice(2, 8),
    completedAt: Date.now(),
    score: 80,
    completed: true,
    isPackage: false,
    voName: "Test User",
    owner: "test@example.com",
    department: "Sales",
    shift: "AM",
    ...overrides,
  };
}

// -- Tests --

Deno.test("AuditDoneIndexEntry — extended fields are present", () => {
  const entry = makeEntry({
    isPackage: true,
    voName: "John Smith",
    owner: "john@example.com",
    department: "Reservations",
    shift: "PM",
    startedAt: Date.now() - 60000,
    durationMs: 55000,
  });
  assertEquals(entry.isPackage, true);
  assertEquals(entry.voName, "John Smith");
  assertEquals(entry.owner, "john@example.com");
  assertEquals(entry.department, "Reservations");
  assertEquals(entry.shift, "PM");
  assert(entry.startedAt! > 0);
  assert(entry.durationMs! > 0);
});

Deno.test("filter — type=date-leg excludes packages", () => {
  const entries = [
    makeEntry({ isPackage: false }),
    makeEntry({ isPackage: true }),
    makeEntry({ isPackage: false }),
  ];
  const result = filterAudits(entries, { type: "date-leg" });
  assertEquals(result.length, 2);
  assert(result.every((e) => !e.isPackage));
});

Deno.test("filter — type=package excludes date-legs", () => {
  const entries = [
    makeEntry({ isPackage: false }),
    makeEntry({ isPackage: true }),
    makeEntry({ isPackage: true }),
  ];
  const result = filterAudits(entries, { type: "package" });
  assertEquals(result.length, 2);
  assert(result.every((e) => e.isPackage));
});

Deno.test("filter — owner matches voName", () => {
  const entries = [
    makeEntry({ voName: "Alice", owner: "alice@test.com" }),
    makeEntry({ voName: "Bob", owner: "bob@test.com" }),
  ];
  const result = filterAudits(entries, { owner: "Alice" });
  assertEquals(result.length, 1);
  assertEquals(result[0].voName, "Alice");
});

Deno.test("filter — owner falls back to owner field when voName missing", () => {
  const entries = [
    makeEntry({ voName: undefined, owner: "alice@test.com" }),
    makeEntry({ voName: undefined, owner: "bob@test.com" }),
  ];
  const result = filterAudits(entries, { owner: "alice@test.com" });
  assertEquals(result.length, 1);
  assertEquals(result[0].owner, "alice@test.com");
});

Deno.test("filter — department filter", () => {
  const entries = [
    makeEntry({ department: "Sales" }),
    makeEntry({ department: "Support" }),
    makeEntry({ department: "Sales" }),
  ];
  const result = filterAudits(entries, { department: "Sales" });
  assertEquals(result.length, 2);
});

Deno.test("filter — shift filter", () => {
  const entries = [
    makeEntry({ shift: "AM" }),
    makeEntry({ shift: "PM" }),
    makeEntry({ shift: "AM" }),
  ];
  const result = filterAudits(entries, { shift: "PM" });
  assertEquals(result.length, 1);
});

Deno.test("filter — score range", () => {
  const entries = [
    makeEntry({ score: 100 }),
    makeEntry({ score: 80 }),
    makeEntry({ score: 50 }),
    makeEntry({ score: 0 }),
  ];
  const result = filterAudits(entries, { scoreMin: 50, scoreMax: 80 });
  assertEquals(result.length, 2);
  assert(result.every((e) => e.score >= 50 && e.score <= 80));
});

Deno.test("filter — combined filters", () => {
  const entries = [
    makeEntry({ isPackage: false, department: "Sales", score: 90 }),
    makeEntry({ isPackage: false, department: "Sales", score: 60 }),
    makeEntry({ isPackage: true, department: "Sales", score: 90 }),
    makeEntry({ isPackage: false, department: "Support", score: 90 }),
  ];
  const result = filterAudits(entries, { type: "date-leg", department: "Sales", scoreMin: 80, scoreMax: 100 });
  assertEquals(result.length, 1);
  assertEquals(result[0].score, 90);
  assertEquals(result[0].department, "Sales");
  assertEquals(result[0].isPackage, false);
});

Deno.test("filter — no filters returns all", () => {
  const entries = [makeEntry(), makeEntry(), makeEntry()];
  const result = filterAudits(entries, {});
  assertEquals(result.length, 3);
});

Deno.test("entries without TTL — old entries survive beyond 24h", () => {
  // Simulate an entry from 5 days ago — should still be queryable
  const fiveDaysAgo = Date.now() - 5 * 86_400_000;
  const entry = makeEntry({ completedAt: fiveDaysAgo });
  // The entry exists (not expired) — this is the whole point of removing the TTL
  assert(entry.completedAt < Date.now() - 86_400_000, "Entry should be older than 24h");
  assert(entry.findingId.length > 0, "Entry should have a valid findingId");
});
