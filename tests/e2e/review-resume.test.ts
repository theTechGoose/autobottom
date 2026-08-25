/** Integration test for cancel-on-finalize stranded-audit resume + discard (Fix 3).
 *
 *  Pattern: in-process — directly invokes review-queue + audit-repository
 *  modules against the in-memory Firestore fallback (same approach as
 *  review-types.test.ts).
 *
 *  Run: deno test --allow-all tests/e2e/review-resume.test.ts */

import { assert, assertEquals } from "#assert";
import {
  resetFirestoreCredentials,
  setStored,
  getStored,
  listStoredWithKeys,
} from "@core/data/firestore/mod.ts";
import type { ReviewDecision } from "@core/dto/types.ts";
import { saveFinding, saveTranscript } from "@audit/domain/data/audit-repository/mod.ts";
import {
  populateReviewQueue,
  claimNextItem,
  recordDecision,
  discardReview,
} from "@review/domain/business/review-queue/mod.ts";
import type { ReviewItem } from "@core/dto/types.ts";

const orgBase = "review-resume-test-org";
let ORG = `${orgBase}-${crypto.randomUUID().slice(0, 8)}`;

/** Start each test from a clean slate.
 *
 *  These tests run against the Firestore emulator like everything else — which
 *  is the point, because claim/lock behavior depends on real atomic writes and
 *  a Map could never prove it. But a real database persists between tests AND
 *  between runs, so "clean" now means a fresh org rather than a cleared Map:
 *  isolation comes from the key space. */
function forceInMemoryFirestore(): void {
  ORG = `${orgBase}-${crypto.randomUUID().slice(0, 8)}`;
  resetFirestoreCredentials();
}

interface AnsweredQuestion {
  answer: string;
  header: string;
  populated: string;
  thinking: string;
  defense: string;
}

async function seedAudit(findingId: string, completedAt: number): Promise<void> {
  const answeredQuestions: AnsweredQuestion[] = [
    { answer: "No", header: `${findingId} Q1`, populated: "did the rep do thing 1?", thinking: "", defense: "" },
    { answer: "No", header: `${findingId} Q2`, populated: "did the rep do thing 2?", thinking: "", defense: "" },
  ];
  await saveFinding(ORG, {
    id: findingId,
    findingId,
    findingStatus: "finished",
    answeredQuestions,
    completedAt,
    recordingIdField: "RelatedDestinationId",
    record: { RelatedDestinationId: "D9999" },
  });
  await saveTranscript(ORG, findingId, "transcript", "transcript", []);
  await populateReviewQueue(
    ORG,
    findingId,
    answeredQuestions,
    "RelatedDestinationId",
    "D9999",
    undefined,
    completedAt,
  );
}

Deno.test({
  name: "Resume — setup (firestore emulator)",
  fn() { forceInMemoryFirestore(); },
});

