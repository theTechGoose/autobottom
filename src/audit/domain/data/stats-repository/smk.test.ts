/** Smoke tests for stats repository — tracking, index, chargebacks, wire. */

import { assertEquals, assert } from "#assert";
import {
  trackActive, trackCompleted, trackError, clearErrors, trackRetry,
  writeAuditDoneIndex, queryAuditDoneIndex, findAuditsByRecordId,
  saveChargebackEntry, getChargebackEntry, getChargebackEntries, deleteChargebackEntry,
  saveWireDeductionEntry, getWireDeductionEntry, getWireDeductionEntries, deleteWireDeductionEntry,
  getStats, terminateFinding, terminateAllActive,
  getErrorsInWindow, isFindingRecovered, redactErrorMessage,
  deriveQbRecordId, inspectRecordIndex, repairRecordIndexForFinding, restoreHiddenFinding,
  markFindingHidden, getHiddenFindingIds, _resetHiddenCacheForTesting,
} from "./mod.ts";
import { saveFinding } from "@audit/domain/data/audit-repository/mod.ts";
import type { AuditDoneIndexEntry, ChargebackEntry, WireDeductionEntry } from "@core/dto/types.ts";

const kvOpts = { sanitizeResources: false, sanitizeOps: false };
const ORG = "test-org-" + crypto.randomUUID().slice(0, 8);

Deno.test("redactErrorMessage — strips signed-URL query strings and tokens", () => {
  // The realistic genie/AssemblyAI case: a Deno fetch error embeds the signed URL.
  assertEquals(
    redactErrorMessage("error sending request for url (https://rec.example.com/audio.mp3?token=abc123&sig=deadbeef): timed out"),
    "error sending request for url (https://rec.example.com/audio.mp3?<redacted>): timed out",
  );
  // Bearer tokens and bare JWTs are scrubbed too.
  assertEquals(redactErrorMessage("auth failed: Bearer sk-live-abc.def_ghi"), "auth failed: Bearer <redacted>");
  assert(redactErrorMessage("token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9").includes("<redacted-jwt>"));
  // Every query string in a multi-URL message is scrubbed (pins the /g flag),
  // and the non-greedy match stops at whitespace so the first URL can't swallow
  // the second.
  assertEquals(
    redactErrorMessage("primary https://a.example/x.mp3?token=AAA failed, retry https://b.example/y.mp3?sig=BBB also failed"),
    "primary https://a.example/x.mp3?<redacted> failed, retry https://b.example/y.mp3?<redacted> also failed",
  );
  // Basic-auth userinfo is stripped too.
  assertEquals(redactErrorMessage("connect https://user:pass@host/file failed"), "connect https://<redacted>@host/file failed");
  // Plain messages with no secrets pass through untouched.
  assertEquals(redactErrorMessage("DEAD_URL: file is 5530 bytes"), "DEAD_URL: file is 5530 bytes");
});

Deno.test({ name: "trackError — same-finding distinct steps both persist (no key collision)", ...kvOpts, fn: async () => {
  const org = "test-track-collide-" + crypto.randomUUID().slice(0, 8);
  await clearErrors(org);
  // Two distinct steps for one finding — the genie primary+secondary cascade.
  // The write key includes step, so neither overwrites the other even back-to-back.
  await trackError(org, "f-collide", "genie:download:primary", "primary dead");
  await trackError(org, "f-collide", "genie:download:secondary", "secondary dead");
  const rows = await getErrorsInWindow(org, 0, Date.now() + 1000);
  const mine = rows.filter((r) => r.findingId === "f-collide");
  assertEquals(mine.length, 2, "both role failures stored under distinct keys");
}});

Deno.test({ name: "tracking — active → completed lifecycle", ...kvOpts, fn: async () => {
  await trackActive(ORG, "f-track-1", "transcribe");
  const stats1 = await getStats(ORG);
  assert(stats1.active.some((a: any) => a.findingId === "f-track-1"));

  await trackCompleted(ORG, "f-track-1", { score: 85 });
  const stats2 = await getStats(ORG);
  assert(!stats2.active.some((a: any) => a.findingId === "f-track-1"));
  assert(stats2.completedCount > 0);
}});

