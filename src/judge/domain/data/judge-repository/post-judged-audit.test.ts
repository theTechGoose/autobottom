/** Audit-done-idx sync contract for the judge-overturn path.
 *
 *  postJudgedAudit must write a fresh audit-done-idx entry (and update
 *  completed-audit-stat.score) whenever judges have overturned at least one
 *  question — otherwise the unreviewed/audit-history queries serve stale
 *  scores, exactly like the symptom that motivated the contract on
 *  adminFlipQuestion. If a future change removes the writeAuditDoneIndex
 *  call from postJudgedAudit, these tests fail — fix the code, not the
 *  tests.
 *
 *  Forces in-mem mode via resetFirestoreCredentials() so no real Firestore
 *  is involved. */

import { assert, assertEquals, assertExists } from "#assert";
import {
  resetFirestoreCredentials,
  setStored,
} from "@core/data/firestore/mod.ts";
import { saveFinding, getFinding } from "@audit/domain/data/audit-repository/mod.ts";
import {
  writeAuditDoneIndex,
  queryAuditDoneIndex,
  _resetHiddenCacheForTesting,
} from "@audit/domain/data/stats-repository/mod.ts";
import { postJudgedAudit } from "./mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

function reset() {
  resetFirestoreCredentials();
  _resetHiddenCacheForTesting();
}

async function makeFindingWith4Nos(orgId: OrgId, findingId: string): Promise<number> {
  const completedAt = Date.now();
  const answeredQuestions = [0, 1, 2, 3].map((i) => ({
    header: `Q${i}`,
    populated: `populated ${i}`,
    thinking: `thinking ${i}`,
    defense: `defense ${i}`,
    answer: "No",
  }));
  await saveFinding(orgId, {
    id: findingId,
    auditJobId: "job-" + findingId,
    findingStatus: "finished",
    recordingId: "rec-" + findingId,
    recordingIdField: "VoGenie",
    owner: "test@x.com",
    record: { RecordId: "r-" + findingId, VoName: "VO 02 - Judge Test", ActivatingOffice: "EPG", Shift: "Night" },
    answeredQuestions,
    completedAt,
  } as unknown as Parameters<typeof saveFinding>[1]);
  return completedAt;
}

async function seedJudgeDecisions(
  orgId: OrgId,
  findingId: string,
  decisions: Array<{ questionIndex: number; decision: "uphold" | "overturn" }>,
): Promise<void> {
  for (const d of decisions) {
    await setStored("judge-decided", orgId, [findingId, d.questionIndex], {
      findingId,
      questionIndex: d.questionIndex,
      header: `Q${d.questionIndex}`,
      populated: `populated ${d.questionIndex}`,
      thinking: "thinking",
      defense: "defense",
      answer: "No",
      decision: d.decision,
      judge: "judge@x.com",
      decidedAt: Date.now(),
    });
  }
}

Deno.test("postJudgedAudit — full overturn rewrites index to 100% completed", async () => {
  reset();
  const ORG = ("test-judge-full-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
  const fid = "fid-judge-full-" + crypto.randomUUID().slice(0, 8);
  const completedAt = await makeFindingWith4Nos(ORG, fid);
  // Stale index seeded with pre-judge score (0% — all Nos).
  await writeAuditDoneIndex(ORG, {
    findingId: fid, completedAt, score: 0, completed: false, isPackage: false,
  });
  // Judge overturns ALL 4.
  await seedJudgeDecisions(ORG, fid, [
    { questionIndex: 0, decision: "overturn" },
    { questionIndex: 1, decision: "overturn" },
    { questionIndex: 2, decision: "overturn" },
    { questionIndex: 3, decision: "overturn" },
  ]);

  await postJudgedAudit(ORG, fid, "judge@x.com");

  // Finding's answeredQuestions reflects the overturns.
  const refreshed = await getFinding(ORG, fid);
  assertExists(refreshed);
  const qs = (refreshed!.answeredQuestions ?? []) as Array<{ answer: string }>;
  qs.forEach((q, i) => assertEquals(q.answer, "Yes", `q[${i}] should be overturned to Yes`));

  // Index entry now reflects post-judge state.
  const idx = await queryAuditDoneIndex(ORG, completedAt - 1000, completedAt + 1000);
  const entry = idx.find((e) => e.findingId === fid);
  assertExists(entry, "index entry must exist after postJudgedAudit");
  assertEquals(entry!.score, 100, "index score must be 100 after all-overturn");
  assertEquals(entry!.completed, true, "score === 100 must mark completed");
  assertEquals(entry!.reason, "reviewed");
});

Deno.test("postJudgedAudit — partial overturn rewrites index with intermediate score", async () => {
  reset();
  const ORG = ("test-judge-partial-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
  const fid = "fid-judge-part-" + crypto.randomUUID().slice(0, 8);
  const completedAt = await makeFindingWith4Nos(ORG, fid);
  await writeAuditDoneIndex(ORG, {
    findingId: fid, completedAt, score: 0, completed: false, isPackage: false,
  });
  // Judge overturns 2 of 4 → 50%.
  await seedJudgeDecisions(ORG, fid, [
    { questionIndex: 0, decision: "overturn" },
    { questionIndex: 1, decision: "overturn" },
    { questionIndex: 2, decision: "uphold" },
    { questionIndex: 3, decision: "uphold" },
  ]);

  await postJudgedAudit(ORG, fid, "judge@x.com");

  const idx = await queryAuditDoneIndex(ORG, completedAt - 1000, completedAt + 1000);
  const entry = idx.find((e) => e.findingId === fid);
  assertExists(entry);
  assertEquals(entry!.score, 50, "index score must reflect partial overturn (2/4 = 50%)");
  assertEquals(entry!.completed, false, "score < 100 must NOT mark completed");
});

Deno.test("postJudgedAudit — all-uphold leaves index unchanged (no write)", async () => {
  reset();
  const ORG = ("test-judge-uphold-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
  const fid = "fid-judge-up-" + crypto.randomUUID().slice(0, 8);
  const completedAt = await makeFindingWith4Nos(ORG, fid);
  // Seed index with a distinctive marker score so we can detect non-rewrite.
  await writeAuditDoneIndex(ORG, {
    findingId: fid, completedAt, score: 0, completed: false, isPackage: false,
    voName: "PRE-EXISTING-MARKER",
  });
  // Judge upholds everything → no overturns, no finding modification, no index write.
  await seedJudgeDecisions(ORG, fid, [
    { questionIndex: 0, decision: "uphold" },
    { questionIndex: 1, decision: "uphold" },
    { questionIndex: 2, decision: "uphold" },
    { questionIndex: 3, decision: "uphold" },
  ]);

  await postJudgedAudit(ORG, fid, "judge@x.com");

  // Index entry untouched — postJudgedAudit only writes when overturns > 0.
  const idx = await queryAuditDoneIndex(ORG, completedAt - 1000, completedAt + 1000);
  const entry = idx.find((e) => e.findingId === fid);
  assertExists(entry);
  assertEquals(entry!.voName, "PRE-EXISTING-MARKER", "all-uphold path must not rewrite index");
  assert(entry!.score === 0, "score must remain at seeded 0 (no overturns means no score change)");
});
