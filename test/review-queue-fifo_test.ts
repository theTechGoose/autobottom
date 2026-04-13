/** Tests for review queue FIFO ordering (oldest audit first).
 *  Validates the selection logic in claimNextItem that picks the
 *  finding with the oldest completedAt timestamp. */

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

// -- Interfaces mirroring production --

interface ReviewItem {
  findingId: string;
  questionIndex: number;
  reviewIndex: number;
  totalForFinding: number;
  header: string;
  populated: string;
  thinking: string;
  defense: string;
  answer: string;
  completedAt?: number;
  recordingIdField?: string;
}

// -- Pure selection logic extracted from claimNextItem --

function selectOldestFinding(
  items: ReviewItem[],
  allowedTypes?: string[],
): { targetFindingId: string | null; entries: ReviewItem[] } {
  const findingTimestamps = new Map<string, number>();
  const pendingByFinding = new Map<string, ReviewItem[]>();

  for (const item of items) {
    if (allowedTypes) {
      const isPackage = item.recordingIdField === "GenieNumber";
      const itemType = isPackage ? "package" : "date-leg";
      if (!allowedTypes.includes(itemType)) continue;
    }
    const fid = item.findingId;
    if (!pendingByFinding.has(fid)) pendingByFinding.set(fid, []);
    pendingByFinding.get(fid)!.push(item);
    const ts = item.completedAt ?? 0;
    if (!findingTimestamps.has(fid) || ts < findingTimestamps.get(fid)!) {
      findingTimestamps.set(fid, ts);
    }
  }

  let targetFindingId: string | null = null;
  let oldestTs = Infinity;
  for (const [fid, ts] of findingTimestamps) {
    if (ts < oldestTs) { oldestTs = ts; targetFindingId = fid; }
  }

  const entries = targetFindingId ? (pendingByFinding.get(targetFindingId) ?? []) : [];
  return { targetFindingId, entries };
}

// -- Test data factory --

function makeItem(findingId: string, questionIndex: number, completedAt?: number, recordingIdField?: string): ReviewItem {
  return {
    findingId,
    questionIndex,
    reviewIndex: questionIndex + 1,
    totalForFinding: 1,
    header: `Q${questionIndex}`,
    populated: `Question ${questionIndex}`,
    thinking: "thinking",
    defense: "defense",
    answer: "No",
    ...(completedAt != null ? { completedAt } : {}),
    ...(recordingIdField ? { recordingIdField } : {}),
  };
}

// -- Tests --

Deno.test("FIFO — oldest finding picked first (Friday before Saturday before Sunday)", () => {
  const friday = new Date("2026-04-10T12:00:00Z").getTime();
  const saturday = new Date("2026-04-11T12:00:00Z").getTime();
  const sunday = new Date("2026-04-12T12:00:00Z").getTime();
  const items = [
    makeItem("sat-audit", 0, saturday),
    makeItem("sun-audit", 0, sunday),
    makeItem("fri-audit", 0, friday),
  ];
  const { targetFindingId } = selectOldestFinding(items);
  assertEquals(targetFindingId, "fri-audit");
});

Deno.test("FIFO — items without completedAt treated as oldest (ts=0)", () => {
  const recent = Date.now();
  const items = [
    makeItem("new-audit", 0, recent),
    makeItem("old-no-ts", 0),           // no completedAt → ts=0
    makeItem("another-new", 0, recent - 1000),
  ];
  const { targetFindingId } = selectOldestFinding(items);
  assertEquals(targetFindingId, "old-no-ts");
});

Deno.test("FIFO — type filtering applied before FIFO selection", () => {
  const older = 1000;
  const newer = 2000;
  const items = [
    makeItem("old-package", 0, older, "GenieNumber"),   // package — oldest but wrong type
    makeItem("new-dateLeg", 0, newer),                    // date-leg — newer but right type
  ];
  const { targetFindingId } = selectOldestFinding(items, ["date-leg"]);
  assertEquals(targetFindingId, "new-dateLeg");
});

Deno.test("FIFO — package-only reviewer gets oldest package", () => {
  const older = 1000;
  const newer = 2000;
  const items = [
    makeItem("old-dateLeg", 0, older),                    // date-leg — skipped
    makeItem("old-package", 0, older + 500, "GenieNumber"),
    makeItem("new-package", 0, newer, "GenieNumber"),
  ];
  const { targetFindingId } = selectOldestFinding(items, ["package"]);
  assertEquals(targetFindingId, "old-package");
});

Deno.test("FIFO — all items for selected finding returned", () => {
  const older = 1000;
  const newer = 2000;
  const items = [
    makeItem("audit-A", 0, older),
    makeItem("audit-A", 1, older),
    makeItem("audit-A", 2, older),
    makeItem("audit-B", 0, newer),
    makeItem("audit-B", 1, newer),
  ];
  const { targetFindingId, entries } = selectOldestFinding(items);
  assertEquals(targetFindingId, "audit-A");
  assertEquals(entries.length, 3);
  assert(entries.every((e) => e.findingId === "audit-A"));
});

Deno.test("FIFO — single finding always selected", () => {
  const items = [
    makeItem("only-one", 0, 5000),
    makeItem("only-one", 1, 5000),
  ];
  const { targetFindingId, entries } = selectOldestFinding(items);
  assertEquals(targetFindingId, "only-one");
  assertEquals(entries.length, 2);
});

Deno.test("FIFO — empty queue returns null", () => {
  const { targetFindingId, entries } = selectOldestFinding([]);
  assertEquals(targetFindingId, null);
  assertEquals(entries.length, 0);
});

Deno.test("FIFO — same completedAt picks one deterministically", () => {
  const ts = 5000;
  const items = [
    makeItem("audit-Z", 0, ts),
    makeItem("audit-A", 0, ts),
    makeItem("audit-M", 0, ts),
  ];
  const { targetFindingId } = selectOldestFinding(items);
  // When timestamps are equal, the first one encountered in iteration wins
  assertEquals(targetFindingId, "audit-Z");
});

Deno.test("FIFO — mixed: some with completedAt, some without — no-timestamp items prioritized", () => {
  const items = [
    makeItem("has-ts-1", 0, 10000),
    makeItem("no-ts-1", 0),              // completedAt=undefined → ts=0
    makeItem("has-ts-2", 0, 5000),
    makeItem("no-ts-2", 0),              // completedAt=undefined → ts=0
  ];
  const { targetFindingId } = selectOldestFinding(items);
  // Both no-ts items have ts=0; first encountered ("no-ts-1") wins
  assertEquals(targetFindingId, "no-ts-1");
});

Deno.test("FIFO — type filtering removes all items returns null", () => {
  const items = [
    makeItem("pkg-1", 0, 1000, "GenieNumber"),
    makeItem("pkg-2", 0, 2000, "GenieNumber"),
  ];
  // Only allow date-leg, but all items are packages
  const { targetFindingId, entries } = selectOldestFinding(items, ["date-leg"]);
  assertEquals(targetFindingId, null);
  assertEquals(entries.length, 0);
});