Deno.test({ name: "errors — track and clear", ...kvOpts, fn: async () => {
  await trackError(ORG, "f-err", "finalize", "boom");
  const stats = await getStats(ORG);
  assert(stats.errors.some((e: any) => e.findingId === "f-err"));
  const cleared = await clearErrors(ORG);
  assert(cleared > 0);
}});

Deno.test({ name: "retry — track", ...kvOpts, fn: async () => {
  await trackRetry(ORG, "f-retry", "transcribe", 2);
  const stats = await getStats(ORG);
  assert(stats.retries.some((r: any) => r.findingId === "f-retry"));
}});

Deno.test({ name: "terminateFinding — evicts active-tracking for that finding only", ...kvOpts, fn: async () => {
  const ORG_T = "test-term-" + crypto.randomUUID().slice(0, 8);
  await trackActive(ORG_T, "f-term-keep", "transcribe");
  await trackActive(ORG_T, "f-term-drop", "finalize");
  await terminateFinding(ORG_T, "f-term-drop");
  const stats = await getStats(ORG_T);
  const ids = stats.active.map((a: any) => a.findingId);
  assert(ids.includes("f-term-keep"), "kept finding must remain active");
  assert(!ids.includes("f-term-drop"), "terminated finding must be evicted");
}});

Deno.test({ name: "terminateAllActive — evicts every active-tracking entry for org", ...kvOpts, fn: async () => {
  const ORG_T = "test-term-all-" + crypto.randomUUID().slice(0, 8);
  await trackActive(ORG_T, "f-1", "transcribe");
  await trackActive(ORG_T, "f-2", "finalize");
  await trackActive(ORG_T, "f-3", "ask-all");
  const before = await getStats(ORG_T);
  assertEquals(before.active.length, 3, "precondition: 3 active");
  const count = await terminateAllActive(ORG_T);
  assertEquals(count, 3, "terminateAllActive must report 3 evicted");
  const after = await getStats(ORG_T);
  assertEquals(after.active.length, 0, "all active entries must be gone");
}});

Deno.test({ name: "terminateAllActive — does NOT evict other orgs' entries", ...kvOpts, fn: async () => {
  const ORG_A = "test-term-iso-a-" + crypto.randomUUID().slice(0, 8);
  const ORG_B = "test-term-iso-b-" + crypto.randomUUID().slice(0, 8);
  await trackActive(ORG_A, "f-a", "transcribe");
  await trackActive(ORG_B, "f-b", "transcribe");
  await terminateAllActive(ORG_A);
  const statsA = await getStats(ORG_A);
  const statsB = await getStats(ORG_B);
  assertEquals(statsA.active.length, 0, "ORG_A must be empty after terminate");
  assert(statsB.active.some((a: any) => a.findingId === "f-b"), "ORG_B must be untouched");
}});

Deno.test({ name: "audit-done-idx — write and query by range", ...kvOpts, fn: async () => {
  const entry: AuditDoneIndexEntry = {
    findingId: "f-idx-1", completedAt: 1000000, score: 80, completed: true, recordId: "r1",
  };
  await writeAuditDoneIndex(ORG, entry);
  const results = await queryAuditDoneIndex(ORG, 999999, 1000001);
  assert(results.some((e) => e.findingId === "f-idx-1"));
}});

Deno.test({ name: "audit-done-idx — findAuditsByRecordId", ...kvOpts, fn: async () => {
  // Use realistic recent timestamps — findAuditsByRecordId pages by completedAt
  // within the last 365 days to avoid 50k-doc abort timeouts.
  const now = Date.now();
  await writeAuditDoneIndex(ORG, { findingId: "f-idx-r1", completedAt: now - 1000, score: 90, completed: true, recordId: "REC-1" });
  await writeAuditDoneIndex(ORG, { findingId: "f-idx-r2", completedAt: now,        score: 70, completed: true, recordId: "REC-1" });
  const results = await findAuditsByRecordId(ORG, "REC-1");
  assertEquals(results.length, 2);
  assertEquals(results[0].completedAt, now); // newest first
}});

