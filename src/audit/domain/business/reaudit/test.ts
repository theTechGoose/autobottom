/** Tests for startReauditWithGenies — exercises the in-mem Firestore fallback
 *  so these run without real Firebase creds. enqueueStep hits real QStash so
 *  we mock it out via env LOCAL_QUEUE=true (qstash module respects this). */

import { assert, assertEquals, assertRejects } from "#assert";
import { resetFirestoreCredentials } from "@core/data/firestore/mod.ts";
import { saveFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { startReauditWithGenies } from "./mod.ts";

const ORG = "test-org-ra-" + crypto.randomUUID().slice(0, 8) as unknown as Parameters<typeof saveFinding>[0];

// Force the qstash module into local-mode so enqueueStep doesn't hit Upstash
// during tests. localEnqueue just logs + returns a fake message id.
Deno.env.set("LOCAL_QUEUE", "true");

Deno.test({ name: "reaudit — startReauditWithGenies export exists", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const mod = await import("./mod.ts");
  assert(typeof mod.startReauditWithGenies === "function");
}});

Deno.test({ name: "reaudit — Invalid Genie audit can be re-audited (this is the bug case the user hit)", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  const findingId = "fid-invalid-" + crypto.randomUUID().slice(0, 8);
  // Simulate exactly what step-init writes after exhausting genie retries:
  // findingStatus=finished, rawTranscript='Invalid Genie', no populatedQuestions,
  // no answeredQuestions, recordingId set.
  await saveFinding(ORG, {
    id: findingId,
    auditJobId: "job-" + crypto.randomUUID().slice(0, 8),
    findingStatus: "finished",
    rawTranscript: "Invalid Genie",
    record: { RecordId: "465828" },
    recordingId: "27229612",
    recordingIdField: "VoGenie",
    owner: "test@x.com",
    updateEndpoint: "none",
    startedAt: Date.now(),
  });

  const result = await startReauditWithGenies(ORG, findingId, {
    recordingIds: ["27229612", "27229612"], // user's exact input from the screenshot
    comment: "test",
    agentEmail: "adamp@monsterrg.com",
  });

  assertEquals(result.ok, true);
  assert(result.newFindingId);
  assert(result.reportUrl.includes(result.newFindingId));
  assertEquals(result.appealType, "additional-recording"); // since "27229612" matches old.recordingId
  assertEquals(result.agentEmail, "adamp@monsterrg.com");
}});

Deno.test({ name: "reaudit — different genie produces 'different-recording' appealType", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  const findingId = "fid-diff-" + crypto.randomUUID().slice(0, 8);
  await saveFinding(ORG, {
    id: findingId,
    auditJobId: "job-" + crypto.randomUUID().slice(0, 8),
    findingStatus: "finished",
    record: { RecordId: "100" },
    recordingId: "11111111",
    recordingIdField: "VoGenie",
    owner: "test@x.com",
  });

  const result = await startReauditWithGenies(ORG, findingId, {
    recordingIds: ["22222222"],
    agentEmail: "test@x.com",
  });
  assertEquals(result.appealType, "different-recording");
}});

Deno.test({ name: "reaudit — original kept among new genies → 'additional-recording'", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  const findingId = "fid-add-" + crypto.randomUUID().slice(0, 8);
  await saveFinding(ORG, {
    id: findingId,
    auditJobId: "job-" + crypto.randomUUID().slice(0, 8),
    findingStatus: "finished",
    record: { RecordId: "100" },
    recordingId: "11111111",
    recordingIdField: "VoGenie",
    owner: "test@x.com",
  });

  const result = await startReauditWithGenies(ORG, findingId, {
    recordingIds: ["11111111", "22222222"], // includes original
    agentEmail: "test@x.com",
  });
  assertEquals(result.appealType, "additional-recording");
}});

Deno.test({ name: "reaudit — finding not found throws", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  await assertRejects(
    () => startReauditWithGenies(ORG, "nonexistent-fid", { recordingIds: ["123456"], agentEmail: "x@y.com" }),
    Error,
    "finding not found",
  );
}});

Deno.test({ name: "reaudit — empty recordingIds throws", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  const findingId = "fid-empty-" + crypto.randomUUID().slice(0, 8);
  await saveFinding(ORG, {
    id: findingId,
    auditJobId: "job-x",
    findingStatus: "finished",
    record: { RecordId: "1" },
    recordingId: "11111111",
  });
  await assertRejects(
    () => startReauditWithGenies(ORG, findingId, { recordingIds: [], agentEmail: "x@y.com" }),
    Error,
    "recordingIds must not be empty",
  );
}});

Deno.test({ name: "reaudit — non-numeric recordingId throws with the bad value in message", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  const findingId = "fid-bad-" + crypto.randomUUID().slice(0, 8);
  await saveFinding(ORG, {
    id: findingId,
    auditJobId: "job-x",
    findingStatus: "finished",
    record: { RecordId: "1" },
    recordingId: "11111111",
  });
  const err = await assertRejects(
    () => startReauditWithGenies(ORG, findingId, { recordingIds: ["abc-not-numeric"], agentEmail: "x@y.com" }),
    Error,
  );
  assert(err.message.includes("abc-not-numeric"), `expected bad value in error: ${err.message}`);
}});

Deno.test({ name: "reaudit — soft-deletes old finding (sets reAuditedAt)", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  const { getFinding } = await import("@audit/domain/data/audit-repository/mod.ts");
  const findingId = "fid-soft-" + crypto.randomUUID().slice(0, 8);
  await saveFinding(ORG, {
    id: findingId,
    auditJobId: "job-x",
    findingStatus: "finished",
    record: { RecordId: "1" },
    recordingId: "11111111",
    recordingIdField: "VoGenie",
  });
  await startReauditWithGenies(ORG, findingId, {
    recordingIds: ["22222222"],
    agentEmail: "x@y.com",
  });
  const old = await getFinding(ORG, findingId);
  assert(old);
  assert(typeof old.reAuditedAt === "number", "old finding must have reAuditedAt set after re-audit");
}});
