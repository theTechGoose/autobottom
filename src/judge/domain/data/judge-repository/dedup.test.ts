/** End-to-end test for the dedup delete path using the in-memory Firestore
 *  fallback. Exercises bulkDeleteFindings (via the public deleteDuplicates
 *  entrypoint) plus the findDuplicates → deleteDuplicates pipeline.
 *
 *  Forces in-mem mode via resetFirestoreCredentials() so no real Firestore
 *  is involved. This test exists because dedup has failed three different
 *  ways in production and the user (correctly) demanded a local proof
 *  before any further pushes. */

import { assert, assertEquals, assertExists } from "#assert";
import {
  resetFirestoreCredentials,
  setStored, setStoredChunked,
  getStored, getStoredChunked,
  encodeDocId,
} from "@core/data/firestore/mod.ts";
import { writeAuditDoneIndex } from "@audit/domain/data/stats-repository/mod.ts";
import { saveFinding } from "@audit/domain/data/audit-repository/mod.ts";
import {
  findDuplicates,
  deleteDuplicates,
  type DedupPlan,
} from "./mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

const ORG = "test-org" as OrgId;

function padTs(ts: number): string {
  return String(ts).padStart(15, "0");
}

/** Tiny utility — assert a doc is gone from in-mem store. */
async function assertGone(type: string, org: string, ...keyParts: (string | number)[]) {
  const v = await getStored(type, org, ...keyParts);
  assertEquals(v, null, `expected ${encodeDocId(type, org, ...keyParts)} to be deleted, was: ${JSON.stringify(v)?.slice(0, 80)}`);
}

async function assertExistsDoc(type: string, org: string, ...keyParts: (string | number)[]) {
  const v = await getStored(type, org, ...keyParts);
  assertExists(v, `expected ${encodeDocId(type, org, ...keyParts)} to still exist`);
}

Deno.test("dedup — single small (non-chunked) audit-finding is deleted", async () => {
  resetFirestoreCredentials();
  const findingId = "fid-small-1";
  const ts = 1_700_000_000_000;
  // setStored (not Chunked) — small body, no chunks
  await setStored("audit-finding", ORG, [findingId], { id: findingId, body: "small" });

  const plan: DedupPlan = {
    scanned: 1, groups: 1, orphaned: 0,
    toDelete: [{ id: findingId, recordKey: "rec-1", ts, reviewed: false, keep: false }],
  };
  await deleteDuplicates(ORG, plan);

  await assertGone("audit-finding", ORG, findingId);
});

Deno.test("dedup — chunked audit-finding: header AND every chunk is deleted", async () => {
  resetFirestoreCredentials();
  const findingId = "fid-chunked-1";
  const ts = 1_700_000_000_000;
  // Force chunking by writing a value larger than CHUNK_BYTES.
  // setStoredChunked splits when JSON.stringify(value).length > CHUNK_BYTES.
  // CHUNK_BYTES is internal but ~512KB; write 2MB to guarantee multiple chunks.
  const big = "x".repeat(2_000_000);
  await setStoredChunked("audit-finding", ORG, [findingId], { id: findingId, body: big });

  // Sanity check: getStoredChunked should return the full reconstructed value
  // before deletion, and the header should report totalChunks.
  const before = await getStored<{ totalChunks?: number }>("audit-finding", ORG, findingId);
  assert(before && typeof before.totalChunks === "number" && before.totalChunks > 1,
    `precondition: expected chunked finding, got ${JSON.stringify(before)?.slice(0, 100)}`);
  const totalChunks = before.totalChunks;

  const plan: DedupPlan = {
    scanned: 1, groups: 1, orphaned: 0,
    toDelete: [{ id: findingId, recordKey: "rec-1", ts, reviewed: false, keep: false }],
  };
  await deleteDuplicates(ORG, plan);

  // Header gone
  await assertGone("audit-finding", ORG, findingId);
  // Every chunk gone
  for (let i = 0; i < totalChunks; i++) {
    await assertGone("audit-finding", ORG, findingId, `chunk_${i}`);
  }
  // Reconstruction now yields null
  const after = await getStoredChunked("audit-finding", ORG, findingId);
  assertEquals(after, null);
});

Deno.test("dedup — multiple findings, only targeted ones deleted (others intact)", async () => {
  resetFirestoreCredentials();
  const tsA = 1_700_000_000_000;
  const tsB = 1_700_000_001_000;
  const tsC = 1_700_000_002_000;
  const big = "x".repeat(2_000_000);

  await setStoredChunked("audit-finding", ORG, ["fid-A"], { id: "fid-A", body: big });
  await setStoredChunked("audit-finding", ORG, ["fid-B"], { id: "fid-B", body: big });
  await setStoredChunked("audit-finding", ORG, ["fid-C"], { id: "fid-C", body: big });

  const plan: DedupPlan = {
    scanned: 3, groups: 0, orphaned: 0,
    toDelete: [
      { id: "fid-A", recordKey: "ka", ts: tsA, reviewed: false, keep: false },
      { id: "fid-C", recordKey: "kc", ts: tsC, reviewed: false, keep: false },
    ],
  };
  await deleteDuplicates(ORG, plan);

  await assertGone("audit-finding", ORG, "fid-A");
  await assertExistsDoc("audit-finding", ORG, "fid-B");
  await assertGone("audit-finding", ORG, "fid-C");
  // B's chunks must still be intact — sanity
  const bAfter = await getStoredChunked<{ id: string }>("audit-finding", ORG, "fid-B");
  assertExists(bAfter);
  assertEquals(bAfter?.id, "fid-B");
});

