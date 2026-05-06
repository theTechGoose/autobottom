/** Smoke tests for stats repository — tracking, index, chargebacks, wire. */

import { assertEquals, assert } from "#assert";
import {
  trackActive, trackCompleted, trackError, clearErrors, trackRetry,
  writeAuditDoneIndex, queryAuditDoneIndex, findAuditsByRecordId,
  saveChargebackEntry, getChargebackEntry, getChargebackEntries, deleteChargebackEntry,
  saveWireDeductionEntry, getWireDeductionEntry, getWireDeductionEntries, deleteWireDeductionEntry,
  getStats, terminateFinding, terminateAllActive,
} from "./mod.ts";
import type { AuditDoneIndexEntry, ChargebackEntry, WireDeductionEntry } from "@core/dto/types.ts";

const kvOpts = { sanitizeResources: false, sanitizeOps: false };
const ORG = "test-org-" + crypto.randomUUID().slice(0, 8);

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
  await writeAuditDoneIndex(ORG, { findingId: "f-idx-r1", completedAt: 2000000, score: 90, completed: true, recordId: "REC-1" });
  await writeAuditDoneIndex(ORG, { findingId: "f-idx-r2", completedAt: 2000001, score: 70, completed: true, recordId: "REC-1" });
  const results = await findAuditsByRecordId(ORG, "REC-1");
  assertEquals(results.length, 2);
  assertEquals(results[0].completedAt, 2000001); // newest first
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
