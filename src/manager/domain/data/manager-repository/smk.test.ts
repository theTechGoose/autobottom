/** Smoke tests for manager repository. */
import { assertEquals, assert } from "#assert";
import { populateManagerQueue, enqueueRemediationForFinding, getManagerQueue, submitRemediation, getManagerStats, clearManagerQueue, enrichManagerQueueBatch, filterQueueToManagerScope, dropResolvedQueueItems, removeFromManagerQueue, markQueueItemAppealed, clearQueueItemAppeal, isOpenQueueItem, getManagerQueueForDepartments, deriveManagerQueue, skipRemediation, isInvalidGenieFinding, derivedQueueWindowDays } from "./mod.ts";
import type { ManagerQueueItem } from "./mod.ts";
import { setStored, resetFirestoreCredentials } from "@core/data/firestore/mod.ts";
import { saveFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { writeAuditDoneIndex } from "@audit/domain/data/stats-repository/mod.ts";
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

/** Seed a queue item plus the audit-done-idx row the drain reads. `score`
 *  undefined = queued but no index row at all. */
async function seedQueuedWithIndex(
  org: OrgId,
  findingId: string,
  o: { ts: number; score?: number; status?: string },
): Promise<void> {
  await setStored("manager-queue", org, [findingId], {
    findingId, addedAt: o.ts, completedAt: o.ts, status: o.status ?? "pending",
  });
  if (o.score !== undefined) {
    await writeAuditDoneIndex(org, {
      findingId, completedAt: o.ts, score: o.score, completed: true,
    } as never, { assumeFinished: true });
  }
}

Deno.test({ name: "dropResolvedQueueItems — drops an audit that went back to 100%", ...kvOpts, fn: async () => {
  resetFirestoreCredentials();
  const org = ("test-drain-100-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  await seedQueuedWithIndex(org, "f-drain-100", { ts: 1_700_000_000_000, score: 100 });
  const items = await getManagerQueue(org);
  assertEquals(await dropResolvedQueueItems(org, items), 1);
  // Out of the caller's list AND out of the store — the row is paid for once.
  assertEquals(items.filter((i) => i.findingId === "f-drain-100").length, 0);
  assertEquals((await getManagerQueue(org)).length, 0);
}});

Deno.test({ name: "dropResolvedQueueItems — keeps an audit that still has a failure", ...kvOpts, fn: async () => {
  resetFirestoreCredentials();
  const org = ("test-drain-96-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  await seedQueuedWithIndex(org, "f-drain-96", { ts: 1_700_000_001_000, score: 96 });
  const items = await getManagerQueue(org);
  assertEquals(await dropResolvedQueueItems(org, items), 0);
  assertEquals((await getManagerQueue(org)).length, 1);
}});

Deno.test({ name: "dropResolvedQueueItems — keeps an item whose index row is missing", ...kvOpts, fn: async () => {
  resetFirestoreCredentials();
  const org = ("test-drain-noidx-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  await seedQueuedWithIndex(org, "f-drain-noidx", { ts: 1_700_000_002_000 });
  const items = await getManagerQueue(org);
  // Unknown is not "passed" — never empty a manager's queue on a missing read.
  assertEquals(await dropResolvedQueueItems(org, items), 0);
  assertEquals((await getManagerQueue(org)).length, 1);
}});

Deno.test({ name: "dropResolvedQueueItems — leaves a remediated row alone", ...kvOpts, fn: async () => {
  resetFirestoreCredentials();
  const org = ("test-drain-done-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  await seedQueuedWithIndex(org, "f-drain-done", { ts: 1_700_000_003_000, score: 100, status: "remediated" });
  const items = await getManagerQueue(org);
  assertEquals(await dropResolvedQueueItems(org, items), 0);
  assertEquals((await getManagerQueue(org)).length, 1);
}});

Deno.test({ name: "dropResolvedQueueItems — respects the max bound", ...kvOpts, fn: async () => {
  resetFirestoreCredentials();
  const org = ("test-drain-max-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  for (let i = 0; i < 4; i++) {
    await seedQueuedWithIndex(org, `f-drain-max-${i}`, { ts: 1_700_000_100_000 + i, score: 100 });
  }
  assertEquals(await dropResolvedQueueItems(org, await getManagerQueue(org), 2), 2);
  assertEquals((await getManagerQueue(org)).length, 2);
}});

Deno.test({ name: "removeFromManagerQueue — pending row goes, remediated row stays", ...kvOpts, fn: async () => {
  resetFirestoreCredentials();
  const org = ("test-remove-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  await seedQueuedWithIndex(org, "f-rm-pending", { ts: 1_700_000_200_000 });
  await seedQueuedWithIndex(org, "f-rm-done", { ts: 1_700_000_200_001, status: "remediated" });
  assertEquals(await removeFromManagerQueue(org, "f-rm-pending"), true);
  assertEquals(await removeFromManagerQueue(org, "f-rm-done"), false);
  assertEquals(await removeFromManagerQueue(org, "f-rm-absent"), false);
  assertEquals((await getManagerQueue(org)).map((i) => i.findingId), ["f-rm-done"]);
}});

// ── Appeal takes an audit off the pending queue ───────────────────────────────
// An audit whose result is being contested is not ready to coach on, so any
// appeal — judge decision OR new audio — moves the row to the Completed side.

Deno.test("isOpenQueueItem — only untouched rows are open work", () => {
  assert(isOpenQueueItem(qi({})), "a plain pending row is open");
  assert(!isOpenQueueItem(qi({ status: "remediated" })), "remediated is closed");
  assert(!isOpenQueueItem(qi({ appealState: "appealed" })), "a judge appeal closes it");
  assert(!isOpenQueueItem(qi({ appealState: "re-audited" })), "new audio closes it");
  assert(
    !isOpenQueueItem(qi({ status: "remediated", appealState: "appealed" })),
    "coached AND appealed is still closed",
  );
  assert(
    isOpenQueueItem(qi({ appealDeniedAt: 123 })),
    "a denied appeal put the row back — it is open work again",
  );
});

Deno.test({ name: "markQueueItemAppealed — flags the row and takes it off pending", ...kvOpts, fn: async () => {
  const org = ("test-appeal-flag-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  await setStored("manager-queue", org, ["f-ap"], {
    findingId: "f-ap", addedAt: 1, status: "pending", department: "ODR",
  });

  assertEquals(
    await markQueueItemAppealed(org, "f-ap", {
      appealState: "appealed", appealedAt: 500, appealedBy: "rep@x.com", appealNote: "bot misheard",
    }),
    true,
  );
  const [item] = await getManagerQueue(org);
  assertEquals(item.appealState, "appealed");
  assertEquals(item.appealedAt, 500);
  assertEquals(item.appealedBy, "rep@x.com");
  assertEquals(item.appealNote, "bot misheard");
  assertEquals(item.status, "pending", "status is the remediation lifecycle — the appeal does not touch it");
  assert(!isOpenQueueItem(item), "an appealed row must leave the pending queue");
  // Denormalized display fields must survive, or the Completed row renders blank.
  assertEquals(item.department, "ODR");
}});

Deno.test({ name: "markQueueItemAppealed — no-op when unqueued or already flagged", ...kvOpts, fn: async () => {
  const org = ("test-appeal-noop-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  assertEquals(
    await markQueueItemAppealed(org, "f-absent", { appealState: "appealed" }),
    false,
    "most audits are not in the queue at all — that is not a failure",
  );

  await setStored("manager-queue", org, ["f-twice"], { findingId: "f-twice", addedAt: 1, status: "pending" });
  await markQueueItemAppealed(org, "f-twice", { appealState: "appealed", appealedAt: 100, appealedBy: "first@x.com" });
  assertEquals(
    await markQueueItemAppealed(org, "f-twice", { appealState: "re-audited", appealedAt: 999, appealedBy: "second@x.com" }),
    false,
    "a second appeal must not overwrite the first one's author or timestamp",
  );
  const [item] = await getManagerQueue(org);
  assertEquals(item.appealState, "appealed");
  assertEquals(item.appealedBy, "first@x.com");
  assertEquals(item.appealedAt, 100);
}});

Deno.test({ name: "clearQueueItemAppeal — a denied appeal sends the row back to pending", ...kvOpts, fn: async () => {
  const org = ("test-appeal-clear-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  await setStored("manager-queue", org, ["f-den"], {
    findingId: "f-den", addedAt: 1, status: "pending", department: "2ND",
    appealState: "appealed", appealedAt: 500, appealedBy: "rep@x.com", appealNote: "bot misheard",
  });

  assertEquals(await clearQueueItemAppeal(org, "f-den"), true);
  const [item] = await getManagerQueue(org);
  assertEquals(item.appealState, undefined);
  assertEquals(item.appealedBy, undefined, "the appeal fields come off so Completed stops claiming it");
  assertEquals(item.appealNote, undefined);
  assert(item.appealDeniedAt! > 0, "stamped so the row can explain why it reappeared");
  assert(isOpenQueueItem(item), "the coaching ask is real again");
  assertEquals(item.department, "2ND", "display fields survive the round trip");
}});

Deno.test({ name: "clearQueueItemAppeal — leaves rows it does not own alone", ...kvOpts, fn: async () => {
  const org = ("test-appeal-clear-noop-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  await setStored("manager-queue", org, ["f-plain"], { findingId: "f-plain", addedAt: 1, status: "pending" });
  await setStored("manager-queue", org, ["f-rem"], {
    findingId: "f-rem", addedAt: 1, status: "remediated", remediatedBy: "m@x.com",
  });
  assertEquals(await clearQueueItemAppeal(org, "f-plain"), false, "never appealed — nothing to clear");
  assertEquals(await clearQueueItemAppeal(org, "f-rem"), false, "remediated work is not reopened by a judge");
  assertEquals(await clearQueueItemAppeal(org, "f-absent"), false);
}});

Deno.test({ name: "appealed rows are protected from the resolved-queue drains", ...kvOpts, fn: async () => {
  const org = ("test-appeal-drain-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  // Appealed AND back at 100%: the appeal was won. The row is the manager's
  // record that it went out for appeal, so it stays on the Completed side —
  // exactly as a remediated row does.
  await seedQueuedWithIndex(org, "f-won", { ts: 1_700_000_500_000, score: 100 });
  await markQueueItemAppealed(org, "f-won", { appealState: "appealed", appealedBy: "rep@x.com" });

  const items = await getManagerQueue(org);
  assertEquals(await dropResolvedQueueItems(org, items), 0, "a closed-out row is not drained at 100%");
  assertEquals(await removeFromManagerQueue(org, "f-won"), false, "nor removed by the judge path");
  assertEquals((await getManagerQueue(org)).length, 1);
}});

Deno.test({ name: "getManagerStats — appealed rows leave Pending and get their own count", ...kvOpts, fn: async () => {
  const org = ("test-appeal-stats-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  await setStored("manager-queue", org, ["s-open"], { findingId: "s-open", addedAt: 1, status: "pending" });
  await setStored("manager-queue", org, ["s-rem"], { findingId: "s-rem", addedAt: 1, status: "remediated" });
  await setStored("manager-queue", org, ["s-ap"], {
    findingId: "s-ap", addedAt: 1, status: "pending", appealState: "appealed",
  });
  await setStored("manager-queue", org, ["s-ra"], {
    findingId: "s-ra", addedAt: 1, status: "pending", appealState: "re-audited",
  });

  const stats = await getManagerStats(org);
  assertEquals(stats.total, 4);
  assertEquals(stats.pending, 1, "only the untouched row is still open work");
  assertEquals(stats.remediated, 1);
  assertEquals(stats.appealed, 2, "both appeal kinds count");
}});

// ── Department-scoped read (the fix for the 1000-row cap) ────────────────────
// The whole-org read is capped at 1000 by listStored's default. The queue
// outgrew it, so rows past the cap were permanently invisible — the same ones
// every request, since the query has no sort. Managers now read their own
// departments straight from the database instead.

Deno.test({ name: "getManagerQueueForDepartments — returns only the asked-for departments", ...kvOpts, fn: async () => {
  const org = ("test-deptread-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  await setStored("manager-queue", org, ["d-vba"], { findingId: "d-vba", addedAt: 1, status: "pending", department: "VBA PM" });
  await setStored("manager-queue", org, ["d-ods"], { findingId: "d-ods", addedAt: 2, status: "pending", department: "ODS" });
  await setStored("manager-queue", org, ["d-gs"], { findingId: "d-gs", addedAt: 3, status: "pending", department: "GS MB" });

  const one = await getManagerQueueForDepartments(org, ["VBA PM"]);
  assertEquals(one?.map((i) => i.findingId), ["d-vba"]);

  const many = await getManagerQueueForDepartments(org, ["VBA PM", "GS MB"]);
  assertEquals(many?.map((i) => i.findingId).sort(), ["d-gs", "d-vba"]);
}});

Deno.test({ name: "getManagerQueueForDepartments — null tells the caller to fall back", ...kvOpts, fn: async () => {
  const org = ("test-deptread-null-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  // Empty scope means "no restriction" (filterQueueToManagerScope's semantics),
  // NOT "no rows" — returning [] here would empty a manager's queue.
  assertEquals(await getManagerQueueForDepartments(org, []), null);
  assertEquals(await getManagerQueueForDepartments(org, ["", "  "]), null, "blank names are not a real scope");
  // One prod account owns 48 departments — past Firestore's IN limit, so it
  // must fall back rather than silently query the first 30.
  const many = Array.from({ length: 48 }, (_, i) => `DEPT${i}`);
  assertEquals(await getManagerQueueForDepartments(org, many), null);
  // A duplicated list must be deduped BELOW the limit, not rejected.
  const dupes = Array.from({ length: 48 }, () => "VBA PM");
  assertEquals((await getManagerQueueForDepartments(org, dupes))?.length, 0);
}});

Deno.test({ name: "getManagerQueue — returns every row, past the old 1000 cap", ...kvOpts, fn: async () => {
  const org = ("test-uncapped-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  // 1,050 rows: the old listStored default would have returned exactly 1000
  // and silently dropped the rest. This is the regression guard for that.
  const writes = [];
  for (let i = 0; i < 1050; i++) {
    writes.push(setStored("manager-queue", org, [`cap-${String(i).padStart(5, "0")}`], {
      findingId: `cap-${String(i).padStart(5, "0")}`, addedAt: i, status: "pending", department: "CAP",
    }));
  }
  await Promise.all(writes);
  assertEquals((await getManagerQueue(org)).length, 1050);
  // And the narrowed read must be uncapped too — it pages the same way.
  assertEquals((await getManagerQueueForDepartments(org, ["CAP"]))?.length, 1050);
}});

// ── Derived queue (read audit-done-idx, not the stored snapshot) ─────────────

/** Seed an audit-done-idx row plus, optionally, the stored overlay row. */
async function seedIdx(
  org: OrgId,
  findingId: string,
  o: Partial<{ score: number; completed: boolean; reason: string; department: string; shift: string; appealStatus: string; voName: string; completedAt: number }>,
): Promise<void> {
  // Default to RECENT: the derived queue applies a date floor, so a fixture
  // dated years back is correctly filtered out and every assertion below would
  // be testing the floor rather than what it means to.
  const at = o.completedAt ?? Date.now() - 86_400_000;
  await setStored("audit-done-idx", org, [String(at), findingId], {
    findingId,
    completedAt: at,
    completed: o.completed ?? true,
    score: o.score ?? 80,
    reason: o.reason ?? "reviewed",
    department: o.department ?? "ODR",
    shift: o.shift ?? "",
    voName: o.voName ?? "Someone",
    ...(o.appealStatus ? { appealStatus: o.appealStatus } : {}),
  });
}

Deno.test({ name: "deriveManagerQueue — every kind of failure, minus the ones not owed", ...kvOpts, fn: async () => {
  const org = ("test-derive-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  await seedIdx(org, "d-fail", { score: 80 });                                  // in: failed post-review
  await seedIdx(org, "d-postappeal", { score: 80, appealStatus: "complete" });  // in: failed post-appeal
  await seedIdx(org, "d-nogenie", { score: 0, reason: "invalid_genie" });       // in: the call never recorded
  await seedIdx(org, "d-perfect", { score: 100 });                             // out: nothing to coach
  await seedIdx(org, "d-unreviewed", { score: 80, completed: false });         // out: not confirmed yet
  await seedIdx(org, "d-appealing", { score: 80, appealStatus: "pending" });   // out: under appeal
  await seedIdx(org, "d-otherdept", { score: 80, department: "GS MB" });       // out: another team

  const rows = await deriveManagerQueue(org, ["ODR"]);
  assertEquals(rows?.map((r) => r.findingId).sort(), ["d-fail", "d-nogenie", "d-postappeal"]);
  // The no-audio row must be badged, or a manager opens it hunting for a
  // failed question that was never graded.
  assertEquals(rows?.find((r) => r.findingId === "d-nogenie")?.invalidGenie, true);
  assertEquals(rows?.find((r) => r.findingId === "d-fail")?.invalidGenie, undefined);
}});

Deno.test({ name: "deriveManagerQueue — a decided appeal returns on its own, no flag to clear", ...kvOpts, fn: async () => {
  const org = ("test-derive-appeal-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  // The judge upheld the failure: appealStatus flips to complete and the score
  // stays below 100, so the audit is simply derived again. Nothing had to be
  // written back to a queue row — that is the point of deriving.
  await seedIdx(org, "d-denied", { score: 80, appealStatus: "complete" });
  assertEquals((await deriveManagerQueue(org, ["ODR"]))?.map((r) => r.findingId), ["d-denied"]);

  // The judge granted it: score is 100, so it stops being derived. No drain,
  // no removal call, no stale row.
  await seedIdx(org, "d-won", { score: 100, appealStatus: "complete" });
  assertEquals((await deriveManagerQueue(org, ["ODR"]))?.map((r) => r.findingId), ["d-denied"]);
}});

Deno.test({ name: "deriveManagerQueue — the stored row supplies the manager's own work", ...kvOpts, fn: async () => {
  const org = ("test-derive-overlay-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  await seedIdx(org, "d-coached", { score: 80, voName: "Reese Moore" });
  await setStored("manager-queue", org, ["d-coached"], {
    findingId: "d-coached", addedAt: 5, status: "remediated", department: "ODR",
    remediatedBy: "anna@monsterrg.com", remediatedAt: 99, notes: "coached on the disclosure",
    failedQuestions: ["11% Disclosure"], totalQuestions: 10, failedCount: 2,
  });
  const [row] = (await deriveManagerQueue(org, ["ODR"]))!;
  assertEquals(row.status, "remediated");
  assertEquals(row.remediatedBy, "anna@monsterrg.com");
  assertEquals(row.notes, "coached on the disclosure");
  assertEquals(row.failedQuestions, ["11% Disclosure"]);
  assertEquals(row.voName, "Reese Moore", "display fields come from the index");
  assert(!isOpenQueueItem(row));
}});

Deno.test({ name: "deriveManagerQueue — closed-out work survives the audit leaving the index", ...kvOpts, fn: async () => {
  const org = ("test-derive-keep-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  // A won appeal takes the audit to 100%, so it is no longer derived — but the
  // manager already wrote it up, and that record belongs on Completed.
  await seedIdx(org, "d-gone", { score: 100 });
  await setStored("manager-queue", org, ["d-gone"], {
    findingId: "d-gone", addedAt: 1, status: "remediated", department: "ODR",
    remediatedBy: "anna@monsterrg.com", remediatedAt: 50, notes: "already coached",
  });
  // An untouched row for an audit that is no longer failing must NOT come back.
  await seedIdx(org, "d-stale", { score: 100 });
  await setStored("manager-queue", org, ["d-stale"], {
    findingId: "d-stale", addedAt: 1, status: "pending", department: "ODR",
  });

  const rows = await deriveManagerQueue(org, ["ODR"]);
  assertEquals(rows?.map((r) => r.findingId), ["d-gone"]);
  assertEquals(rows?.[0].notes, "already coached");
}});

Deno.test({ name: "deriveManagerQueue — null when the scope can't be a query", ...kvOpts, fn: async () => {
  const org = ("test-derive-null-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  assertEquals(await deriveManagerQueue(org, []), null);
  assertEquals(await deriveManagerQueue(org, Array.from({ length: 48 }, (_, i) => `D${i}`)), null);
}});

// ── Skip: close a row out with no write-up ──────────────────────────────────

Deno.test("isOpenQueueItem — a skipped row is closed out", () => {
  assert(!isOpenQueueItem(qi({ status: "skipped" })));
  assert(isOpenQueueItem(qi({ status: "pending" })));
});

Deno.test({ name: "skipRemediation — closes the row and records who decided", ...kvOpts, fn: async () => {
  const org = ("test-skip-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  await setStored("manager-queue", org, ["s1"], {
    findingId: "s1", addedAt: 1, status: "pending", department: "ODR",
  });
  assertEquals(await skipRemediation(org, "s1", "anna@monsterrg.com"), { ok: true });
  const [item] = await getManagerQueue(org);
  assertEquals(item.status, "skipped");
  assertEquals(item.skippedBy, "anna@monsterrg.com");
  assert(item.skippedAt! > 0);
  assert(!isOpenQueueItem(item), "it must leave the pending queue");
  assertEquals(item.notes, undefined, "skip records no write-up, by design");
  assertEquals(item.department, "ODR", "display fields survive");
}});

Deno.test({ name: "skipRemediation — refuses rows that are already closed", ...kvOpts, fn: async () => {
  const org = ("test-skip-guard-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  await setStored("manager-queue", org, ["s-rem"], {
    findingId: "s-rem", addedAt: 1, status: "remediated", remediatedBy: "m@x.com", notes: "real write-up",
  });
  await setStored("manager-queue", org, ["s-ap"], {
    findingId: "s-ap", addedAt: 1, status: "pending", appealState: "appealed",
  });
  // Skipping a remediated audit would bury a real write-up behind a skip.
  assertEquals(
    await skipRemediation(org, "s-rem", "anna@x.com"),
    { ok: false, reason: "already-closed" },
  );
  assertEquals(await skipRemediation(org, "s-ap", "anna@x.com"), { ok: false, reason: "already-closed" });
  assertEquals(await skipRemediation(org, "s-absent", "anna@x.com"), { ok: false, reason: "not-queued" });
  const rem = (await getManagerQueue(org)).find((i) => i.findingId === "s-rem")!;
  assertEquals(rem.notes, "real write-up", "the write-up survives the refused skip");
}});

Deno.test({ name: "getManagerStats — skipped leaves Pending and counts as closed out", ...kvOpts, fn: async () => {
  const org = ("test-skip-stats-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  await setStored("manager-queue", org, ["k-open"], { findingId: "k-open", addedAt: 1, status: "pending" });
  await setStored("manager-queue", org, ["k-skip"], { findingId: "k-skip", addedAt: 1, status: "skipped" });
  await setStored("manager-queue", org, ["k-rem"], { findingId: "k-rem", addedAt: 1, status: "remediated" });
  const stats = await getManagerStats(org);
  assertEquals(stats.pending, 1);
  assertEquals(stats.remediated, 2, "skipped folds in with remediated — both are dealt with");
}});

Deno.test({ name: "enqueueRemediationForFinding — an invalid genie is queued despite having no failures", ...kvOpts, fn: async () => {
  const org = ("test-enq-genie-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  // No answeredQuestions at all — the shape step-finalize leaves behind when
  // genie retries are exhausted. failedCount is 0, so the old no-failures gate
  // kept every one of these out of the queue entirely.
  await saveFinding(org, {
    id: "f-genie",
    rawTranscript: "Invalid Genie",
    findingStatus: "finished",
    record: { RecordId: 1, ActivatingOffice: "ODR", VoName: "ODR - Pattea Logan" },
    answeredQuestions: [],
  });
  const res = await enqueueRemediationForFinding(org, "f-genie");
  assertEquals(res.enqueued, true);
  const [item] = await getManagerQueue(org);
  assertEquals(item.invalidGenie, true);
  assertEquals(item.failedCount, 0);
  assert(isOpenQueueItem(item), "it is real work — the call did not record");
}});

Deno.test({ name: "enqueueRemediationForFinding — a genuine pass is still skipped", ...kvOpts, fn: async () => {
  const org = ("test-enq-pass-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  await saveFinding(org, {
    id: "f-pass",
    findingStatus: "finished",
    record: { RecordId: 1, ActivatingOffice: "ODR" },
    answeredQuestions: [{ header: "Q", answer: "Yes" }],
  });
  assertEquals((await enqueueRemediationForFinding(org, "f-pass")).reason, "no-failures");
}});

Deno.test("isInvalidGenieFinding — matches step-finalize's own predicate", () => {
  assert(isInvalidGenieFinding({ rawTranscript: "Invalid Genie" }));
  assert(isInvalidGenieFinding({ rawTranscript: "... Genie Invalid ..." }));
  assert(isInvalidGenieFinding({ findingStatus: "no recording" }));
  assert(!isInvalidGenieFinding({ rawTranscript: "Agent: hello, thanks for calling" }));
  assert(!isInvalidGenieFinding({}));
});

// ── Derived queue: score and the date floor ─────────────────────────────────

Deno.test({ name: "deriveManagerQueue — carries the index score, so Score is never blank", ...kvOpts, fn: async () => {
  const org = ("test-derive-score-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  // No stored row behind it — the common case once deriving, and the case
  // that rendered an em-dash before the index score was carried through.
  await seedIdx(org, "d-score", { score: 88, completedAt: Date.now() - 86_400_000 });
  const [row] = (await deriveManagerQueue(org, ["ODR"]))!;
  assertEquals(row.score, 88);
  assertEquals(row.totalQuestions, undefined, "the index has no per-question detail — that is expected");
}});

Deno.test({ name: "deriveManagerQueue — a date floor keeps years of history out", ...kvOpts, fn: async () => {
  const org = ("test-derive-floor-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  const DAY = 86_400_000;
  await seedIdx(org, "d-recent", { score: 80, completedAt: Date.now() - 10 * DAY });
  await seedIdx(org, "d-ancient", { score: 80, completedAt: Date.now() - 400 * DAY });

  Deno.env.set("DERIVED_QUEUE_WINDOW_DAYS", "90");
  try {
    assertEquals(derivedQueueWindowDays(), 90);
    assertEquals((await deriveManagerQueue(org, ["ODR"]))?.map((r) => r.findingId), ["d-recent"]);

    // 0 means no floor — it must return everything, NOT filter everything out
    // (now - 0 is now, which would exclude every row).
    Deno.env.set("DERIVED_QUEUE_WINDOW_DAYS", "0");
    assertEquals(
      (await deriveManagerQueue(org, ["ODR"]))?.map((r) => r.findingId).sort(),
      ["d-ancient", "d-recent"],
    );
  } finally {
    Deno.env.delete("DERIVED_QUEUE_WINDOW_DAYS");
  }
  assertEquals(derivedQueueWindowDays(), 90, "unset falls back to the 90-day default");
}});
