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
