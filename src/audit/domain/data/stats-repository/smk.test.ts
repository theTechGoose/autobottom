/** Smoke tests for stats repository — tracking, index, chargebacks, wire. */

import { assertEquals, assert } from "jsr:@std/assert";
import {
  trackActive, trackCompleted, trackError, clearErrors, trackRetry,
  writeAuditDoneIndex, queryAuditDoneIndex, findAuditsByRecordId,
  saveChargebackEntry, getChargebackEntry, getChargebackEntries, deleteChargebackEntry,
  saveWireDeductionEntry, getWireDeductionEntry, getWireDeductionEntries, deleteWireDeductionEntry,
  getStats,
} from "./mod.ts";
import type { AuditDoneIndexEntry, ChargebackEntry, WireDeductionEntry } from "@core/dto/types.ts";

const kvOpts = { sanitizeResources: false, sanitizeOps: false };
const ORG = "test-org-stats";

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
