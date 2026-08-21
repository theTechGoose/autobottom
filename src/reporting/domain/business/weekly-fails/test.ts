/** Tests for the prior-week fails report — criteria + the two window traps. */

import { assertEquals, assert } from "#assert";
import { classifyWeeklyFail, queryWeeklyFails, settledAt } from "./mod.ts";
import { prevWeekWindow } from "@cron/domain/business/weekly-sheets/mod.ts";
import { resetFirestoreCredentials } from "@core/data/firestore/mod.ts";
import { writeAuditDoneIndex, _resetHiddenCacheForTesting } from "@audit/domain/data/stats-repository/mod.ts";
import type { AuditDoneIndexEntry } from "@core/dto/types.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

const DAY = 86_400_000;

function row(over: Partial<AuditDoneIndexEntry> & { findingId: string }): AuditDoneIndexEntry {
  return {
    completedAt: 0, completed: true, score: 100, ...over,
  } as AuditDoneIndexEntry;
}

// ── Criteria ────────────────────────────────────────────────────────────────

Deno.test("classify — invalid genie counts", () => {
  assertEquals(classifyWeeklyFail(row({ findingId: "a", reason: "invalid_genie", score: 0 })), "invalid_genie");
});

Deno.test("classify — reviewed and still under 100 counts as failed post review", () => {
  assertEquals(classifyWeeklyFail(row({ findingId: "b", reason: "reviewed", score: 96 })), "failed_post_review");
});

Deno.test("classify — reviewed back up to 100 does NOT count", () => {
  // The reviewer-flip case: bot failed it, a human cleared every question.
  assertEquals(classifyWeeklyFail(row({ findingId: "c", reason: "reviewed", score: 100 })), null);
});

Deno.test("classify — a failing audit NOT yet reviewed does NOT count", () => {
  // ~1,190 flagged audits sit unreviewed at any time. They are not "post
  // review" and a reviewer may still clear them, so they stay out.
  assertEquals(classifyWeeklyFail(row({ findingId: "d", completed: false, score: 88 })), null);
  assertEquals(classifyWeeklyFail(row({ findingId: "e", reason: undefined, score: 88 })), null);
});

Deno.test("classify — a bot-perfect audit does NOT count", () => {
  assertEquals(classifyWeeklyFail(row({ findingId: "f", reason: "perfect_score", score: 100 })), null);
});

Deno.test("settledAt — falls back to completedAt when doneAt is missing", () => {
  assertEquals(settledAt(row({ findingId: "g", completedAt: 500 })), 500);
  assertEquals(settledAt(row({ findingId: "h", completedAt: 500, doneAt: 900 })), 900);
});

// ── Window behaviour ────────────────────────────────────────────────────────

Deno.test("prevWeekWindow — is a full Mon→Sun week", () => {
  // Friday 2026-08-21 → prior week is Mon 08-10 through Sun 08-16.
  const { since, until } = prevWeekWindow(new Date("2026-08-21T15:00:00Z"));
  const span = until - since;
  assert(span > 6.9 * DAY && span < 7.01 * DAY, `expected ~7 days, got ${span / DAY}`);
  assertEquals(new Date(since).toISOString().slice(0, 10), "2026-08-10");
  assertEquals(new Date(until).toISOString().slice(0, 10), "2026-08-17"); // 23:59:59.999 ET = next day UTC
});

