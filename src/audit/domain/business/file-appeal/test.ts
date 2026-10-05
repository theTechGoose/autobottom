/** Tests for fileJudgeAppeal — exercises the in-mem Firestore fallback so
 *  these run without real Firebase creds. Covers:
 *   - happy path queues judge items
 *   - throws clear error for Invalid Genie (no answered questions)
 *   - throws when finding missing
 *   - throws when no matching failed questions */

import { assert, assertEquals, assertRejects } from "#assert";
import { resetFirestoreCredentials } from "@core/data/firestore/mod.ts";
import { saveFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { fileJudgeAppeal } from "./mod.ts";

const ORG = "test-org-fa-" + crypto.randomUUID().slice(0, 8) as unknown as Parameters<typeof saveFinding>[0];

Deno.test({ name: "file-appeal — fileJudgeAppeal export exists", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const mod = await import("./mod.ts");
  assert(typeof mod.fileJudgeAppeal === "function");
}});

Deno.test({ name: "file-appeal — Invalid Genie (no answered questions) throws clear error", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  const findingId = "fid-invalid-" + crypto.randomUUID().slice(0, 8);
  await saveFinding(ORG, {
    id: findingId,
    findingStatus: "finished",
    rawTranscript: "Invalid Genie",
    answeredQuestions: [],
    record: { RecordId: "999" },
    recordingId: "27229612",
    recordingIdField: "VoGenie",
  });
  const err = await assertRejects(
    () => fileJudgeAppeal(ORG, findingId, { auditor: "test@x.com", appealedQuestions: [0] }),
    Error,
  );
  assert(
    err.message.includes("no answered questions"),
    `expected 'no answered questions' in error, got: ${err.message}`,
  );
  assert(
    err.message.toLowerCase().includes("invalid genie"),
    `expected guidance about Invalid Genie path, got: ${err.message}`,
  );
}});

Deno.test({ name: "file-appeal — finding not found throws", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  await assertRejects(
    () => fileJudgeAppeal(ORG, "nonexistent-fid", { auditor: "test@x.com", appealedQuestions: [0] }),
    Error,
    "finding not found",
  );
}});

Deno.test({ name: "file-appeal — happy path queues judge items + saves appeal", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  const findingId = "fid-happy-" + crypto.randomUUID().slice(0, 8);
  await saveFinding(ORG, {
    id: findingId,
    findingStatus: "finished",
    answeredQuestions: [
      { header: "Q1", populated: "P1", thinking: "T1", defense: "D1", answer: "Yes" },
      { header: "Q2", populated: "P2", thinking: "T2", defense: "D2", answer: "No" },
      { header: "Q3", populated: "P3", thinking: "T3", defense: "D3", answer: "No" },
    ],
    record: { RecordId: "999" },
    recordingId: "27229612",
    recordingIdField: "VoGenie",
  });

  const result = await fileJudgeAppeal(ORG, findingId, {
    auditor: "test@x.com",
    comment: "test appeal",
    appealedQuestions: [1, 2],
  });

  assertEquals(result.ok, true);
  assertEquals(result.queued, 2);
  assertEquals(result.judgeUrl, "/judge");
}});

Deno.test({ name: "file-appeal — appealing only a Yes-answer question rejects with no-matching-failed", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  const findingId = "fid-onlyyes-" + crypto.randomUUID().slice(0, 8);
  await saveFinding(ORG, {
    id: findingId,
    findingStatus: "finished",
    answeredQuestions: [
      { header: "Q1", populated: "P1", thinking: "T1", defense: "D1", answer: "Yes" },
      { header: "Q2", populated: "P2", thinking: "T2", defense: "D2", answer: "No" },
    ],
    record: { RecordId: "999" },
    recordingId: "27229612",
    recordingIdField: "VoGenie",
  });
  await assertRejects(
    () => fileJudgeAppeal(ORG, findingId, { auditor: "test@x.com", appealedQuestions: [0] }),
    Error,
    "no matching failed questions",
  );
}});

// ── The appeal takes the audit off the manager's remediation queue ───────────
// An audit whose result is being contested is not ready to coach on. This is
// the wiring that moves the row; if it is ever dropped, a manager is asked to
// coach a failure that is actively being disputed.

Deno.test({ name: "file-appeal — flags the manager-queue row so it leaves Pending", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  const { setStored, getStored } = await import("@core/data/firestore/mod.ts");
  const { isOpenQueueItem } = await import("@manager/domain/data/manager-repository/mod.ts");
  const findingId = "fid-fa-queue-" + crypto.randomUUID().slice(0, 8);
  await saveFinding(ORG, {
    id: findingId,
    findingStatus: "finished",
    answeredQuestions: [{ header: "Q0", answer: "No" }, { header: "Q1", answer: "Yes" }],
    record: { RecordId: "555", ActivatingOffice: "ODR" },
    recordingId: "27229613",
    recordingIdField: "VoGenie",
  });
  await setStored("manager-queue", ORG, [findingId], {
    findingId, addedAt: 1, status: "pending", department: "ODR", voName: "Reese Moore",
  });

  await fileJudgeAppeal(ORG, findingId, {
    auditor: "reesem@monsterrg.com",
    comment: "the bot misheard the disclosure",
    appealedQuestions: [0],
  });

  const row = await getStored<Record<string, unknown>>("manager-queue", ORG, findingId);
  assertEquals(row?.appealState, "appealed");
  assertEquals(row?.appealedBy, "reesem@monsterrg.com");
  assertEquals(row?.appealNote, "the bot misheard the disclosure");
  assert(typeof row?.appealedAt === "number" && row.appealedAt > 0);
  assert(!isOpenQueueItem(row as { status?: string; appealState?: string }), "must leave the pending queue");
  // Display fields survive, or the Completed row renders blank.
  assertEquals(row?.department, "ODR");
  assertEquals(row?.voName, "Reese Moore");
}});

