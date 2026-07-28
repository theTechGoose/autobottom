/** Frontend tests for the Operations Portal's department rail.
 *
 *  The rail is the whole point of this page — it's how an operations manager
 *  picks which department to work — and its numbers are derived in memory from
 *  the single queue read the page already makes. `deptStats` is that
 *  derivation, so it's the right unit to assert against (same convention as
 *  manager-audits.test.tsx testing `renderAuditHistoryTable` directly). */
import { assertEquals } from "@std/assert";
import { renderHTML, assertContains, assertNotContains } from "../helpers/render.ts";
import { deptStats, shortAge, OverviewCard, type DeptStat } from "../../routes/operations/index.tsx";
import type { QueueItem } from "../../routes/api/manager/queue.tsx";
import type { DeptRollup } from "../../routes/api/manager/audit-history.tsx";

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

// ── Overview card ────────────────────────────────────────────────────────────
// Locally the queue and audit index are always empty, so the populated card
// never renders in dev. These pin the states a real department produces.

function stat(over: Partial<DeptStat> = {}): DeptStat {
  return { name: "ODS WFH", pending: 0, remediated: 0, oldestPendingTs: 0, ...over };
}

function rollup(over: Partial<DeptRollup> = {}): DeptRollup {
  return {
    department: "ODS WFH",
    count: 48, passed: 34, failed: 14, failPct: 29.2, avgScore: 94,
    worstMember: { name: "J. Ruiz", avgScore: 71, audits: 6 },
    topMissed: [
      { header: "Verified the account", count: 9 },
      { header: "Offered a rebuttal", count: 6 },
      { header: "Used the closing script", count: 4 },
    ],
    ...over,
  };
}

Deno.test("OverviewCard — shows raw pass/fail, fail percentage and average", () => {
  const html = renderHTML(
    <OverviewCard stat={stat({ pending: 12 })} audit={rollup()} href="/operations?dept=ODS%20WFH" />,
  );
  assertContains(html, "48</strong> audits");
  assertContains(html, "34</strong> pass");
  assertContains(html, "14</strong> fail");
  assertContains(html, "29.2% fail");
  assertContains(html, "94%");
});

Deno.test("OverviewCard — names the weakest member with their score and audit count", () => {
  const html = renderHTML(<OverviewCard stat={stat()} audit={rollup()} href="/x" />);
  assertContains(html, "J. Ruiz");
  assertContains(html, "71%");
  // The count is what stops a single bad call reading as a persistent problem.
  assertContains(html, "(6 audits)");
});

Deno.test("OverviewCard — a one-audit weakest member is labelled in the singular", () => {
  const html = renderHTML(
    <OverviewCard
      stat={stat()}
      audit={rollup({ worstMember: { name: "Sam", avgScore: 40, audits: 1 } })}
      href="/x"
    />,
  );
  assertContains(html, "(1 audit)");
  assertNotContains(html, "(1 audits)");
});

Deno.test("OverviewCard — lists the department's three top misses, ranked with counts", () => {
  const html = renderHTML(<OverviewCard stat={stat()} audit={rollup()} href="/x" />);
  for (const q of ["Verified the account", "Offered a rebuttal", "Used the closing script"]) {
    assertContains(html, q);
  }
  assertContains(html, "1.");
  assertContains(html, "3.");
});

Deno.test("OverviewCard — an unscored window says so instead of showing 0% fail", () => {
  // The trap this guards: a department with no audits rendering a reassuring
  // "0% fail" that looks like a perfect record.
  const html = renderHTML(
    <OverviewCard
      stat={stat()}
      audit={rollup({ count: 0, passed: 0, failed: 0, failPct: null, avgScore: null, worstMember: null, topMissed: [] })}
      href="/x"
    />,
  );
  assertContains(html, "no scored audits in this window");
  assertNotContains(html, "% fail");
  assertContains(html, "No failed questions in this window");
});

Deno.test("OverviewCard — a department with no audit data at all still renders", () => {
  // Every department in scope gets a card, even one the audit window missed.
  const html = renderHTML(<OverviewCard stat={stat({ name: "NIGHT SHIFT" })} audit={null} href="/x" />);
  assertContains(html, "NIGHT SHIFT");
  assertContains(html, "no scored audits in this window");
});

Deno.test("OverviewCard — live queue state sits in the header, separate from the window stats", () => {
  const now = Date.now();
  const html = renderHTML(
    <OverviewCard stat={stat({ pending: 12, oldestPendingTs: now - 9 * 86_400_000 })} audit={rollup()} href="/x" />,
  );
  assertContains(html, "12 pending");
  assertContains(html, "9d");
});

Deno.test("OverviewCard — a clear queue reads 'clear', not an age", () => {
  const html = renderHTML(<OverviewCard stat={stat()} audit={rollup()} href="/x" />);
  assertContains(html, "clear");
});

Deno.test("OverviewCard — the whole card links to that department", () => {
  const html = renderHTML(<OverviewCard stat={stat()} audit={rollup()} href="/operations?dept=ODS+WFH" />);
  assertContains(html, 'href="/operations?dept=ODS+WFH"');
});
