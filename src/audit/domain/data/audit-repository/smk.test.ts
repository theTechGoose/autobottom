/** Smoke tests for audit repository — uses in-memory Deno KV. */

import { assertEquals, assert } from "#assert";
import {
  getFinding, saveFinding, getJob, saveJob,
  claimAuditDedup,
  saveBatchAnswers, getAllBatchAnswers, getAllAnswersForFinding,
  savePopulatedQuestions, getPopulatedQuestions,
  cacheAnswer, getCachedAnswer, cacheQuestions, getCachedQuestions, getLastGoodQuestions,
  saveTranscript, getTranscript,
  clearFindingRunState,
} from "./mod.ts";

const kvOpts = { sanitizeResources: false, sanitizeOps: false };
const ORG = "test-org-" + crypto.randomUUID().slice(0, 8);

Deno.test({ name: "finding — save and retrieve (chunked)", ...kvOpts, fn: async () => {
  const finding = { id: "f-1", findingStatus: "pending", record: { RecordId: "123" } };
  await saveFinding(ORG, finding);
  const result = await getFinding(ORG, "f-1");
  assert(result !== null);
  assertEquals(result!.id, "f-1");
  assertEquals(result!.findingStatus, "pending");
}});

Deno.test({ name: "finding — returns null for missing", ...kvOpts, fn: async () => {
  assertEquals(await getFinding(ORG, "nonexistent"), null);
}});

// Key-schema invariant: every writer in the codebase MUST go through saveFinding
// from this repository so the doc shape matches what getFinding reads. The
// audit entrypoint, judge appeal flow, and review correction flow all import
// saveFinding directly — this test verifies the round-trip.
Deno.test({ name: "finding — round-trips via the saveFinding writer (no key-schema drift)", ...kvOpts, fn: async () => {
  const finding = { id: "cross-path", findingStatus: "pending", record: { RecordId: "777" } };
  await saveFinding(ORG, finding);
  const result = await getFinding(ORG, "cross-path");
  assert(result !== null, "getFinding must read findings written by saveFinding");
  assertEquals(result!.id, "cross-path");
}});

Deno.test({ name: "job — save and retrieve", ...kvOpts, fn: async () => {
  const job = { id: "j-1", status: "running", doneAuditIds: [] };
  await saveJob(ORG, job);
  const result = await getJob(ORG, "j-1");
  assert(result !== null);
  assertEquals(result!.status, "running");
}});

Deno.test({ name: "dedup — first claim succeeds, second fails", ...kvOpts, fn: async () => {
  const rid = "dedup-" + Date.now();
  const first = await claimAuditDedup(ORG, rid);
  assertEquals(first, true);
  const second = await claimAuditDedup(ORG, rid);
  assertEquals(second, false);
}});

Deno.test({ name: "batch answers — save and retrieve all", ...kvOpts, fn: async () => {
  await saveBatchAnswers(ORG, "f-batch", 0, [{ q: "Q1", answer: "Yes" }]);
  await saveBatchAnswers(ORG, "f-batch", 1, [{ q: "Q2", answer: "No" }]);
  const all = await getAllBatchAnswers(ORG, "f-batch", 2);
  assertEquals(all.length, 2);
  assertEquals(all[0].answer, "Yes");
  assertEquals(all[1].answer, "No");
}});

Deno.test({ name: "batch answers — getAllAnswersForFinding stops at null", ...kvOpts, fn: async () => {
  await saveBatchAnswers(ORG, "f-auto", 0, [{ q: "A" }, { q: "B" }]);
  const all = await getAllAnswersForFinding(ORG, "f-auto");
  assertEquals(all.length, 2);
}});

Deno.test({ name: "populated questions — save and retrieve (chunked)", ...kvOpts, fn: async () => {
  const qs = [{ header: "Q1", populated: "P1" }, { header: "Q2", populated: "P2" }];
  await savePopulatedQuestions(ORG, "f-pop", qs);
  const result = await getPopulatedQuestions(ORG, "f-pop");
  assert(result !== null);
  assertEquals(result!.length, 2);
}});

Deno.test({ name: "answer cache — cache and retrieve", ...kvOpts, fn: async () => {
  const answer = { answer: "Yes", thinking: "because", defense: "quote" };
  await cacheAnswer(ORG, "f-cache", "Is the sky blue?", answer);
  const result = await getCachedAnswer(ORG, "f-cache", "Is the sky blue?");
  assert(result !== null);
  assertEquals(result!.answer, "Yes");
}});