Deno.test({ name: "file-appeal — an audit that was never queued still appeals fine", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  const findingId = "fid-fa-unqueued-" + crypto.randomUUID().slice(0, 8);
  await saveFinding(ORG, {
    id: findingId,
    findingStatus: "finished",
    answeredQuestions: [{ header: "Q0", answer: "No" }],
    record: { RecordId: "556" },
    recordingId: "27229614",
    recordingIdField: "VoGenie",
  });
  // Most audits never reach a manager queue — the missing row must not be
  // treated as a failure, or filing an appeal would start throwing.
  const res = await fileJudgeAppeal(ORG, findingId, { auditor: "rep@x.com", appealedQuestions: [0] });
  assertEquals(res.ok, true);
  assertEquals(res.queued, 1);
}});

// ── An appeal waits for the review (REQ-003 / REQ-004) ──────────────────────
// An audit the review queue picked up must be reviewed — every failed question
// decided and the review finished — before anyone can appeal it. Appealing
// earlier put the same questions in front of a reviewer AND a judge at once.

async function queueForReview(findingId: string) {
  const { populateReviewQueue } = await import("@review/domain/business/review-queue/mod.ts");
  const answered = [
    { header: "Q0", populated: "P0", thinking: "T0", defense: "D0", answer: "No" },
    { header: "Q1", populated: "P1", thinking: "T1", defense: "D1", answer: "Yes" },
    { header: "Q2", populated: "P2", thinking: "T2", defense: "D2", answer: "No" },
  ];
  await saveFinding(ORG, {
    id: findingId,
    findingStatus: "finished",
    answeredQuestions: answered,
    record: { RecordId: "777" },
    recordingId: "27229615",
    recordingIdField: "VoGenie",
  });
  await populateReviewQueue(ORG, findingId, answered, "VoGenie", "777");
}

Deno.test({ name: "REQ-003: an audit queued for review cannot be appealed until it is reviewed", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  const { listStoredByKeyPrefix } = await import("@core/data/firestore/mod.ts");
  const findingId = "fid-fa-awaiting-" + crypto.randomUUID().slice(0, 8);
  await queueForReview(findingId);

  await assertRejects(
    () => fileJudgeAppeal(ORG, findingId, { auditor: "rep@x.com", appealedQuestions: [0, 2] }),
    Error,
    "awaiting review",
  );
  // Nothing reached the judge queue.
  assertEquals((await listStoredByKeyPrefix("judge-pending", ORG, findingId)).length, 0);
}});

Deno.test({ name: "REQ-003: an audit that never needed review can still be appealed", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  const findingId = "fid-fa-noreview-" + crypto.randomUUID().slice(0, 8);
  // Bypassed offices / Invalid Genie never enter the review queue — there is no
  // review to wait for, so the appeal must not be held.
  await saveFinding(ORG, {
    id: findingId,
    findingStatus: "finished",
    answeredQuestions: [{ header: "Q0", answer: "No" }],
    record: { RecordId: "778" },
    recordingId: "27229616",
    recordingIdField: "VoGenie",
  });
  const res = await fileJudgeAppeal(ORG, findingId, { auditor: "rep@x.com", appealedQuestions: [0] });
  assertEquals(res.ok, true);
}});

Deno.test({ name: "REQ-004: a partly reviewed audit still cannot be appealed", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  const { recordDecision } = await import("@review/domain/business/review-queue/mod.ts");
  const findingId = "fid-fa-partial-" + crypto.randomUUID().slice(0, 8);
  await queueForReview(findingId);
  // One of the two failed questions decided — the other is still waiting.
  await recordDecision(ORG, findingId, 0, "confirm", "reviewer@x.com");

  await assertRejects(
    () => fileJudgeAppeal(ORG, findingId, { auditor: "rep@x.com", appealedQuestions: [0, 2] }),
    Error,
    "awaiting review",
  );
}});

Deno.test({ name: "REQ-004: once a reviewer finishes every failed question the appeal goes through", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  const { recordDecision, finalizeReviewedAudit } = await import("@review/domain/business/review-queue/mod.ts");
  const findingId = "fid-fa-reviewed-" + crypto.randomUUID().slice(0, 8);
  await queueForReview(findingId);
  await recordDecision(ORG, findingId, 0, "confirm", "reviewer@x.com");
  await recordDecision(ORG, findingId, 2, "confirm", "reviewer@x.com");
  await finalizeReviewedAudit(ORG, findingId, "reviewer@x.com");

  const res = await fileJudgeAppeal(ORG, findingId, { auditor: "rep@x.com", appealedQuestions: [0, 2] });
  assertEquals(res.ok, true);
  assertEquals(res.queued, 2);
}});