Deno.test("dedup — all cross-table singletons cleaned for a deleted finding", async () => {
  resetFirestoreCredentials();
  const findingId = "fid-x";
  const ts = 1_700_000_000_000;

  // Finding doc
  await setStored("audit-finding", ORG, [findingId], { id: findingId });

  // Singletons that bulkDeleteFindings blind-adds for every loser
  await setStored("review-audit-pending", ORG, [findingId], { findingId });
  await setStored("review-done", ORG, [findingId], { findingId, reviewedAt: new Date(ts).toISOString() });
  await setStored("active-tracking", ORG, [findingId], { findingId });
  await setStored("chargeback-entry", ORG, [findingId], { findingId, ts });
  await setStored("wire-deduction-entry", ORG, [findingId], { findingId, ts });

  // audit-done-idx is keyed [paddedTs, findingId] — bulkDeleteFindings
  // computes this directly from plan.ts.
  await writeAuditDoneIndex(ORG, {
    findingId, completedAt: ts, completed: true, score: 100, recordId: "rec-x",
  });
  // Sanity: writeAuditDoneIndex used the padded-ts key shape we'll target.
  await assertExistsDoc("audit-done-idx", ORG, padTs(ts), findingId);

  const plan: DedupPlan = {
    scanned: 1, groups: 1, orphaned: 0,
    toDelete: [{ id: findingId, recordKey: "rec-x", ts, reviewed: false, keep: false }],
  };
  await deleteDuplicates(ORG, plan);

  await assertGone("audit-finding", ORG, findingId);
  await assertGone("review-audit-pending", ORG, findingId);
  await assertGone("review-done", ORG, findingId);
  await assertGone("active-tracking", ORG, findingId);
  await assertGone("chargeback-entry", ORG, findingId);
  await assertGone("wire-deduction-entry", ORG, findingId);
  await assertGone("audit-done-idx", ORG, padTs(ts), findingId);
});

Deno.test("dedup — full pipeline: reviewed copy survives, unreviewed dup is deleted", async () => {
  resetFirestoreCredentials();
  const recordId = "rec-shared";
  // Two findings with the same RecordId, one reviewed, one not.
  // Reviewed one is OLDER — the keep rule is reviewed > unreviewed first,
  // then most-recent ts. Reviewed should still win regardless of ts.
  const olderReviewedTs = 1_700_000_000_000;
  const newerUnreviewedTs = 1_700_000_500_000;

  await saveFinding(ORG, { id: "fid-reviewed-old", record: { RecordId: recordId } });
  await saveFinding(ORG, { id: "fid-unreviewed-new", record: { RecordId: recordId } });

  // Index entries — recordId set so findDuplicates uses the fast path.
  await writeAuditDoneIndex(ORG, {
    findingId: "fid-reviewed-old", completedAt: olderReviewedTs,
    completed: true, score: 90, recordId, reason: "reviewed",
  });
  await writeAuditDoneIndex(ORG, {
    findingId: "fid-unreviewed-new", completedAt: newerUnreviewedTs,
    completed: true, score: 80, recordId, reason: "perfect_score",
  });

  const plan = await findDuplicates(
    ORG,
    olderReviewedTs - 1,
    newerUnreviewedTs + 1,
  );
  assertEquals(plan.groups, 1, `expected 1 dup group, got ${plan.groups}`);
  const losers = plan.toDelete.filter((d) => !d.keep).map((d) => d.id);
  const keepers = plan.toDelete.filter((d) => d.keep).map((d) => d.id);
  assertEquals(keepers, ["fid-reviewed-old"], `expected reviewed copy to be kept, plan.toDelete=${JSON.stringify(plan.toDelete)}`);
  assertEquals(losers, ["fid-unreviewed-new"], `expected unreviewed copy to be deleted`);

  await deleteDuplicates(ORG, plan);

  await assertExistsDoc("audit-finding", ORG, "fid-reviewed-old");
  await assertGone("audit-finding", ORG, "fid-unreviewed-new");
  // Index entries: reviewed kept, unreviewed gone
  await assertExistsDoc("audit-done-idx", ORG, padTs(olderReviewedTs), "fid-reviewed-old");
  await assertGone("audit-done-idx", ORG, padTs(newerUnreviewedTs), "fid-unreviewed-new");
});

Deno.test("dedup — idempotent: second run on already-deleted plan is a no-op", async () => {
  resetFirestoreCredentials();
  const findingId = "fid-idem";
  const ts = 1_700_000_000_000;
  await setStored("audit-finding", ORG, [findingId], { id: findingId });

  const plan: DedupPlan = {
    scanned: 1, groups: 1, orphaned: 0,
    toDelete: [{ id: findingId, recordKey: "rec", ts, reviewed: false, keep: false }],
  };
  await deleteDuplicates(ORG, plan);
  await assertGone("audit-finding", ORG, findingId);

  // Second call must not throw and the doc stays gone.
  await deleteDuplicates(ORG, plan);
  await assertGone("audit-finding", ORG, findingId);
});