Deno.test({ name: "answer cache — different question returns null", ...kvOpts, fn: async () => {
  assertEquals(await getCachedAnswer(ORG, "f-cache", "Different question"), null);
}});

Deno.test({ name: "question cache — cache and retrieve (chunked)", ...kvOpts, fn: async () => {
  const qs = [{ header: "H1" }, { header: "H2" }];
  await cacheQuestions(ORG, "dest-1", qs);
  const result = await getCachedQuestions(ORG, "dest-1");
  assert(result !== null);
  assertEquals(result!.length, 2);
}});

Deno.test({ name: "question cache — cacheQuestions also writes a durable last-known-good copy", ...kvOpts, fn: async () => {
  const dest = "dest-lkg-" + crypto.randomUUID().slice(0, 8);
  assertEquals(await getLastGoodQuestions(ORG, dest), null, "no last-good before any successful fetch");
  const qs = [{ header: "H1" }, { header: "H2" }, { header: "H3" }];
  await cacheQuestions(ORG, dest, qs);
  const lkg = await getLastGoodQuestions(ORG, dest);
  assert(lkg !== null, "last-good must be written alongside the fresh cache");
  assertEquals(lkg!.length, 3);
  assertEquals(lkg!.map((q: { header: string }) => q.header), ["H1", "H2", "H3"]);
}});

Deno.test({ name: "transcript — save and retrieve", ...kvOpts, fn: async () => {
  await saveTranscript(ORG, "f-tx", "raw text", "diarized text", [100, 200, 300]);
  const result = await getTranscript(ORG, "f-tx");
  assert(result !== null);
  assertEquals(result!.raw, "raw text");
  assertEquals(result!.diarized, "diarized text");
  assertEquals(result!.utteranceTimes?.length, 3);
}});

Deno.test({ name: "transcript — save preserves existing diarized", ...kvOpts, fn: async () => {
  await saveTranscript(ORG, "f-tx2", "raw1", "dia1");
  await saveTranscript(ORG, "f-tx2", "raw2"); // no diarized
  const result = await getTranscript(ORG, "f-tx2");
  assertEquals(result!.raw, "raw2");
  assertEquals(result!.diarized, "dia1"); // preserved from first save
}});

// ── clearFindingRunState ────────────────────────────────────────────────────
// Regression: re-running an audit that finished as "Invalid Genie" was a
// silent no-op. reset-finding drained the derived stores but left the finding
// doc alone, so the stale rawTranscript sentinel survived — step-transcribe's
// `if (finding.rawTranscript) → skip` never called AssemblyAI, transcribe-cb
// and prepare both bailed on the same string, and finalize re-wrote the same
// 0% result even though step-init had downloaded the recording fine.

/** A finding shaped like one that finalized as Invalid Genie. */
function invalidGenieFinding(id: string): Record<string, unknown> {
  return {
    id,
    findingStatus: "finished",
    rawTranscript: "Invalid Genie",
    diarizedTranscript: "Invalid Genie",
    utteranceTimes: [0, 100],
    populatedQuestions: [],
    unpopulatedQuestions: [],
    answeredQuestions: [{ header: "Q1", answer: "No" }],
    feedback: { heading: "Audit Failed", text: "could not be located" },
    completedAt: 1_700_000_000_000,
    reviewScore: 0,
    assemblyAiUploadUrl: "https://cdn.assemblyai.com/upload/stale",
    assemblyAiTranscriptId: "tx-stale",
    assemblyAiSubmittedAt: 1_700_000_000_000,
    genieAttempts: 4,
    genieRetryAt: 1_700_000_600_000,
    // Inputs the re-run rebuilds *from* — must survive.
    record: { RecordId: "493900" },
    recordingId: "27624059",
    auditJobId: "job-1",
    owner: "agent@example.com",
    // Recording fields deliberately kept so the report's audio player still
    // works while the re-run is in flight; step-init overwrites them anyway.
    s3RecordingKey: "recordings/job-1/27624059.mp3",
    recordingPath: "recordings/job-1/27624059.mp3",
  };
}

