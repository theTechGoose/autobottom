/** Smoke tests for manager repository. */
import { assertEquals, assert } from "#assert";
import { populateManagerQueue, enqueueRemediationForFinding, getManagerQueue, submitRemediation, getManagerStats, clearManagerQueue, enrichManagerQueueBatch, filterQueueToManagerScope } from "./mod.ts";
import type { ManagerQueueItem } from "./mod.ts";
import { setStored, resetFirestoreCredentials } from "@core/data/firestore/mod.ts";
import { saveFinding } from "@audit/domain/data/audit-repository/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

const kvOpts = { sanitizeResources: false, sanitizeOps: false };
const ORG = "test-org-" + crypto.randomUUID().slice(0, 8);

/** Seed a manager-queue item dated `completedAt` plus its finding's dept/shift,
 *  so clearManagerQueue can resolve team scope + audit date. */
async function seedItem(
  org: OrgId,
  findingId: string,
  o: { completedAt: number; dept?: string; shift?: string; isPackage?: boolean },
): Promise<void> {
  await setStored("manager-queue", org, [findingId], {
    findingId, addedAt: o.completedAt, completedAt: o.completedAt, status: "pending",
  });
  await saveFinding(org, {
    id: findingId,
    recordingIdField: o.isPackage ? "GenieNumber" : "Recording",
    record: o.isPackage
      ? { OfficeName: o.dept ?? "", RecordId: 1 }
      : { ActivatingOffice: o.dept ?? "", Shift: o.shift ?? "", RecordId: 1 },
  });
}

const DAY = 86_400_000;

Deno.test({ name: "manager queue — populate and list", ...kvOpts, fn: async () => {
  await populateManagerQueue(ORG, "f-mgr-1");
  const queue = await getManagerQueue(ORG);
  assert(queue.some((i) => i.findingId === "f-mgr-1"));
}});

Deno.test({ name: "manager — remediate updates status", ...kvOpts, fn: async () => {
  await populateManagerQueue(ORG, "f-mgr-2");
  const { ok } = await submitRemediation(ORG, "f-mgr-2", "Fixed it", "manager@test.com");
  assertEquals(ok, true);
}});

Deno.test({ name: "manager stats — counts pending vs remediated", ...kvOpts, fn: async () => {
  const stats = await getManagerStats(ORG);
  assert(stats.total >= 2);
}});

// ── clearManagerQueue — data maintenance (clear by dept / shift / date) ───────

