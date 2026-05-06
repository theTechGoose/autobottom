/** Integration test for the deferred-commit final-question flow.
 *
 *  The reviewer's answer on the LAST question of an audit must NOT be written
 *  to review-decided until they type YES in the confirm modal. "Back to Audit"
 *  must leave the audit fully editable (final question still open, no decision
 *  recorded). Only after the YES + decide-then-finalize sequence runs do the
 *  decisions land + the audit move to review-done.
 *
 *  Pattern: in-process — directly invokes review-queue helpers against the
 *  in-memory Firestore fallback (mirrors review-resume.test.ts).
 *
 *  Run: deno test --allow-all tests/e2e/review-finalize-defer.test.ts */

import { assert, assertEquals } from "#assert";
import {
  resetFirestoreCredentials,
  getStored,
  listStoredWithKeys,
} from "@core/data/firestore/mod.ts";
import { saveFinding, saveTranscript } from "@audit/domain/data/audit-repository/mod.ts";
import {
  populateReviewQueue,
  claimNextItem,
  recordDecision,
  finalizeReviewedAudit,
} from "@review/domain/business/review-queue/mod.ts";
import type { ReviewItem } from "@core/dto/types.ts";

const ORG = "review-finalize-defer-test-org";

function forceInMemoryFirestore(): void {
  for (const k of ["S3_BUCKET", "AWS_S3_BUCKET", "FIREBASE_SA_S3_KEY", "FIREBASE_PROJECT_ID"]) {
    try { Deno.env.delete(k); } catch { /* ignore */ }
  }
  resetFirestoreCredentials();
}

interface AnsweredQuestion {
  answer: string;
  header: string;
  populated: string;
  thinking: string;
  defense: string;
}

async function seedAudit(findingId: string): Promise<void> {
  const answeredQuestions: AnsweredQuestion[] = [
    { answer: "No", header: `${findingId} Q1`, populated: "did the rep do thing 1?", thinking: "", defense: "" },
    { answer: "No", header: `${findingId} Q2`, populated: "did the rep do thing 2?", thinking: "", defense: "" },
    { answer: "No", header: `${findingId} Q3 — final`, populated: "did the rep do thing 3?", thinking: "", defense: "" },
  ];
  await saveFinding(ORG, {
    id: findingId,
    findingId,
    findingStatus: "finished",
    answeredQuestions,
    completedAt: 1_700_000_000_000,
    recordingIdField: "RelatedDestinationId",
    record: { RelatedDestinationId: "D9999" },
  });
  await saveTranscript(ORG, findingId, "transcript", "transcript", []);
  await populateReviewQueue(
    ORG, findingId, answeredQuestions,
    "RelatedDestinationId", "D9999",
    undefined, 1_700_000_000_000,
  );
}

Deno.test({
  name: "Defer — setup (in-memory firestore)",
  fn() { forceInMemoryFirestore(); },
});