Deno.test({ name: "clearFindingRunState — drops the stale Invalid Genie transcript that made re-runs no-op", ...kvOpts, fn: async () => {
  await saveFinding(ORG, invalidGenieFinding("f-clear-1"));
  assertEquals(await clearFindingRunState(ORG, "f-clear-1"), true);
  const after = await getFinding(ORG, "f-clear-1");
  assert(after !== null);
  // The exact condition step-transcribe/mod.ts:51 guards on.
  assertEquals(after!.rawTranscript, undefined, "stale sentinel must be gone or transcribe skips again");
  // And the one that left a re-run with zero download retries.
  assertEquals(after!.genieAttempts, undefined);
  assertEquals(after!.genieRetryAt, undefined);
  assertEquals(after!.findingStatus, "pending");
}});

Deno.test({ name: "clearFindingRunState — clears every field the pipeline writes", ...kvOpts, fn: async () => {
  await saveFinding(ORG, invalidGenieFinding("f-clear-2"));
  await clearFindingRunState(ORG, "f-clear-2");
  const after = (await getFinding(ORG, "f-clear-2"))!;
  for (
    const field of [
      "diarizedTranscript", "utteranceTimes",
      "populatedQuestions", "unpopulatedQuestions", "answeredQuestions",
      "feedback", "completedAt", "reviewScore",
      "assemblyAiUploadUrl", "assemblyAiTranscriptId", "assemblyAiSubmittedAt",
    ]
  ) {
    assertEquals(after[field], undefined, `${field} must be cleared before a re-run`);
  }
}});

Deno.test({ name: "clearFindingRunState — keeps the inputs the re-run rebuilds from", ...kvOpts, fn: async () => {
  await saveFinding(ORG, invalidGenieFinding("f-clear-3"));
  await clearFindingRunState(ORG, "f-clear-3");
  const after = (await getFinding(ORG, "f-clear-3"))!;
  assertEquals(after.id, "f-clear-3");
  assertEquals((after.record as { RecordId: string }).RecordId, "493900");
  assertEquals(after.recordingId, "27624059");
  assertEquals(after.auditJobId, "job-1");
  assertEquals(after.owner, "agent@example.com");
  // Kept on purpose — the report page's audio keeps playing mid-re-run.
  assertEquals(after.s3RecordingKey, "recordings/job-1/27624059.mp3");
  assertEquals(after.recordingPath, "recordings/job-1/27624059.mp3");
}});

Deno.test({ name: "clearFindingRunState — drops the transcript row so diarize can't inherit stale text", ...kvOpts, fn: async () => {
  await saveFinding(ORG, invalidGenieFinding("f-clear-4"));
  await saveTranscript(ORG, "f-clear-4", "old raw", "old diarized");
  await clearFindingRunState(ORG, "f-clear-4");
  assertEquals(await getTranscript(ORG, "f-clear-4"), null, "saveTranscript merges, so a stale diarized would survive");
}});

Deno.test({ name: "clearFindingRunState — idempotent, and false for a missing finding", ...kvOpts, fn: async () => {
  await saveFinding(ORG, invalidGenieFinding("f-clear-5"));
  await clearFindingRunState(ORG, "f-clear-5");
  assertEquals(await clearFindingRunState(ORG, "f-clear-5"), true, "second pass is a safe no-op");
  assertEquals((await getFinding(ORG, "f-clear-5"))!.findingStatus, "pending");
  assertEquals(await clearFindingRunState(ORG, "f-clear-missing"), false);
}});

Deno.test({ name: "clearFindingRunState — {skipGenieRetry:true} stamps the flag step-init reads", ...kvOpts, fn: async () => {
  await saveFinding(ORG, invalidGenieFinding("f-skip-1"));
  await clearFindingRunState(ORG, "f-skip-1", { skipGenieRetry: true });
  assertEquals((await getFinding(ORG, "f-skip-1"))!.skipGenieRetry, true);
}});

Deno.test({ name: "clearFindingRunState — default run CLEARS a prior skip flag (single-audit retries restored)", ...kvOpts, fn: async () => {
  // A bulk run stamped it; the single-audit re-run must not inherit one-shot behavior.
  await saveFinding(ORG, { ...invalidGenieFinding("f-skip-2"), skipGenieRetry: true });
  await clearFindingRunState(ORG, "f-skip-2");
  assertEquals((await getFinding(ORG, "f-skip-2"))!.skipGenieRetry, undefined);
}});
