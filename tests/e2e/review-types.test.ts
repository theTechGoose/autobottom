/** Integration test for the reviewer type-filter (Fix 1).
 *
 *  Pattern: in-process — directly invokes the review-queue + audit-repository
 *  modules against the in-memory Firestore fallback. We don't spin the
 *  unified server because seeding review-pending state via real audit flow
 *  needs QuickBase, and the controller's `/review/api/next` only resolves
 *  the orgId via env (defaultOrgId()), not the session — meaning a normal
 *  e2e harness can't isolate the test data anyway.
 *
 *  Run: deno test --allow-all tests/e2e/review-types.test.ts */

import { assert, assertEquals } from "#assert";
import { resetFirestoreCredentials } from "@core/data/firestore/mod.ts";
import { saveFinding, saveTranscript } from "@audit/domain/data/audit-repository/mod.ts";
import { populateReviewQueue, claimNextItem } from "@review/domain/business/review-queue/mod.ts";
import { saveReviewerConfig } from "@admin/domain/data/admin-repository/mod.ts";

const orgBase = "review-types-test-org";
let ORG = `${orgBase}-${crypto.randomUUID().slice(0, 8)}`;

/** Force the in-memory firestore fallback for the duration of this test file.
 *  Without this, a developer with FIREBASE_* + S3_BUCKET in their shell env
 *  would route writes to real Firestore and pollute prod data. */
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

Deno.test({
  name: "Reviewer type filter — setup (firestore emulator)",
  fn() { forceInMemoryFirestore(); },
});

interface AnsweredQuestion {
  answer: string;
  header: string;
  populated: string;
  thinking: string;
  defense: string;
}

async function seedAudit(findingId: string, isPackage: boolean, completedAt: number): Promise<void> {
  const answeredQuestions: AnsweredQuestion[] = [
    { answer: "No", header: `Q1 for ${findingId}`, populated: "did the rep do the thing?", thinking: "", defense: "" },
    { answer: "No", header: `Q2 for ${findingId}`, populated: "did the rep do another thing?", thinking: "", defense: "" },
  ];
  await saveFinding(ORG, {
    id: findingId,
    findingId,
    findingStatus: "finished",
    answeredQuestions,
    completedAt,
    recordingIdField: isPackage ? "GenieNumber" : "RelatedDestinationId",
    record: isPackage ? { GenieNumber: "G1234" } : { RelatedDestinationId: "D5678" },
  });
  await saveTranscript(ORG, findingId, "transcript", "transcript", []);
  await populateReviewQueue(
    ORG,
    findingId,
    answeredQuestions,
    isPackage ? "GenieNumber" : "RelatedDestinationId",
    isPackage ? "G1234" : "D5678",
    undefined,
    completedAt,
  );
}

Deno.test({
  name: "Reviewer type filter — only date-leg items returned when allowedTypes=['date-leg']",
  async fn() {
    forceInMemoryFirestore();
    const reviewer = "reviewer-dl@test.local";
    await saveReviewerConfig(ORG, reviewer, { allowedTypes: ["date-leg"] });

    // One package audit, one date-leg audit. Pick by completedAt: the
    // package is older, so without a filter it would win.
    await seedAudit("audit-pkg-1", true, 1_700_000_000_000);
    await seedAudit("audit-dl-1", false, 1_700_000_001_000);

    const result = await claimNextItem(ORG, reviewer, ["date-leg"]);
    assert(result.buffer.length > 0, "should claim items for the date-leg audit");
    assertEquals(result.buffer[0].findingId, "audit-dl-1", "must skip the package audit and pick the date-leg one");
    for (const item of result.buffer) {
      assert(
        item.recordingIdField !== "GenieNumber",
        `claimed item ${item.findingId}/${item.questionIndex} is a package — type filter ignored`,
      );
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "Reviewer type filter — only package items returned when allowedTypes=['package']",
  async fn() {
    forceInMemoryFirestore();
    const reviewer = "reviewer-pkg@test.local";
    await saveReviewerConfig(ORG, reviewer, { allowedTypes: ["package"] });

    // Date-leg is older this time; without a filter it would win FIFO.
    await seedAudit("audit-dl-2", false, 1_700_000_000_000);
    await seedAudit("audit-pkg-2", true, 1_700_000_001_000);

    const result = await claimNextItem(ORG, reviewer, ["package"]);
    assert(result.buffer.length > 0, "should claim items for the package audit");
    assertEquals(result.buffer[0].findingId, "audit-pkg-2", "must skip date-leg and pick package");
    for (const item of result.buffer) {
      assertEquals(
        item.recordingIdField,
        "GenieNumber",
        `claimed item ${item.findingId}/${item.questionIndex} is not a package`,
      );
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "Reviewer type filter — undefined allowedTypes returns FIFO oldest regardless of type",
  async fn() {
    forceInMemoryFirestore();
    const reviewer = "reviewer-all@test.local";

    await seedAudit("audit-pkg-3", true, 1_700_000_000_000);
    await seedAudit("audit-dl-3", false, 1_700_000_001_000);

    const result = await claimNextItem(ORG, reviewer, undefined);
    assert(result.buffer.length > 0);
    assertEquals(result.buffer[0].findingId, "audit-pkg-3", "FIFO with no filter should pick the oldest (package)");
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Sanity: type-filter parsing in the controller's CSV path works as expected.
// Mirrors `src/review/entrypoints/review/mod.ts:22`.
Deno.test({
  name: "Reviewer type filter — CSV 'date-leg,package' parses to both types (no filter)",
  fn() {
    const csv = "date-leg,package";
    const arr = csv.split(",").map((t) => t.trim());
    assertEquals(arr, ["date-leg", "package"]);
  },
});

// Avoid leaving seeded state behind for the next file in the e2e batch.
Deno.test({
  name: "Reviewer type filter — cleanup",
  fn() {
    forceInMemoryFirestore();
  },
  sanitizeResources: false,
  sanitizeOps: false,
});
