/** Frontend tests for the Operations Portal's department rail.
 *
 *  The rail is the whole point of this page — it's how an operations manager
 *  picks which department to work — and its numbers are derived in memory from
 *  the single queue read the page already makes. `deptStats` is that
 *  derivation, so it's the right unit to assert against (same convention as
 *  manager-audits.test.tsx testing `renderAuditHistoryTable` directly). */
import { assertEquals } from "@std/assert";
import { deptStats, shortAge } from "../../routes/operations/index.tsx";
import type { QueueItem } from "../../routes/api/manager/queue.tsx";

function item(over: Partial<QueueItem> = {}): QueueItem {
  return { findingId: crypto.randomUUID(), ...over };
}

const HOUR = 3_600_000;
const DAY = 86_400_000;

Deno.test("deptStats — counts pending and remediated per department", () => {
  const stats = deptStats([
    item({ department: "ODS WFH", status: "pending" }),
    item({ department: "ODS WFH", status: "pending" }),
    item({ department: "ODS WFH", status: "remediated" }),
    item({ department: "GS WFH", status: "pending" }),
  ], ["ODS WFH", "GS WFH"]);

  const ods = stats.find((s) => s.name === "ODS WFH")!;
  assertEquals(ods.pending, 2);
  assertEquals(ods.remediated, 1);
  assertEquals(stats.find((s) => s.name === "GS WFH")!.pending, 1);
});

Deno.test("deptStats — a department with no queue items still appears, marked clear", () => {
  // The whole reason the rail is built from the SCOPE and not from the queue:
  // "this department has nothing waiting" is information the ops manager needs
  // to see, not a row that quietly disappears.
  const stats = deptStats([item({ department: "ODS WFH", status: "pending" })], ["ODS WFH", "NIGHT"]);
  const night = stats.find((s) => s.name === "NIGHT")!;
  assertEquals(night.pending, 0);
  assertEquals(night.oldestPendingTs, 0);
});

Deno.test("deptStats — ignores items from departments outside the rail", () => {
  // Backend scoping should already have removed these; if one ever slips
  // through it must not invent a department card or inflate a count.
  const stats = deptStats([
    item({ department: "ODS WFH", status: "pending" }),
    item({ department: "SOMEONE ELSE", status: "pending" }),
    item({ status: "pending" }),
  ], ["ODS WFH"]);
  assertEquals(stats.length, 1);
  assertEquals(stats[0].pending, 1);
});

Deno.test("deptStats — oldest pending uses audit time and ignores remediated items", () => {
  const now = Date.now();
  const stats = deptStats([
    item({ department: "ODS WFH", status: "pending", completedAt: now - 3 * DAY }),
    item({ department: "ODS WFH", status: "pending", completedAt: now - 9 * DAY }),
    // Already handled — must not drag the "oldest waiting" figure backwards.
    item({ department: "ODS WFH", status: "remediated", completedAt: now - 60 * DAY }),
  ], ["ODS WFH"]);
  assertEquals(stats[0].oldestPendingTs, now - 9 * DAY);
});

Deno.test("deptStats — falls back to addedAt when an item has no completedAt", () => {
  const now = Date.now();
  const stats = deptStats(
    [item({ department: "ODS WFH", status: "pending", addedAt: now - 2 * DAY })],
    ["ODS WFH"],
  );
  assertEquals(stats[0].oldestPendingTs, now - 2 * DAY);
});

Deno.test("deptStats — busiest department sorts first, ties go alphabetical", () => {
  const stats = deptStats([
    item({ department: "GS WFH", status: "pending" }),
    item({ department: "GS WFH", status: "pending" }),
    item({ department: "ZULU", status: "pending" }),
    item({ department: "ALPHA", status: "pending" }),
  ], ["ZULU", "ALPHA", "GS WFH", "EMPTY"]);
  assertEquals(stats.map((s) => s.name), ["GS WFH", "ALPHA", "ZULU", "EMPTY"]);
});

Deno.test("shortAge — minutes, hours, then days", () => {
  const now = Date.now();
  assertEquals(shortAge(now - 45 * 60_000), "45m");
  assertEquals(shortAge(now - 6 * HOUR), "6h");
  assertEquals(shortAge(now - 9 * DAY), "9d");
});

Deno.test("shortAge — a future or unusable timestamp renders a dash, never a negative age", () => {
  assertEquals(shortAge(Date.now() + 10 * DAY), "—");
  assertEquals(shortAge(Number.NaN), "—");
});