Deno.test({ name: "deriveQbRecordId — QB RecordId wins over RelatedDestinationId/GenieNumber", ...kvOpts, fn: () => {
  // The exact mis-key that hid review-completed date-legs: RecordId 478060 vs
  // RelatedDestinationId 261. Search is by RecordId, so RecordId must win.
  assertEquals(deriveQbRecordId({ record: { RecordId: 478060, RelatedDestinationId: 261, GenieNumber: 99 } }), "478060");
  assertEquals(deriveQbRecordId({ record: { RelatedDestinationId: 261 } }), undefined);
  assertEquals(deriveQbRecordId({ recordId: "top-level" }), "top-level");
  assertEquals(deriveQbRecordId({}), undefined);
  assertEquals(deriveQbRecordId(null), undefined);
}});

Deno.test({ name: "findAuditsByRecordId — number-typed recordId still matches the string search", ...kvOpts, fn: async () => {
  const now = Date.now();
  // Legacy/foreign writer stored recordId as a NUMBER; the form submits a string.
  await writeAuditDoneIndex(ORG, { findingId: "f-numkey", completedAt: now - 500, score: 88, completed: true, recordId: 909090 as any });
  const results = await findAuditsByRecordId(ORG, "909090");
  assert(results.some((e) => e.findingId === "f-numkey"), "string search must match number-typed stored recordId");
}});