Deno.test("queryWeeklyFails — an audit graded BEFORE the week but reviewed INSIDE it is included", async () => {
  // The trap this module exists for: audit-done-idx range-scans completedAt,
  // but the report filters doneAt. A narrow scan would miss this row entirely.
  resetFirestoreCredentials(); _resetHiddenCacheForTesting();
  const orgId = ("wf-lag-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
  const since = 100 * DAY, until = since + 7 * DAY - 1;

  await writeAuditDoneIndex(orgId, row({
    findingId: "lagged", completedAt: since - 30 * DAY, doneAt: since + 2 * DAY,
    completed: true, reason: "reviewed", score: 92, recordId: "r-lagged",
  }));

  const res = await queryWeeklyFails(orgId, since, until, { lookbackDays: 120 });
  assertEquals(res.counts.total, 1, "the lagged review must be found");
  assertEquals(res.items[0].findingId, "lagged");
  assertEquals(res.items[0].doneAt, since + 2 * DAY);
});

Deno.test("queryWeeklyFails — an audit graded INSIDE the week but reviewed AFTER it is excluded", async () => {
  resetFirestoreCredentials(); _resetHiddenCacheForTesting();
  const orgId = ("wf-after-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
  const since = 100 * DAY, until = since + 7 * DAY - 1;

  await writeAuditDoneIndex(orgId, row({
    findingId: "reviewed-later", completedAt: since + DAY, doneAt: until + 2 * DAY,
    completed: true, reason: "reviewed", score: 80, recordId: "r-later",
  }));

  const res = await queryWeeklyFails(orgId, since, until, { lookbackDays: 120 });
  assertEquals(res.counts.total, 0, "settled after the window → next week's report, not this one");
});

Deno.test("queryWeeklyFails — mixes both categories and counts them separately", async () => {
  resetFirestoreCredentials(); _resetHiddenCacheForTesting();
  const orgId = ("wf-mix-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
  const since = 100 * DAY, until = since + 7 * DAY - 1;
  const inside = since + 3 * DAY;

  await writeAuditDoneIndex(orgId, row({
    findingId: "ig", completedAt: inside, doneAt: inside, completed: true,
    reason: "invalid_genie", score: 0, recordId: "r-ig", voName: "A Person",
  }));
  await writeAuditDoneIndex(orgId, row({
    findingId: "fpr", completedAt: inside, doneAt: inside, completed: true,
    reason: "reviewed", score: 96, recordId: "r-fpr", voName: "B Person",
  }));
  await writeAuditDoneIndex(orgId, row({
    findingId: "cleared", completedAt: inside, doneAt: inside, completed: true,
    reason: "reviewed", score: 100, recordId: "r-cleared",
  }));
  await writeAuditDoneIndex(orgId, row({
    findingId: "unreviewed", completedAt: inside, doneAt: inside, completed: false,
    score: 88, recordId: "r-unreviewed",
  }));

  const res = await queryWeeklyFails(orgId, since, until, { lookbackDays: 120 });
  assertEquals(res.counts.invalidGenie, 1);
  assertEquals(res.counts.failedPostReview, 1);
  assertEquals(res.counts.total, 2, "cleared + unreviewed must not appear");
  assertEquals(res.items.map((i) => i.findingId).sort(), ["fpr", "ig"]);
});

Deno.test("queryWeeklyFails — a re-audited row is FLAGGED, not dropped", async () => {
  // Victoria's case: an invalid genie re-submitted and still invalid. Both
  // findings are real events; the older one carries a pointer to the newer.
  resetFirestoreCredentials(); _resetHiddenCacheForTesting();
  const orgId = ("wf-super-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
  const since = 100 * DAY, until = since + 7 * DAY - 1;
  const t = since + 2 * DAY;

  await writeAuditDoneIndex(orgId, row({
    findingId: "first", completedAt: t, doneAt: t, completed: true,
    reason: "invalid_genie", score: 0, recordId: "500954",
  }));
  await writeAuditDoneIndex(orgId, row({
    findingId: "second", completedAt: t + 600_000, doneAt: t + 600_000, completed: true,
    reason: "invalid_genie", score: 0, recordId: "500954",
  }));

  const res = await queryWeeklyFails(orgId, since, until, { lookbackDays: 120 });
  assertEquals(res.counts.total, 2, "both submissions are listed");
  assertEquals(res.counts.superseded, 1);
  const first = res.items.find((i) => i.findingId === "first");
  assertEquals(first?.supersededByFindingId, "second");
  const second = res.items.find((i) => i.findingId === "second");
  assertEquals(second?.supersededByFindingId, undefined, "the newest row carries no pointer");
});

Deno.test("queryWeeklyFails — rows come back oldest-settled first with a report link", async () => {
  resetFirestoreCredentials(); _resetHiddenCacheForTesting();
  const orgId = ("wf-sort-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
  const since = 100 * DAY, until = since + 7 * DAY - 1;

  await writeAuditDoneIndex(orgId, row({
    findingId: "late", completedAt: since + 5 * DAY, doneAt: since + 5 * DAY,
    completed: true, reason: "invalid_genie", score: 0, recordId: "r1",
  }));
  await writeAuditDoneIndex(orgId, row({
    findingId: "early", completedAt: since + DAY, doneAt: since + DAY,
    completed: true, reason: "invalid_genie", score: 0, recordId: "r2",
  }));

  const res = await queryWeeklyFails(orgId, since, until, { lookbackDays: 120, selfUrl: "https://x.test" });
  assertEquals(res.items.map((i) => i.findingId), ["early", "late"]);
  assertEquals(res.items[0].reportUrl, "https://x.test/audit/report?id=early");
  assertEquals(res.window.filteredOn, "doneAt");
});