Deno.test({
  name: "Resume — claimNextItem returns same finding when reviewer has unfinalized decisions",
  async fn() {
    forceInMemoryFirestore();
    const reviewer = "reviewer-resume@test.local";

    // Seed two audits so the wrong-pick failure mode is observable.
    await seedAudit("strand-1", 1_700_000_000_000);
    await seedAudit("strand-2", 1_700_000_001_000);

    // Simulate the user fully decided audit strand-1: claim it, decide both
    // questions. After the second decide auditComplete becomes true and all
    // entries move from review-active to review-decided. There is no
    // review-done entry yet (user cancelled the finalize modal).
    const claim1 = await claimNextItem(ORG, reviewer);
    assertEquals(claim1.buffer[0].findingId, "strand-1", "FIFO oldest first");
    for (const item of claim1.buffer) {
      await recordDecision(ORG, item.findingId, item.questionIndex, "confirm", reviewer);
    }
    // Sanity: counter is 0 and no review-done.
    const counter = await getStored<number>("review-audit-pending", ORG, "strand-1");
    assertEquals(counter, 0, "all decisions recorded → counter 0");
    const done = await getStored("review-done", ORG, "strand-1");
    assertEquals(done, null, "audit not finalized yet");

    // The bug: a fresh /review/api/next call would hand the reviewer
    // strand-2 instead of strand-1. The fix re-surfaces strand-1 because
    // it has decisions but no review-done.
    const claim2 = await claimNextItem(ORG, reviewer);
    assert(claim2.buffer.length > 0, "must return a buffer for the stranded audit");
    assertEquals(claim2.buffer[0].findingId, "strand-1",
      "must resume the stranded audit, not pick a fresh one (got " + claim2.buffer[0].findingId + ")");
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "Discard — releases claim + decisions, next call returns a different audit",
  async fn() {
    forceInMemoryFirestore();
    const reviewer = "reviewer-discard@test.local";

    await seedAudit("disc-1", 1_700_000_000_000);
    await seedAudit("disc-2", 1_700_000_001_000);

    // Strand the first audit
    const claim1 = await claimNextItem(ORG, reviewer);
    assertEquals(claim1.buffer[0].findingId, "disc-1");
    for (const item of claim1.buffer) {
      await recordDecision(ORG, item.findingId, item.questionIndex, "confirm", reviewer);
    }

    // Discard
    const r = await discardReview(ORG, reviewer, "disc-1");
    assertEquals(r.ok, true);
    assert(r.restored > 0, "must report at least one restored item");

    // Decisions for disc-1 should be cleared.
    const decided = await listStoredWithKeys<ReviewItem & { findingId: string }>("review-decided", ORG);
    const disc1Decided = decided.filter(({ key }) => key[0] === "disc-1");
    assertEquals(disc1Decided.length, 0, "all decisions for disc-1 should be cleared");

    // Active claims for this reviewer on disc-1 should be cleared too.
    const active = await listStoredWithKeys<ReviewItem & { findingId: string }>("review-active", ORG);
    const disc1Active = active.filter(({ key, value }) => key[0] === reviewer && value.findingId === "disc-1");
    assertEquals(disc1Active.length, 0, "all claims for disc-1 should be cleared");

    // Now the reviewer's next pick: since disc-1 is back in pending (oldest),
    // FIFO would actually pick disc-1 again. To prove the claim was released,
    // we let a DIFFERENT reviewer claim — they should get disc-1 cleanly.
    const otherReviewer = "another-reviewer@test.local";
    const claim2 = await claimNextItem(ORG, otherReviewer);
    assert(claim2.buffer.length > 0, "another reviewer should be able to pick up the discarded audit");
    assertEquals(claim2.buffer[0].findingId, "disc-1", "the discarded audit must be back in the FIFO queue");
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "Resume — recovers totalForFinding when stored decision has 0 (regression: '0 FAILED' panel header)",
  async fn() {
    forceInMemoryFirestore();
    const reviewer = "reviewer-zerocount@test.local";

    // Seed an audit + run it through the normal claim+decide flow so all the
    // necessary review-* records exist, then corrupt review-decided in the
    // way prod data sometimes does: totalForFinding=0 (recorded against a
    // stale active buffer that lacked the count).
    await seedAudit("zerocount-1", 1_700_000_000_000);
    const claim = await claimNextItem(ORG, reviewer);
    assertEquals(claim.buffer.length, 2);
    for (const item of claim.buffer) {
      await recordDecision(ORG, item.findingId, item.questionIndex, "confirm", reviewer);
    }

    // Rewrite each review-decided record with totalForFinding=0 to mimic the
    // observed corruption.
    const decided = await listStoredWithKeys<ReviewDecision>("review-decided", ORG);
    for (const { key, value } of decided) {
      if (key[0] !== "zerocount-1") continue;
      await setStored("review-decided", ORG, key, { ...value, totalForFinding: 0 });
    }

    // Resume — the panel must NOT render "0 FAILED". claimNextItem's resume
    // path now uses `||` (not `??`) so a stored 0 falls back to decisions.length.
    const resumed = await claimNextItem(ORG, reviewer);
    assert(resumed.buffer.length > 0, "must resume the stranded audit");
    for (const item of resumed.buffer) {
      assertEquals(item.totalForFinding, 2,
        "totalForFinding must be recovered to decisions.length, not stored 0");
      assert(item.reviewIndex >= 1, "reviewIndex must also be recovered (>=1)");
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Avoid leaving seeded state behind for the next file in the e2e batch.
Deno.test({
  name: "Resume — cleanup",
  fn() { resetFirestoreCredentials(); void setStored; },
  sanitizeResources: false,
  sanitizeOps: false,
});