Deno.test({ name: "findAuditsByRecordId — self-heals from completed-audit-stat into audit-done-idx", ...kvOpts, fn: async () => {
  const ORG_H = "test-heal-" + crypto.randomUUID().slice(0, 8);
  const fid = "f-heal-" + crypto.randomUUID().slice(0, 8);
  const rid = "REC-HEAL-" + crypto.randomUUID().slice(0, 6);
  const now = Date.now();
  // Finding finished and recorded in completed-audit-stat, but NO audit-done-idx
  // row (the guard-skip symptom). Search must still find it — then backfill.
  await saveFinding(ORG_H, { id: fid, findingStatus: "finished", record: { RecordId: rid }, completedAt: now - 1000 });
  await trackCompleted(ORG_H, fid, { recordId: rid, score: 77 }, { assumeFinished: true });

  const results = await findAuditsByRecordId(ORG_H, rid);
  assertEquals(results.length, 1, "fallback must surface the finding");
  assertEquals(results[0].findingId, fid);

  // Self-heal write is fire-and-forget — poll until the backfilled row lands
  // (returns on the first iteration normally; tolerates ~500ms under load
  // instead of flaking on a fixed sleep).
  let idx: AuditDoneIndexEntry[] = [];
  for (let i = 0; i < 50; i++) {
    idx = await queryAuditDoneIndex(ORG_H, now - 2000, now + 2000);
    if (idx.some((e) => e.findingId === fid && e.recordId === rid)) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert(idx.some((e) => e.findingId === fid && e.recordId === rid), "self-heal must backfill audit-done-idx");
}});

Deno.test({ name: "findAuditsByRecordId — dedup-hidden findings are surfaced flagged, not dropped", ...kvOpts, fn: async () => {
  const ORG_D = "test-dedup-" + crypto.randomUUID().slice(0, 8);
  const rid = "REC-DUP-" + crypto.randomUUID().slice(0, 6);
  const now = Date.now();
  await writeAuditDoneIndex(ORG_D, { findingId: "f-keep", completedAt: now, score: 95, completed: true, recordId: rid });
  await writeAuditDoneIndex(ORG_D, { findingId: "f-dup", completedAt: now - 1000, score: 80, completed: true, recordId: rid });
  await markFindingHidden(ORG_D, "f-dup", "dedup");
  _resetHiddenCacheForTesting();

  const results = await findAuditsByRecordId(ORG_D, rid);
  assertEquals(results.length, 2, "explicit record lookup must return BOTH the keeper and the deduped duplicate");
  assertEquals(results.find((e) => e.findingId === "f-keep")?.hidden, false);
  assertEquals(results.find((e) => e.findingId === "f-dup")?.hidden, true, "the deduped finding must be flagged hidden");
}});

Deno.test({ name: "writeAuditDoneIndex — guard skips unfinished, assumeFinished overrides", ...kvOpts, fn: async () => {
  const ORG_G = "test-guard-" + crypto.randomUUID().slice(0, 8);
  const fid = "f-guard-" + crypto.randomUUID().slice(0, 8);
  await saveFinding(ORG_G, { id: fid, findingStatus: "populating-questions" });
  const entry: AuditDoneIndexEntry = { findingId: fid, completedAt: Date.now(), score: 90, completed: true, recordId: "RG-1" };

  assertEquals(await writeAuditDoneIndex(ORG_G, entry), false, "must skip while not finished");
  assertEquals(await writeAuditDoneIndex(ORG_G, entry, { assumeFinished: true }), true, "assumeFinished must write anyway");

  // Happy path the flip/judge writers actually take: finding IS finished, no
  // override → returns true AND the row lands (guard falls through).
  const ORG_F = "test-guard-finished-" + crypto.randomUUID().slice(0, 8);
  const fid2 = "f-finished-" + crypto.randomUUID().slice(0, 8);
  const ts = Date.now();
  await saveFinding(ORG_F, { id: fid2, findingStatus: "finished" });
  const entry2: AuditDoneIndexEntry = { findingId: fid2, completedAt: ts, score: 100, completed: true, recordId: "RG-2" };
  assertEquals(await writeAuditDoneIndex(ORG_F, entry2), true, "finished finding writes without override");
  const idx = await queryAuditDoneIndex(ORG_F, ts - 1000, ts + 1000);
  assert(idx.some((e) => e.findingId === fid2), "returned true AND actually wrote the row");
}});

Deno.test({ name: "inspect + repair — re-asserts index rows for a finding missing from both", ...kvOpts, fn: async () => {
  const ORG_R = "test-repair-" + crypto.randomUUID().slice(0, 8);
  const fid = "f-repair-" + crypto.randomUUID().slice(0, 8);
  await saveFinding(ORG_R, {
    id: fid, findingStatus: "finished", completedAt: Date.now(),
    record: { RecordId: 333111, RelatedDestinationId: 261 },
    answeredQuestions: [{ answer: "Yes" }, { answer: "No" }],
  });

  const before = await inspectRecordIndex(ORG_R, fid);
  assertEquals(before.finding.derivedRecordId, "333111");
  assertEquals(before.doneIdxRows.length, 0, "no index row before repair");

  const result = await repairRecordIndexForFinding(ORG_R, fid);
  assertEquals(result.repaired, true);
  assertEquals(result.recordId, "333111");

  const after = await inspectRecordIndex(ORG_R, fid);
  assert(after.doneIdxRows.some((r) => String(r.recordId) === "333111"), "done-idx row present after repair");
  assert(after.completedStatRows.some((r) => String(r.recordId) === "333111"), "completed-stat row present after repair");
  // And it's now searchable.
  const found = await findAuditsByRecordId(ORG_R, "333111");
  assert(found.some((e) => e.findingId === fid));
}});

Deno.test({ name: "repairRecordIndexForFinding — does not duplicate an existing completed-audit-stat row", ...kvOpts, fn: async () => {
  const ORG_I = "test-repair-idem-" + crypto.randomUUID().slice(0, 8);
  const fid = "f-idem-" + crypto.randomUUID().slice(0, 8);
  const rid = "R-IDEM-" + crypto.randomUUID().slice(0, 6);
  await saveFinding(ORG_I, {
    id: fid, findingStatus: "finished", completedAt: Date.now(),
    record: { RecordId: rid }, answeredQuestions: [{ answer: "Yes" }],
  });
  // The finding already has a stat row (the common case — only audit-done-idx
  // was dropped). completed-audit-stat keys embed Date.now(), so a naive
  // trackCompleted would mint a second row and double-count it.
  await trackCompleted(ORG_I, fid, { recordId: rid, score: 100 }, { assumeFinished: true });
  await repairRecordIndexForFinding(ORG_I, fid);
  await repairRecordIndexForFinding(ORG_I, fid); // twice — still no dup

  const insp = await inspectRecordIndex(ORG_I, fid);
  assertEquals(insp.completedStatRows.length, 1, "repair must not append duplicate completed-audit-stat rows");
}});

Deno.test({ name: "restoreHiddenFinding — un-hides + re-indexes a wrongly-hidden finding", ...kvOpts, fn: async () => {
  const ORG_R = "test-restore-" + crypto.randomUUID().slice(0, 8);
  const fid = "f-restore-" + crypto.randomUUID().slice(0, 8);
  const rid = "R-RESTORE-" + crypto.randomUUID().slice(0, 6);
  await saveFinding(ORG_R, {
    id: fid, findingStatus: "finished", completedAt: Date.now(),
    record: { RecordId: rid }, answeredQuestions: [{ answer: "Yes" }],
  });
  await markFindingHidden(ORG_R, fid, "dedup");
  _resetHiddenCacheForTesting();

  const result = await restoreHiddenFinding(ORG_R, fid);
  assertEquals(result.ok, true);
  assertEquals(result.wasHidden, true);
  assertEquals(result.recordId, rid);
  _resetHiddenCacheForTesting();

  // No longer hidden, and now resolvable by record search.
  assert(!(await getHiddenFindingIds(ORG_R)).has(fid));
  const found = await findAuditsByRecordId(ORG_R, rid);
  assert(found.some((e) => e.findingId === fid), "restored finding must be searchable by record");
}});

Deno.test({ name: "chargeback — save, get, list, delete", ...kvOpts, fn: async () => {
  const cb: ChargebackEntry = { findingId: "f-cb-1", ts: 5000, voName: "Alice", destination: "CUN", revenue: "100", recordId: "r1", score: 60, failedQHeaders: ["Income"] };
  await saveChargebackEntry(ORG, cb);
  const got = await getChargebackEntry(ORG, "f-cb-1");
  assertEquals(got?.voName, "Alice");
  const list = await getChargebackEntries(ORG, 4000, 6000);
  assert(list.some((e) => e.findingId === "f-cb-1"));
  await deleteChargebackEntry(ORG, "f-cb-1");
  assertEquals(await getChargebackEntry(ORG, "f-cb-1"), null);
}});

Deno.test({ name: "wire — save, get, list, delete", ...kvOpts, fn: async () => {
  const w: WireDeductionEntry = { findingId: "f-w-1", ts: 7000, score: 80, questionsAudited: 10, totalSuccess: 8, recordId: "r1", office: "East", excellenceAuditor: "Bob", guestName: "Guest" };
  await saveWireDeductionEntry(ORG, w);
  const got = await getWireDeductionEntry(ORG, "f-w-1");
  assertEquals(got?.office, "East");
  const list = await getWireDeductionEntries(ORG, 6000, 8000);
  assert(list.some((e) => e.findingId === "f-w-1"));
  await deleteWireDeductionEntry(ORG, "f-w-1");
  assertEquals(await getWireDeductionEntry(ORG, "f-w-1"), null);
}});

// ── Error recovery classification ────────────────────────────────────────────
// A transient blip (e.g. an init-step Firestore abort) whose audit later
// FINISHED is "recovered" — not autobottom's fault — and must not trip the
// canary failure count. A finding still stuck at the failing step is a genuine
// fault. Each test uses a unique org so the tight ts window is fully isolated.

Deno.test({ name: "errors — finished finding classifies as recovered", ...kvOpts, fn: async () => {
  const ORG_R = "test-rec-" + crypto.randomUUID().slice(0, 8);
  const fid = "f-recovered-" + crypto.randomUUID().slice(0, 8);
  await saveFinding(ORG_R, { id: fid, findingStatus: "finished" });
  await trackError(ORG_R, fid, "init", "The signal has been aborted");
  const now = Date.now();
  const rows = await getErrorsInWindow(ORG_R, now - 5000, now + 5000, { includeRecovery: true });
  const row = rows.find((r) => r.findingId === fid);
  assert(row, "seeded error must be in window");
  assertEquals(row!.recovered, true, "finished finding → recovered");
}});

Deno.test({ name: "errors — stuck finding classifies as NOT recovered", ...kvOpts, fn: async () => {
  const ORG_S = "test-stuck-" + crypto.randomUUID().slice(0, 8);
  const fid = "f-stuck-" + crypto.randomUUID().slice(0, 8);
  await saveFinding(ORG_S, { id: fid, findingStatus: "getting-recording" });
  await trackError(ORG_S, fid, "init", "The signal has been aborted");
  const now = Date.now();
  const rows = await getErrorsInWindow(ORG_S, now - 5000, now + 5000, { includeRecovery: true });
  const row = rows.find((r) => r.findingId === fid);
  assert(row, "seeded error must be in window");
  assertEquals(row!.recovered, false, "still at getting-recording → not recovered");
}});

Deno.test({ name: "errors — terminated finding counts as recovered (deliberate stop)", ...kvOpts, fn: async () => {
  const ORG_T = "test-term-rec-" + crypto.randomUUID().slice(0, 8);
  const fid = "f-terminated-" + crypto.randomUUID().slice(0, 8);
  await saveFinding(ORG_T, { id: fid, findingStatus: "terminated" });
  await trackError(ORG_T, fid, "init", "The signal has been aborted");
  const now = Date.now();
  const rows = await getErrorsInWindow(ORG_T, now - 5000, now + 5000, { includeRecovery: true });
  assertEquals(rows.find((r) => r.findingId === fid)?.recovered, true);
}});

Deno.test({ name: "errors — recovery tag omitted unless includeRecovery is set", ...kvOpts, fn: async () => {
  const ORG_O = "test-norec-" + crypto.randomUUID().slice(0, 8);
  const fid = "f-norec-" + crypto.randomUUID().slice(0, 8);
  await saveFinding(ORG_O, { id: fid, findingStatus: "finished" });
  await trackError(ORG_O, fid, "init", "boom");
  const now = Date.now();
  const rows = await getErrorsInWindow(ORG_O, now - 5000, now + 5000);
  assertEquals(rows.find((r) => r.findingId === fid)?.recovered, undefined);
}});

Deno.test({ name: "isFindingRecovered — missing finding is not recovered (fail-safe)", ...kvOpts, fn: async () => {
  const ORG_M = "test-missing-" + crypto.randomUUID().slice(0, 8);
  assertEquals(await isFindingRecovered(ORG_M, "f-does-not-exist"), false);
}});

// getStats feeds the dashboard "Recent Errors (24h)" panel + the Errors stat
// card. It must tag each error row `recovered` so a finished audit (e.g. an
// ask-all:pinecone embed timeout that still delivered) isn't shown as a fault.
Deno.test({ name: "getStats — tags errors recovered (finished) vs not (stuck)", ...kvOpts, fn: async () => {
  const ORG_GS = "test-getstats-rec-" + crypto.randomUUID().slice(0, 8);
  const okFid = "f-gs-ok-" + crypto.randomUUID().slice(0, 8);
  const stuckFid = "f-gs-stuck-" + crypto.randomUUID().slice(0, 8);
  await saveFinding(ORG_GS, { id: okFid, findingStatus: "finished" });
  await saveFinding(ORG_GS, { id: stuckFid, findingStatus: "getting-recording" });
  await trackError(ORG_GS, okFid, "ask-all:pinecone", "OpenAI embed timed out after 30s");
  await trackError(ORG_GS, stuckFid, "init", "The signal has been aborted");
  const stats = await getStats(ORG_GS);
  const okRow = stats.errors.find((e) => (e as { findingId?: string }).findingId === okFid);
  const stuckRow = stats.errors.find((e) => (e as { findingId?: string }).findingId === stuckFid);
  assert(okRow && stuckRow, "both seeded errors present in getStats");
  assertEquals((okRow as { recovered?: boolean }).recovered, true, "finished finding → recovered");
  assertEquals((stuckRow as { recovered?: boolean }).recovered, false, "stuck finding → not recovered");
}});
