/** Smoke tests for audit repository — uses in-memory Deno KV. */

import { assertEquals, assert } from "jsr:@std/assert";
import {
  getFinding, saveFinding, getJob, saveJob,
  claimAuditDedup, setBatchCounter, decrementBatchCounter,
  saveBatchAnswers, getAllBatchAnswers, getAllAnswersForFinding,
  savePopulatedQuestions, getPopulatedQuestions,
  cacheAnswer, getCachedAnswer, cacheQuestions, getCachedQuestions,
  saveTranscript, getTranscript,
} from "./mod.ts";

const kvOpts = { sanitizeResources: false, sanitizeOps: false };
const ORG = "test-org-audit";

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

Deno.test({ name: "batch counter — set and decrement", ...kvOpts, fn: async () => {
  await setBatchCounter(ORG, "f-counter", 3);
  assertEquals(await decrementBatchCounter(ORG, "f-counter"), 2);
  assertEquals(await decrementBatchCounter(ORG, "f-counter"), 1);
  assertEquals(await decrementBatchCounter(ORG, "f-counter"), 0);
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