Deno.test({
  name: "Defer — Back to Audit on final-question modal leaves NO decision recorded",
  async fn() {
    forceInMemoryFirestore();
    const reviewer = "defer-back@test.local";
    await seedAudit("defer-1");

    // Decide questions 1 and 2 normally (these are NOT the final question).
    const claim = await claimNextItem(ORG, reviewer);
    assertEquals(claim.buffer.length, 3, "3 questions queued");
    const q1 = claim.buffer[0];
    const q2 = claim.buffer[1];
    await recordDecision(ORG, q1.findingId, q1.questionIndex, "confirm", reviewer);
    const r2 = await recordDecision(ORG, q2.findingId, q2.questionIndex, "confirm", reviewer);
    assertEquals(r2.auditComplete, false, "still 1 question remaining after q2");

    // CRITICAL: the user clicks an answer on the final question, then "Back
    // to Audit". Under the new UX, the frontend never POSTs /api/review/decide
    // for that click, so the backend records nothing.
    //
    // Verify the resulting state matches that contract.
    const decided = await listStoredWithKeys<{ findingId: string }>("review-decided", ORG);
    const myDecided = decided.filter(({ key }) => key[0] === "defer-1");
    assertEquals(myDecided.length, 2, "only the 2 NON-final decisions are persisted");

    const counter = await getStored<number>("review-audit-pending", ORG, "defer-1");
    assertEquals(counter, 1, "audit-pending counter still has 1 (the final question)");

    const done = await getStored("review-done", ORG, "defer-1");
    assertEquals(done, null, "audit MUST NOT be finalized — user only typed an answer, not YES");
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "Defer — Submit & Finalize sequence (decide-then-finalize) commits the last decision and finishes the audit",
  async fn() {
    forceInMemoryFirestore();
    const reviewer = "defer-yes@test.local";
    await seedAudit("defer-2");

    const claim = await claimNextItem(ORG, reviewer);
    assertEquals(claim.buffer.length, 3);
    const q1 = claim.buffer[0];
    const q2 = claim.buffer[1];
    const q3 = claim.buffer[2]; // the final question
    await recordDecision(ORG, q1.findingId, q1.questionIndex, "confirm", reviewer);
    await recordDecision(ORG, q2.findingId, q2.questionIndex, "flip", reviewer);

    // The frontend's submitConfirm() calls decide-then-finalize when the
    // reviewer types YES. Reproduce that sequence here.
    const decideFinal = await recordDecision(ORG, q3.findingId, q3.questionIndex, "confirm", reviewer);
    assertEquals(decideFinal.auditComplete, true, "auditComplete fires only on the YES-driven decide");

    const fin = await finalizeReviewedAudit(ORG, "defer-2", reviewer);
    assertEquals(fin.alreadyFinalized ?? false, false, "first finalize call must succeed");
    assert(typeof fin.score === "number", "finalize returns a numeric score");

    // Now we expect: all 3 decisions persisted, counter at 0, review-done written.
    const decided = await listStoredWithKeys<{ findingId: string }>("review-decided", ORG);
    const myDecided = decided.filter(({ key }) => key[0] === "defer-2");
    assertEquals(myDecided.length, 3, "all 3 questions in review-decided after submit");

    const counter = await getStored<number>("review-audit-pending", ORG, "defer-2");
    assertEquals(counter, 0, "audit-pending counter at 0 after final decision");

    const done = await getStored("review-done", ORG, "defer-2");
    assert(done !== null, "review-done is written by finalizeReviewedAudit");
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "Defer — Back-then-flip: reviewer can change their final answer freely until YES is typed",
  async fn() {
    forceInMemoryFirestore();
    const reviewer = "defer-flipflop@test.local";
    await seedAudit("defer-3");

    const claim = await claimNextItem(ORG, reviewer);
    const q1 = claim.buffer[0];
    const q2 = claim.buffer[1];
    const q3 = claim.buffer[2];
    await recordDecision(ORG, q1.findingId, q1.questionIndex, "confirm", reviewer);
    await recordDecision(ORG, q2.findingId, q2.questionIndex, "confirm", reviewer);

    // User clicks "Confirm No" on q3 → modal opens → "Back to Audit" → no commit.
    // User then clicks "Flip to Yes" → modal opens → types YES → submit.
    // The frontend never POSTs the first click; it only POSTs the second.
    const r = await recordDecision(ORG, q3.findingId, q3.questionIndex, "flip", reviewer);
    assertEquals(r.auditComplete, true);

    const decided = await listStoredWithKeys<{ decision: string }>("review-decided", ORG);
    const q3Decided = decided.find(({ key }) => key[0] === "defer-3" && String(key[1]) === String(q3.questionIndex));
    assert(q3Decided, "q3 decision is persisted on the YES-driven submit");
    assertEquals(q3Decided!.value.decision, "flip", "the SECOND choice (flip) wins, not the first (confirm)");

    // No stray "confirm" record exists for q3 from the discarded first click.
    const q3Records = decided.filter(({ key }) => key[0] === "defer-3" && String(key[1]) === String(q3.questionIndex));
    assertEquals(q3Records.length, 1, "exactly one record for q3 — the committed final answer");
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "Defer — cleanup",
  fn() { resetFirestoreCredentials(); },
  sanitizeResources: false,
  sanitizeOps: false,
});