Deno.test({ name: "clearManagerQueue — refuses an unfiltered wipe", ...kvOpts, fn: async () => {
  resetFirestoreCredentials();
  const org = ("test-cq-empty-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  let threw = false;
  try { await clearManagerQueue(org, {}); } catch { threw = true; }
  assert(threw, "empty filter must throw, never clear everything");
}});

Deno.test({ name: "clearManagerQueue — by date range (no finding reads needed)", ...kvOpts, fn: async () => {
  resetFirestoreCredentials();
  const org = ("test-cq-date-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  const now = 1_700_000_000_000;
  await seedItem(org, "f-old", { completedAt: now - 10 * DAY });
  await seedItem(org, "f-mid", { completedAt: now - 5 * DAY });
  await seedItem(org, "f-new", { completedAt: now - 1 * DAY });
  // Window covers only f-mid (since inclusive, until exclusive).
  const res = await clearManagerQueue(org, { since: now - 6 * DAY, until: now - 2 * DAY });
  assertEquals(res.matched, 1);
  assertEquals(res.deleted, 1);
  const remaining = (await getManagerQueue(org)).map((i) => i.findingId).sort();
  assertEquals(remaining, ["f-new", "f-old"]);
}});

Deno.test({ name: "clearManagerQueue — by department only", ...kvOpts, fn: async () => {
  resetFirestoreCredentials();
  const org = ("test-cq-dept-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  const now = 1_700_000_000_000;
  await seedItem(org, "f-2nd-a", { completedAt: now, dept: "2ND", shift: "AM" });
  await seedItem(org, "f-2nd-b", { completedAt: now, dept: "2ND", shift: "PM" });
  await seedItem(org, "f-gsmb", { completedAt: now, dept: "GS MB", shift: "AM" });
  const res = await clearManagerQueue(org, { department: "2ND" });
  assertEquals(res.matched, 2);
  assertEquals(res.deleted, 2);
  assertEquals((await getManagerQueue(org)).map((i) => i.findingId), ["f-gsmb"]);
}});

Deno.test({ name: "clearManagerQueue — by department + shift combo", ...kvOpts, fn: async () => {
  resetFirestoreCredentials();
  const org = ("test-cq-combo-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  const now = 1_700_000_000_000;
  await seedItem(org, "f-2nd-am", { completedAt: now, dept: "2ND", shift: "AM" });
  await seedItem(org, "f-2nd-pm", { completedAt: now, dept: "2ND", shift: "PM" });
  await seedItem(org, "f-gsmb-am", { completedAt: now, dept: "GS MB", shift: "AM" });
  const res = await clearManagerQueue(org, { department: "2ND", shift: "AM" });
  assertEquals(res.matched, 1);
  assertEquals(res.sample[0].findingId, "f-2nd-am");
  const remaining = (await getManagerQueue(org)).map((i) => i.findingId).sort();
  assertEquals(remaining, ["f-2nd-pm", "f-gsmb-am"]);
}});

Deno.test({ name: "clearManagerQueue — dept + date range together", ...kvOpts, fn: async () => {
  resetFirestoreCredentials();
  const org = ("test-cq-deptdate-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  const now = 1_700_000_000_000;
  await seedItem(org, "f-2nd-old", { completedAt: now - 10 * DAY, dept: "2ND", shift: "AM" });
  await seedItem(org, "f-2nd-new", { completedAt: now - 1 * DAY, dept: "2ND", shift: "AM" });
  await seedItem(org, "f-gsmb-new", { completedAt: now - 1 * DAY, dept: "GS MB", shift: "AM" });
  // 2ND AND recent → only f-2nd-new.
  const res = await clearManagerQueue(org, { department: "2ND", since: now - 3 * DAY });
  assertEquals(res.matched, 1);
  assertEquals(res.sample[0].findingId, "f-2nd-new");
  assertEquals(res.sample[0].department, "2ND");
}});

Deno.test({ name: "clearManagerQueue — dryRun previews without deleting", ...kvOpts, fn: async () => {
  resetFirestoreCredentials();
  const org = ("test-cq-dry-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  const now = 1_700_000_000_000;
  await seedItem(org, "f-a", { completedAt: now, dept: "2ND", shift: "AM" });
  await seedItem(org, "f-b", { completedAt: now, dept: "2ND", shift: "PM" });
  const res = await clearManagerQueue(org, { department: "2ND" }, { dryRun: true });
  assertEquals(res.matched, 2);
  assertEquals(res.deleted, 0, "dry run must not delete");
  assertEquals(res.dryRun, true);
  assertEquals((await getManagerQueue(org)).length, 2, "queue untouched on dry run");
}});

Deno.test({ name: "clearManagerQueue — package items match by OfficeName as department", ...kvOpts, fn: async () => {
  resetFirestoreCredentials();
  const org = ("test-cq-pkg-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  const now = 1_700_000_000_000;
  await seedItem(org, "f-pkg", { completedAt: now, dept: "Orlando Office", isPackage: true });
  const res = await clearManagerQueue(org, { department: "Orlando Office" });
  assertEquals(res.matched, 1);
  assertEquals(res.deleted, 1);
}});

// ── Queue enrichment (voName + failed questions for the queue table) ─────────

Deno.test({ name: "populateManagerQueue — enriches from the finding (voName + failed questions)", ...kvOpts, fn: async () => {
  resetFirestoreCredentials();
  const org = ("test-enrich-pop-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  await saveFinding(org, {
    id: "f-rich",
    owner: "api",
    recordingId: "27501909",
    record: { VoName: "PUJ - Jane Doe", RecordId: 460304, ActivatingOffice: "PUJ", Shift: "AM" },
    answeredQuestions: [
      { header: "Greeted the guest", answer: "Yes" },
      { header: "Confirmed travel dates", answer: "No" },
      { header: "Mentioned resort fees", answer: "No" },
    ],
  });
  await populateManagerQueue(org, "f-rich");
  const [item] = await getManagerQueue(org);
  assertEquals(item.voName, "Jane Doe");
  assertEquals(item.failedQuestions, ["Confirmed travel dates", "Mentioned resort fees"]);
  assertEquals(item.failedCount, 2);
  assertEquals(item.totalQuestions, 3);
  assertEquals(item.recordId, "460304");
  assertEquals(item.department, "PUJ");
  assertEquals(item.shift, "AM");
  assertEquals(item.isPackage, false);
}});

Deno.test({ name: "populateManagerQueue — package finding stamps OfficeName as department, no shift", ...kvOpts, fn: async () => {
  resetFirestoreCredentials();
  const org = ("test-enrich-pkg-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  await saveFinding(org, {
    id: "f-pkg-stamp",
    recordingIdField: "GenieNumber",
    record: { VoName: "ORL - Pat Kim", RecordId: 7, OfficeName: "Orlando Office", Shift: "AM" },
    answeredQuestions: [],
  });
  await populateManagerQueue(org, "f-pkg-stamp");
  const [item] = await getManagerQueue(org);
  assertEquals(item.department, "Orlando Office");
  assertEquals(item.shift, "");
  assertEquals(item.isPackage, true);
}});

// ── enqueueRemediationForFinding — the live finalize hook ─────────────────────

Deno.test({ name: "enqueueRemediationForFinding — enqueues a confirmed-failure audit, stamps completedAt + jobTimestamp", ...kvOpts, fn: async () => {
  resetFirestoreCredentials();
  const org = ("test-enq-fail-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  await saveFinding(org, {
    id: "f-enq",
    owner: "api",
    record: { VoName: "PUJ - Jane Doe", RecordId: 1, ActivatingOffice: "PUJ", Shift: "AM" },
    answeredQuestions: [
      { header: "Greeted", answer: "Yes" },
      { header: "Confirmed dates", answer: "No" },
    ],
    job: { timestamp: "2026-07-01T10:00:00Z" },
  });
  const res = await enqueueRemediationForFinding(org, "f-enq", { completedAt: 1234 });
  assertEquals(res.enqueued, true);
  const [item] = await getManagerQueue(org);
  assertEquals(item.status, "pending");
  assertEquals(item.failedCount, 1);
  assertEquals(item.failedQuestions, ["Confirmed dates"]);
  assertEquals(item.completedAt, 1234);
  assertEquals(item.jobTimestamp, "2026-07-01T10:00:00Z");
}});

Deno.test({ name: "enqueueRemediationForFinding — no-op when the audit passed after review (no failures)", ...kvOpts, fn: async () => {
  resetFirestoreCredentials();
  const org = ("test-enq-pass-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  await saveFinding(org, {
    id: "f-pass",
    record: { RecordId: 1, ActivatingOffice: "PUJ", Shift: "AM" },
    answeredQuestions: [{ header: "Greeted", answer: "Yes" }],
  });
  const res = await enqueueRemediationForFinding(org, "f-pass");
  assertEquals(res.enqueued, false);
  assertEquals(res.reason, "no-failures");
  assertEquals((await getManagerQueue(org)).length, 0);
}});

Deno.test({ name: "enqueueRemediationForFinding — idempotent: never clobbers a finding already in the queue", ...kvOpts, fn: async () => {
  resetFirestoreCredentials();
  const org = ("test-enq-idem-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  await saveFinding(org, {
    id: "f-idem",
    record: { RecordId: 1, ActivatingOffice: "PUJ", Shift: "AM" },
    answeredQuestions: [{ header: "Q", answer: "No" }],
  });
  // Pre-seed as already remediated — re-finalize must not reset it to pending.
  await setStored("manager-queue", org, ["f-idem"], {
    findingId: "f-idem", addedAt: 1, status: "remediated", remediatedBy: "m@x.com", completedAt: 1,
  });
  const res = await enqueueRemediationForFinding(org, "f-idem");
  assertEquals(res.enqueued, false);
  assertEquals(res.reason, "already-queued");
  const [item] = await getManagerQueue(org);
  assertEquals(item.status, "remediated");
}});

Deno.test({ name: "enrichManagerQueueBatch — backfills stale items and marks missing findings checked", ...kvOpts, fn: async () => {
  resetFirestoreCredentials();
  const org = ("test-enrich-batch-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  // A legacy item that already carries voName (old write path) but no
  // failedQuestions — staleness must key off failedQuestions, not voName —
  // plus one whose finding is gone.
  await setStored("manager-queue", org, ["f-e1"], { findingId: "f-e1", addedAt: 1, status: "pending", owner: "api", voName: "Stale Cached" });
  await setStored("manager-queue", org, ["f-gone"], { findingId: "f-gone", addedAt: 2, status: "pending", owner: "api" });
  await saveFinding(org, {
    id: "f-e1",
    record: { VoName: "MBJ - John Smith", RecordId: 1 },
    answeredQuestions: [{ header: "Q1", answer: "No" }],
  });
  const n = await enrichManagerQueueBatch(org, await getManagerQueue(org), 10);
  assertEquals(n, 2);
  const after = await getManagerQueue(org);
  const e1 = after.find((i) => i.findingId === "f-e1")!;
  assertEquals(e1.voName, "John Smith");
  assertEquals(e1.failedQuestions, ["Q1"]);
  const gone = after.find((i) => i.findingId === "f-gone")!;
  assertEquals(gone.failedQuestions, [], "missing finding must be marked checked so it isn't retried forever");
  assertEquals(gone.department, "", "missing finding must get the empty department marker too");
  // Second pass: everything enriched — nothing left to do.
  assertEquals(await enrichManagerQueueBatch(org, await getManagerQueue(org), 10), 0);
}});

Deno.test({ name: "enrichManagerQueueBatch — re-enriches items missing only department (scoping backfill)", ...kvOpts, fn: async () => {
  resetFirestoreCredentials();
  const org = ("test-enrich-dept-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  // Fully enriched under the OLD marker (failedQuestions + wgs set) but no
  // department — must count as stale so scoping data converges.
  await setStored("manager-queue", org, ["f-d1"], {
    findingId: "f-d1", addedAt: 1, status: "pending", owner: "api",
    voName: "Old Enriched", failedQuestions: ["Q1"], wgs: false, mcc: false,
  });
  await saveFinding(org, {
    id: "f-d1",
    record: { VoName: "VBA - Old Enriched", RecordId: 2, ActivatingOffice: "VBA", Shift: "PM" },
    answeredQuestions: [{ header: "Q1", answer: "No" }],
  });
  assertEquals(await enrichManagerQueueBatch(org, await getManagerQueue(org), 10), 1);
  const [item] = await getManagerQueue(org);
  assertEquals(item.department, "VBA");
  assertEquals(item.shift, "PM");
  assertEquals(await enrichManagerQueueBatch(org, await getManagerQueue(org), 10), 0);
}});

// ── Scope filter (manager queue visibility) ───────────────────────────────────

const qi = (o: Partial<ManagerQueueItem>): ManagerQueueItem =>
  ({ findingId: "f", addedAt: 0, status: "pending", ...o });

Deno.test("filterQueueToManagerScope — department + shift scoping", () => {
  const items = [
    qi({ findingId: "vba-pm", department: "VBA", shift: "PM" }),
    qi({ findingId: "vba-am", department: "VBA", shift: "AM" }),
    qi({ findingId: "dsmb-am", department: "DS MB", shift: "AM" }),
  ];
  const out = filterQueueToManagerScope(items, { departments: ["VBA"], shifts: ["PM"] });
  assertEquals(out.map((i) => i.findingId), ["vba-pm"]);
});

Deno.test("filterQueueToManagerScope — unstamped items are hidden", () => {
  const items = [
    qi({ findingId: "stamped", department: "VBA", shift: "PM" }),
    qi({ findingId: "unstamped" }),
  ];
  const out = filterQueueToManagerScope(items, { departments: [], shifts: [] });
  assertEquals(out.map((i) => i.findingId), ["stamped"]);
});

Deno.test("filterQueueToManagerScope — packages skip the shift check", () => {
  const items = [
    qi({ findingId: "pkg", department: "VBA", shift: "", isPackage: true }),
    qi({ findingId: "leg-wrong-shift", department: "VBA", shift: "AM" }),
  ];
  const out = filterQueueToManagerScope(items, { departments: ["VBA"], shifts: ["PM"] });
  assertEquals(out.map((i) => i.findingId), ["pkg"]);
});

Deno.test("filterQueueToManagerScope — empty scope lists mean no restriction on that axis", () => {
  const items = [
    qi({ findingId: "a", department: "VBA", shift: "PM" }),
    qi({ findingId: "b", department: "DS MB", shift: "AM" }),
  ];
  const out = filterQueueToManagerScope(items, { departments: [], shifts: [] });
  assertEquals(out.length, 2);
});

Deno.test({ name: "enrichManagerQueueBatch — respects the max bound", ...kvOpts, fn: async () => {
  resetFirestoreCredentials();
  const org = ("test-enrich-max-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  for (let i = 0; i < 5; i++) {
    await setStored("manager-queue", org, [`f-m${i}`], { findingId: `f-m${i}`, addedAt: i, status: "pending" });
  }
  assertEquals(await enrichManagerQueueBatch(org, await getManagerQueue(org), 2), 2);
}});
