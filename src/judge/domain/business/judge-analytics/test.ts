/** Judge analytics — overturn-rate math + Phase 2 range semantics.
 *
 *  The indexed-range query and lookback split (mod.ts) introduce two
 *  behaviors worth pinning:
 *    1. Range stats only include decisions whose decidedAt falls in [from, to]
 *    2. lastDecidedAt is absolute — even when the range excludes the most
 *       recent decision, the dashboard's "last decided" card still surfaces
 *       it. */

import { assert, assertEquals } from "#assert";
import {
  computeOverturnRate, getMyJudgeStats, _resetJudgeAnalyticsCacheForTests,
} from "./mod.ts";
import { setStored, resetFirestoreCredentials } from "@core/data/firestore/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

Deno.test("overturn rate — 50%", () => { assertEquals(computeOverturnRate(5, 10), 50); });
Deno.test("overturn rate — zero total", () => { assertEquals(computeOverturnRate(0, 0), 0); });

const MS_DAY = 86_400_000;
function uniqueOrg(tag: string): OrgId {
  return (`test-ja-${tag}-${crypto.randomUUID().slice(0, 8)}`) as unknown as OrgId;
}

async function seedDecision(
  orgId: OrgId, findingId: string, qIndex: number,
  judge: string, decision: "uphold" | "overturn", decidedAt: number,
): Promise<void> {
  await setStored("judge-decided", orgId, [findingId, qIndex], {
    findingId, questionIndex: qIndex, judge, decision, decidedAt,
  });
}

Deno.test("getMyJudgeStats — range query scopes the bucket to from..to", async () => {
  resetFirestoreCredentials();
  _resetJudgeAnalyticsCacheForTests();
  const orgId = uniqueOrg("range");
  const judge = "alice@example.com";
  const now = Date.now();

  // 3 decisions inside the last 7 days, 2 decisions 60 days ago
  await seedDecision(orgId, "f1", 0, judge, "uphold",   now - 1 * MS_DAY);
  await seedDecision(orgId, "f2", 0, judge, "overturn", now - 3 * MS_DAY);
  await seedDecision(orgId, "f3", 0, judge, "uphold",   now - 5 * MS_DAY);
  await seedDecision(orgId, "f4", 0, judge, "uphold",   now - 60 * MS_DAY);
  await seedDecision(orgId, "f5", 0, judge, "overturn", now - 65 * MS_DAY);

  // Range = last 7 days
  const stats = await getMyJudgeStats(orgId, judge, { from: now - 7 * MS_DAY, to: now });
  assertEquals(stats.decided, 3);
  assertEquals(stats.overturned, 1);
  assertEquals(stats.upheld, 2);
});

Deno.test("getMyJudgeStats — other judges' decisions excluded from this judge's bucket", async () => {
  resetFirestoreCredentials();
  _resetJudgeAnalyticsCacheForTests();
  const orgId = uniqueOrg("isolation");
  const me = "me@example.com";
  const other = "other@example.com";
  const now = Date.now();

  await seedDecision(orgId, "f1", 0, me, "uphold", now - MS_DAY);
  await seedDecision(orgId, "f2", 0, other, "uphold", now - MS_DAY);
  await seedDecision(orgId, "f3", 0, other, "overturn", now - MS_DAY);

  const mine = await getMyJudgeStats(orgId, me, { from: now - 7 * MS_DAY, to: now });
  assertEquals(mine.decided, 1);
  assertEquals(mine.upheld, 1);
  assertEquals(mine.overturned, 0);
});

Deno.test("getMyJudgeStats — lastDecidedAt is absolute (survives a narrow range)", async () => {
  resetFirestoreCredentials();
  _resetJudgeAnalyticsCacheForTests();
  const orgId = uniqueOrg("abs");
  const judge = "alice@example.com";
  const now = Date.now();
  const tsInRange = now - 1 * MS_DAY;
  const tsLatest = now - 30 * 60_000;  // 30 minutes ago — outside the 24h-12h slice below

  await seedDecision(orgId, "old", 0, judge, "uphold", tsInRange);
  await seedDecision(orgId, "new", 0, judge, "overturn", tsLatest);

  // Pick a range that excludes the latest decision
  const stats = await getMyJudgeStats(orgId, judge, {
    from: now - 24 * 60 * 60_000,
    to: now - 60 * 60_000,  // window ends 60 min ago — tsLatest (30min ago) is outside
  });
  assertEquals(stats.decided, 1);
  assertEquals(stats.lastInRangeAt, tsInRange);
  // lastDecidedAt is the absolute most-recent — even though it's outside the range
  assertEquals(stats.lastDecidedAt, tsLatest);
});

Deno.test("getMyJudgeStats — overturnRate computed from the bucket", async () => {
  resetFirestoreCredentials();
  _resetJudgeAnalyticsCacheForTests();
  const orgId = uniqueOrg("rate");
  const judge = "alice@example.com";
  const now = Date.now();

  // 2 overturned, 8 upheld → 20%
  for (let i = 0; i < 8; i++) {
    await seedDecision(orgId, `up-${i}`, 0, judge, "uphold", now - i * 60_000);
  }
  for (let i = 0; i < 2; i++) {
    await seedDecision(orgId, `ov-${i}`, 0, judge, "overturn", now - (i + 8) * 60_000);
  }

  const stats = await getMyJudgeStats(orgId, judge, { from: now - MS_DAY, to: now });
  assertEquals(stats.decided, 10);
  assertEquals(stats.overturnRate, 20);
});

Deno.test("getMyJudgeStats — no decisions returns zero bucket + null lastDecidedAt", async () => {
  resetFirestoreCredentials();
  _resetJudgeAnalyticsCacheForTests();
  const orgId = uniqueOrg("empty");
  const stats = await getMyJudgeStats(orgId, "ghost@example.com");
  assertEquals(stats.decided, 0);
  assertEquals(stats.overturned, 0);
  assertEquals(stats.upheld, 0);
  assertEquals(stats.overturnRate, 0);
  assertEquals(stats.lastInRangeAt, null);
  assertEquals(stats.lastDecidedAt, null);
});

Deno.test("getMyJudgeStats — invalid/malformed rows are filtered out", async () => {
  resetFirestoreCredentials();
  _resetJudgeAnalyticsCacheForTests();
  const orgId = uniqueOrg("malformed");
  const judge = "alice@example.com";
  const now = Date.now();

  await seedDecision(orgId, "good", 0, judge, "uphold", now - MS_DAY);
  // Decision string is neither "uphold" nor "overturn" — must be ignored
  await setStored("judge-decided", orgId, ["bogus", 0], {
    findingId: "bogus", questionIndex: 0, judge, decision: "maybe", decidedAt: now - MS_DAY,
  });
  // Missing decidedAt — must be ignored
  await setStored("judge-decided", orgId, ["nots", 0], {
    findingId: "nots", questionIndex: 0, judge, decision: "uphold",
  });

  const stats = await getMyJudgeStats(orgId, judge, { from: now - 7 * MS_DAY, to: now });
  assertEquals(stats.decided, 1);
  assert(stats.lastDecidedAt != null);
});
