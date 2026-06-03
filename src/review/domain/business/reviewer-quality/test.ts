/** Reviewer quality — overturn attribution + denominator semantics.
 *
 *  Pins the load-bearing behaviors:
 *    1. A judge-decided row is attributed to the reviewer of THAT question
 *       (answeredQuestions[questionIndex].reviewedBy), with a finding-level
 *       fallback when the indexed question has no reviewer.
 *    2. The denominator is appealed-AND-judged questions only — a reviewer's
 *       audits with no judge-decided row never enter the denominator.
 *    3. Range vs lifetime scope the judge-decided scan by decidedAt. */
import { assertEquals } from "#assert";
import {
  getReviewerOverturns, getReviewerOverturnsLifetime, getReviewerOverturnDetail,
  _resetReviewerQualityCacheForTests,
} from "./mod.ts";
import { setStored, resetFirestoreCredentials } from "@core/data/firestore/mod.ts";
import { saveFinding } from "@audit/domain/data/audit-repository/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

const MS_DAY = 86_400_000;
function uniqueOrg(tag: string): OrgId {
  return (`test-rq-${tag}-${crypto.randomUUID().slice(0, 8)}`) as unknown as OrgId;
}

async function seedFinding(
  orgId: OrgId, findingId: string,
  questions: Array<{ header: string; reviewedBy?: string }>,
): Promise<void> {
  const answeredQuestions = questions.map((q) => ({
    header: q.header, answer: "No", reviewedBy: q.reviewedBy, reviewAction: "confirm",
  }));
  await saveFinding(orgId, { id: findingId, findingStatus: "finished", record: {}, answeredQuestions });
}

async function seedDecision(
  orgId: OrgId, findingId: string, qIndex: number, header: string,
  judge: string, decision: "uphold" | "overturn", decidedAt: number,
): Promise<void> {
  await setStored("judge-decided", orgId, [findingId, qIndex], {
    findingId, questionIndex: qIndex, header, judge, decision, decidedAt,
  });
}

function reset(): void {
  resetFirestoreCredentials();
  _resetReviewerQualityCacheForTests();
}

Deno.test("getReviewerOverturns — attributes each judged question to its reviewer", async () => {
  reset();
  const orgId = uniqueOrg("attr");
  const now = Date.now();
  await seedFinding(orgId, "f1", [
    { header: "Taxes", reviewedBy: "alice@x.com" },
    { header: "Income", reviewedBy: "bob@x.com" },
  ]);
  await seedDecision(orgId, "f1", 0, "Taxes", "judge@x.com", "overturn", now - MS_DAY);
  await seedDecision(orgId, "f1", 1, "Income", "judge@x.com", "uphold", now - MS_DAY);

  const res = await getReviewerOverturns(orgId, { from: now - 7 * MS_DAY, to: now });
  const alice = res.rows.find((r) => r.email === "alice@x.com")!;
  const bob = res.rows.find((r) => r.email === "bob@x.com")!;
  assertEquals(alice.judged, 1);
  assertEquals(alice.overturns, 1);
  assertEquals(alice.overturnRate, 100);
  assertEquals(alice.byHeader[0].header, "Taxes");
  assertEquals(bob.judged, 1);
  assertEquals(bob.overturns, 0);
  assertEquals(bob.overturnRate, 0);
});

Deno.test("getReviewerOverturns — denominator is appealed-and-judged only", async () => {
  reset();
  const orgId = uniqueOrg("denom");
  const now = Date.now();
  // Three of alice's reviews were appealed AND judged: 1 overturn, 2 upheld → 33%.
  await seedFinding(orgId, "f1", [{ header: "A", reviewedBy: "alice@x.com" }]);
  await seedFinding(orgId, "f2", [{ header: "A", reviewedBy: "alice@x.com" }]);
  await seedFinding(orgId, "f3", [{ header: "A", reviewedBy: "alice@x.com" }]);
  await seedDecision(orgId, "f1", 0, "A", "judge@x.com", "overturn", now - MS_DAY);
  await seedDecision(orgId, "f2", 0, "A", "judge@x.com", "uphold", now - MS_DAY);
  await seedDecision(orgId, "f3", 0, "A", "judge@x.com", "uphold", now - MS_DAY);
  // A 4th audit alice reviewed but was never appealed (no judge-decided row).
  await seedFinding(orgId, "f4", [{ header: "A", reviewedBy: "alice@x.com" }]);

  const res = await getReviewerOverturns(orgId, { from: now - 7 * MS_DAY, to: now });
  const alice = res.rows.find((r) => r.email === "alice@x.com")!;
  assertEquals(alice.judged, 3);          // f4 excluded — never judged
  assertEquals(alice.overturns, 1);
  assertEquals(alice.overturnRate, 33);
  assertEquals(alice.auditsJudged, 3);
  assertEquals(alice.auditsOverturned, 1);
});

Deno.test("getReviewerOverturns — falls back to finding-level reviewer when the question has none", async () => {
  reset();
  const orgId = uniqueOrg("fallback");
  const now = Date.now();
  await seedFinding(orgId, "f1", [
    { header: "A", reviewedBy: "alice@x.com" },
    { header: "B" }, // no reviewedBy on q1
  ]);
  await seedDecision(orgId, "f1", 1, "B", "judge@x.com", "overturn", now - MS_DAY);
  const res = await getReviewerOverturns(orgId, { from: now - 7 * MS_DAY, to: now });
  const alice = res.rows.find((r) => r.email === "alice@x.com")!;
  assertEquals(alice.judged, 1);
  assertEquals(alice.overturns, 1);
});

Deno.test("getReviewerOverturnDetail — lifetime includes decisions outside the range", async () => {
  reset();
  const orgId = uniqueOrg("lifetime");
  const now = Date.now();
  await seedFinding(orgId, "recent", [{ header: "A", reviewedBy: "alice@x.com" }]);
  await seedFinding(orgId, "old", [{ header: "A", reviewedBy: "alice@x.com" }]);
  await seedDecision(orgId, "recent", 0, "A", "judge@x.com", "overturn", now - MS_DAY);
  await seedDecision(orgId, "old", 0, "A", "judge@x.com", "uphold", now - 60 * MS_DAY);

  const detail = await getReviewerOverturnDetail(orgId, "alice@x.com", { from: now - 7 * MS_DAY, to: now });
  assertEquals(detail.range!.judged, 1);     // only the recent decision
  assertEquals(detail.range!.overturns, 1);
  assertEquals(detail.lifetime!.judged, 2);  // both decisions
  assertEquals(detail.lifetime!.overturns, 1);
});

Deno.test("getReviewerOverturns — empty when no decisions", async () => {
  reset();
  const orgId = uniqueOrg("empty");
  const res = await getReviewerOverturns(orgId, { from: Date.now() - MS_DAY, to: Date.now() });
  assertEquals(res.rows.length, 0);
  assertEquals(res.cohortDecisions, 0);
});

// Lifetime helper smoke — distinct entry point, snapped cache key.
Deno.test("getReviewerOverturnsLifetime — tallies all-time decisions", async () => {
  reset();
  const orgId = uniqueOrg("life2");
  const now = Date.now();
  await seedFinding(orgId, "f1", [{ header: "A", reviewedBy: "alice@x.com" }]);
  await seedDecision(orgId, "f1", 0, "A", "judge@x.com", "overturn", now - 100 * MS_DAY);
  const res = await getReviewerOverturnsLifetime(orgId);
  const alice = res.rows.find((r) => r.email === "alice@x.com")!;
  assertEquals(alice.judged, 1);
  assertEquals(alice.overturns, 1);
});
