/** Streak math is the only piece worth pinning — it's the one bit of
 *  derivation that has off-by-one risk (consecutive days vs. gaps, walking
 *  from today vs. yesterday). The dashboard read path itself is exercised
 *  by integration tests; what we need to lock here is "given a known set
 *  of audit-done dates, do we count the streak right". */
import { assert, assertEquals } from "#assert";
import { computeReviewRate, getMyReviewerStats, getQuestionTiming, getReviewerLeaderboard } from "./mod.ts";
import { _resetQueryAuditDoneIndexCacheForTests, writeAuditDoneIndex } from "@audit/domain/data/stats-repository/mod.ts";
import { saveFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { resetFirestoreCredentials } from "@core/data/firestore/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

Deno.test("review rate — decisions per hour", () => { assertEquals(computeReviewRate(60, 2), 30); });
Deno.test("review rate — zero hours returns 0", () => { assertEquals(computeReviewRate(10, 0), 0); });

const MS_DAY = 86_400_000;

function uniqueOrg(tag: string): OrgId {
  return (`test-rs-${tag}-${crypto.randomUUID().slice(0, 8)}`) as unknown as OrgId;
}

async function seedReviewed(orgId: OrgId, email: string, offsetsDays: number[]): Promise<void> {
  const todayStart = Math.floor(Date.now() / MS_DAY) * MS_DAY;
  for (let i = 0; i < offsetsDays.length; i++) {
    const fid = `fid-${i}-${crypto.randomUUID().slice(0, 6)}`;
    const completedAt = todayStart - offsetsDays[i] * MS_DAY + 60_000;
    await saveFinding(orgId, { id: fid, findingStatus: "finished", record: {} });
    await writeAuditDoneIndex(orgId, {
      findingId: fid, completedAt, completed: true, score: 100, reviewedBy: email,
    });
  }
}

Deno.test("getMyReviewerStats — 3-day current streak ending today (default range)", async () => {
  resetFirestoreCredentials();
  _resetQueryAuditDoneIndexCacheForTests();
  const orgId = uniqueOrg("streak3");
  const email = "alice@example.com";
  await seedReviewed(orgId, email, [0, 1, 2]); // today, yesterday, day-before
  const s = await getMyReviewerStats(orgId, email);
  assertEquals(s.currentStreak, 3);
  assertEquals(s.longestStreak, 3);
  assertEquals(s.daysActive, 3);
  assertEquals(s.reviewed, 3);
});

Deno.test("getMyReviewerStats — broken streak (gap kills current, longest survives)", async () => {
  resetFirestoreCredentials();
  _resetQueryAuditDoneIndexCacheForTests();
  const orgId = uniqueOrg("broken");
  const email = "bob@example.com";
  // 4-day run ending 5 days ago, then nothing — current is 0.
  await seedReviewed(orgId, email, [5, 6, 7, 8]);
  const s = await getMyReviewerStats(orgId, email);
  assertEquals(s.currentStreak, 0);
  assertEquals(s.longestStreak, 4);
});

Deno.test("getMyReviewerStats — custom range narrows the bucket; streaks stay today-relative", async () => {
  resetFirestoreCredentials();
  _resetQueryAuditDoneIndexCacheForTests();
  const orgId = uniqueOrg("range");
  const email = "carol@example.com";
  // Seed across today + last 14 days. Streak = today only (since gaps).
  await seedReviewed(orgId, email, [0, 5, 10]);
  // Custom range covering only 7-12 days ago should bucket just one row.
  const now = Date.now();
  const s = await getMyReviewerStats(orgId, email, {
    from: now - 12 * MS_DAY,
    to: now - 7 * MS_DAY,
  });
  assertEquals(s.reviewed, 1); // only the day-10 row falls inside
  // Streak is today-relative — today is seeded so currentStreak ≥ 1
  assert(s.currentStreak >= 1, "current streak counts today regardless of range");
});

Deno.test("getReviewerLeaderboard — groups by reviewedBy, sorts by volume", async () => {
  resetFirestoreCredentials();
  _resetQueryAuditDoneIndexCacheForTests();
  const orgId = uniqueOrg("ldb");
  await seedReviewed(orgId, "alice@example.com", [0, 1, 2, 3]);
  await seedReviewed(orgId, "bob@example.com", [0, 1]);
  const rows = await getReviewerLeaderboard(orgId);
  assertEquals(rows.length, 2);
  assertEquals(rows[0].email, "alice@example.com");
  assertEquals(rows[0].reviewed, 4);
  assertEquals(rows[1].email, "bob@example.com");
  assert(rows[0].reviewed > rows[1].reviewed, "sorted descending by volume");
});

Deno.test("getReviewerLeaderboard — respects custom range", async () => {
  resetFirestoreCredentials();
  _resetQueryAuditDoneIndexCacheForTests();
  const orgId = uniqueOrg("ldb-range");
  await seedReviewed(orgId, "alice@example.com", [0, 1, 10, 11]);
  // Window: only the recent two days.
  const now = Date.now();
  const rows = await getReviewerLeaderboard(orgId, {
    from: now - 3 * MS_DAY,
    to: now,
  });
  assertEquals(rows.length, 1);
  assertEquals(rows[0].reviewed, 2);
});

// ── Handle-time aggregation + idle discard ──────────────────────────────────

interface TimedAudit {
  handleMs?: number; validCount?: number; questionCount?: number;
  questions?: Array<{ header: string; handleMs?: number; discarded?: boolean }>;
}
async function seedTimed(orgId: OrgId, email: string, audits: TimedAudit[]): Promise<void> {
  const now = Date.now();
  for (let i = 0; i < audits.length; i++) {
    const a = audits[i];
    const fid = `tfid-${i}-${crypto.randomUUID().slice(0, 6)}`;
    const answeredQuestions = (a.questions ?? []).map((q) => ({
      header: q.header, answer: "No", reviewedAt: now,
      reviewHandleMs: q.handleMs, reviewDiscarded: q.discarded,
    }));
    await saveFinding(orgId, { id: fid, findingStatus: "finished", record: {}, answeredQuestions });
    await writeAuditDoneIndex(orgId, {
      findingId: fid, completedAt: now - i * 1000, completed: true, score: 100,
      reason: "reviewed", reviewedBy: email,
      reviewHandleMs: a.handleMs, reviewedValidCount: a.validCount, reviewedQuestionCount: a.questionCount,
    });
  }
}

Deno.test("getReviewerLeaderboard — handle-time stats (avg/median/per-question/throughput)", async () => {
  resetFirestoreCredentials();
  _resetQueryAuditDoneIndexCacheForTests();
  const orgId = uniqueOrg("ldb-handle");
  await seedTimed(orgId, "alice@example.com", [
    { handleMs: 120_000, validCount: 4, questionCount: 4 }, // 2 min
    { handleMs: 60_000, validCount: 2, questionCount: 2 },  // 1 min
    {}, // untimed audit — must not count toward timedAudits / handle stats
  ]);
  const rows = await getReviewerLeaderboard(orgId);
  const r = rows.find((x) => x.email === "alice@example.com")!;
  assertEquals(r.reviewed, 3);
  assertEquals(r.timedAudits, 2);
  assertEquals(r.totalHandleMs, 180_000);
  assertEquals(r.avgHandleMs, 90_000);
  assertEquals(r.medianHandleMs, 90_000);
  assertEquals(r.validQuestions, 6);
  assertEquals(r.avgPerQuestionMs, 30_000);   // 180000 / 6
  assertEquals(r.auditsPerActiveHour, 40);    // 2 / (180000/3.6e6) = 2 / 0.05
});

Deno.test("getQuestionTiming — groups by header, excludes idle-discarded from avg", async () => {
  resetFirestoreCredentials();
  _resetQueryAuditDoneIndexCacheForTests();
  const orgId = uniqueOrg("qtiming");
  await seedTimed(orgId, "alice@example.com", [
    { questions: [
      { header: "Taxes Due", handleMs: 30_000 },
      { header: "Income", handleMs: 90_000, discarded: true }, // idle → excluded from avg
    ] },
    { questions: [
      { header: "Taxes Due", handleMs: 50_000 },
      { header: "Income", handleMs: 40_000 },
    ] },
  ]);
  const { rows } = await getQuestionTiming(orgId);
  const taxes = rows.find((x) => x.header === "Taxes Due")!;
  const income = rows.find((x) => x.header === "Income")!;
  assertEquals(taxes.samples, 2);
  assertEquals(taxes.avgMs, 40_000);          // (30k + 50k) / 2
  assertEquals(income.samples, 1);            // discarded one excluded
  assertEquals(income.avgMs, 40_000);         // only the valid sample
  assertEquals(income.discardedCount, 1);
});

Deno.test("getQuestionTiming — questionFilter narrows by header substring", async () => {
  resetFirestoreCredentials();
  _resetQueryAuditDoneIndexCacheForTests();
  const orgId = uniqueOrg("qfilter");
  await seedTimed(orgId, "alice@example.com", [
    { questions: [{ header: "Taxes Due", handleMs: 30_000 }, { header: "Income", handleMs: 40_000 }] },
  ]);
  const { rows } = await getQuestionTiming(orgId, undefined, "income");
  assertEquals(rows.length, 1);
  assertEquals(rows[0].header, "Income");
});
