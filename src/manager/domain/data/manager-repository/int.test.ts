/** REQ-045: an audit in the hidden set stays off the manager queue and out of
 *  its counts, on both the stored and the derived path — and hiding deletes
 *  nothing. Runs against the Firestore emulator. */
import { assert, assertEquals } from "#assert";
import { getManagerStats, loadScopedManagerQueue } from "./mod.ts";
import { getStored, setStored } from "@core/data/firestore/mod.ts";
import { markFindingHidden } from "@audit/domain/data/stats-repository/mod.ts";
import { saveFinding } from "@audit/domain/data/audit-repository/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

const opts = { sanitizeResources: false, sanitizeOps: false };
const newOrg = (tag: string) => (`test-mqh-${tag}-${crypto.randomUUID().slice(0, 8)}`) as OrgId;
const AT = Date.now() - 86_400_000;

/** One failing ODR audit, present in both the stored queue and the index. */
async function seed(org: OrgId, findingId: string): Promise<void> {
  await saveFinding(org, {
    id: findingId, recordingIdField: "VoGenie",
    record: { ActivatingOffice: "ODR", Shift: "AM", RecordId: 1 },
  });
  await setStored("manager-queue", org, [findingId], {
    findingId, addedAt: AT, completedAt: AT, status: "pending", department: "ODR", shift: "AM",
  });
  await setStored("audit-done-idx", org, [String(AT), findingId], {
    findingId, completedAt: AT, completed: true, score: 96, reason: "reviewed",
    department: "ODR", shift: "AM", voName: "ODR - Test other",
  });
}

const scope = { departments: ["ODR"], shifts: [] as string[] };
const ids = (rows: { findingId: string }[]) => rows.map((r) => r.findingId).sort();

Deno.test({ name: "REQ-045: a hidden audit is off the scoped manager queue, stored and derived", ...opts, fn: async () => {
  const org = newOrg("queue");
  await seed(org, "keep");
  await seed(org, "hide");
  await markFindingHidden(org, "hide", "test");

  Deno.env.delete("DERIVED_MANAGER_QUEUE");
  assertEquals(ids(await loadScopedManagerQueue(org, scope)), ["keep"], "stored queue");

  Deno.env.set("DERIVED_MANAGER_QUEUE", "true");
  try {
    assertEquals(ids(await loadScopedManagerQueue(org, scope)), ["keep"], "derived queue");
  } finally {
    Deno.env.delete("DERIVED_MANAGER_QUEUE");
  }

  const stats = await getManagerStats(org);
  assertEquals(stats.total, 1, "org-wide stats leave it out");
  assertEquals(stats.pending, 1);
}});

Deno.test({ name: "REQ-045: hiding leaves the audit and its queue row in place", ...opts, fn: async () => {
  const org = newOrg("kept");
  await seed(org, "hide");
  await markFindingHidden(org, "hide", "test");
  await loadScopedManagerQueue(org, scope);
  await getManagerStats(org);

  assert(await getStored("manager-queue", org, "hide"), "queue row still stored");
  assert(await getStored("audit-done-idx", org, String(AT), "hide"), "index row still stored");
}});
