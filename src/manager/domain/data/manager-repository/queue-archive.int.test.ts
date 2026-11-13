/** REQ-057: the org-level queue archive takes open items that landed before
 *  the cutoff off the manager queue (stored AND derived), the VO view and the
 *  counts — deletes nothing, and clearing it brings them back. Runs against
 *  the Firestore emulator. */
import { assert, assertEquals } from "#assert";
import {
  clearQueueArchive, getManagerStats, getQueueArchive, loadScopedManagerQueue, setQueueArchive,
} from "./mod.ts";
import { getStored, setStored } from "@core/data/firestore/mod.ts";
import { saveFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { saveManagerScope } from "@admin/domain/data/admin-repository/mod.ts";
import { loadVoView } from "@manager/domain/business/vo-portal/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

const opts = { sanitizeResources: false, sanitizeOps: false };
const newOrg = (tag: string) => (`test-mqa-${tag}-${crypto.randomUUID().slice(0, 8)}`) as OrgId;
const DAY = 86_400_000;
const CUTOFF = Date.now() - 10 * DAY;
const scope = { departments: ["VBA PM"], shifts: [] };
const ids = (rows: Array<{ findingId: string }>) => rows.map((r) => r.findingId).sort();

/** One failing VBA PM audit that landed at `at`, in both the stored queue and the index. */
async function seed(org: OrgId, findingId: string, at: number, over: Record<string, unknown> = {}): Promise<void> {
  await saveFinding(org, { id: findingId, recordingIdField: "VoGenie", record: { ActivatingOffice: "VBA PM", Shift: "PM", RecordId: 1 } });
  await setStored("manager-queue", org, [findingId], {
    findingId, addedAt: at, completedAt: at, status: "pending", department: "VBA PM", shift: "PM", ...over,
  });
  await setStored("audit-done-idx", org, [String(at), findingId], {
    findingId, completedAt: at, completed: true, score: 80, reason: "reviewed", department: "VBA PM", shift: "PM", voName: "VBA PM - Dana Lee",
  });
}

Deno.test({ name: "REQ-057: open items before the cutoff are off the scoped queue (stored and derived); on/after stay; closed ones stay", ...opts, fn: async () => {
  const org = newOrg("queue");
  await seed(org, "old-open", CUTOFF - DAY);
  await seed(org, "at-cutoff", CUTOFF);
  await seed(org, "new-open", CUTOFF + DAY);
  await seed(org, "old-remediated", CUTOFF - DAY, { status: "remediated", remediatedAt: Date.now(), remediatedBy: "m@monsterrg.com" });
  await setQueueArchive(org, CUTOFF, "admin@monsterrg.com");

  Deno.env.delete("DERIVED_MANAGER_QUEUE");
  assertEquals(ids(await loadScopedManagerQueue(org, scope)), ["at-cutoff", "new-open", "old-remediated"], "stored queue");
  Deno.env.set("DERIVED_MANAGER_QUEUE", "true");
  try {
    assertEquals(ids(await loadScopedManagerQueue(org, scope)), ["at-cutoff", "new-open", "old-remediated"], "derived queue");
  } finally {
    Deno.env.delete("DERIVED_MANAGER_QUEUE");
  }
}});

Deno.test({ name: "REQ-057: archived items are out of the counts, the VO view, and nothing is deleted", ...opts, fn: async () => {
  const org = newOrg("counts");
  await seed(org, "old-open", CUTOFF - DAY);
  await seed(org, "new-open", CUTOFF + DAY);
  await saveManagerScope(org, "vo@monsterrg.com", { departments: ["VBA PM"], shifts: [] });
  await setQueueArchive(org, CUTOFF, "admin@monsterrg.com");

  const stats = await getManagerStats(org);
  assertEquals(stats.total, 1);
  assertEquals(stats.pending, 1);
  assertEquals(ids(await loadVoView(org, "vo@monsterrg.com")), ["new-open"], "VO view");

  assert(await getStored("manager-queue", org, "old-open"), "the queue row is still stored");
  const archive = await getQueueArchive(org);
  assertEquals(archive?.before, CUTOFF);
  assertEquals(archive?.by, "admin@monsterrg.com");
}});

Deno.test({ name: "REQ-057: clearing the archive brings the old items back", ...opts, fn: async () => {
  const org = newOrg("clear");
  await seed(org, "old-open", CUTOFF - DAY);
  await setQueueArchive(org, CUTOFF, "admin@monsterrg.com");
  assertEquals(ids(await loadScopedManagerQueue(org, scope)), []);
  await clearQueueArchive(org);
  assertEquals(await getQueueArchive(org), null);
  assertEquals(ids(await loadScopedManagerQueue(org, scope)), ["old-open"]);
}});

Deno.test({ name: "REQ-057: an old audit returned by an appeal denied after the archive shows again", ...opts, fn: async () => {
  const org = newOrg("appeal");
  await setQueueArchive(org, CUTOFF, "admin@monsterrg.com");
  await new Promise((r) => setTimeout(r, 5));
  await seed(org, "denied-later", CUTOFF - DAY, { appealDeniedAt: Date.now() });
  assertEquals(ids(await loadScopedManagerQueue(org, scope)), ["denied-later"]);
}});

Deno.test({ name: "REQ-057: on the derived path too, an appeal denied after the archive brings the old audit back", ...opts, fn: async () => {
  const org = newOrg("appeal-derived");
  await setQueueArchive(org, CUTOFF, "admin@monsterrg.com");
  await new Promise((r) => setTimeout(r, 5));
  await seed(org, "denied-later", CUTOFF - DAY, { appealDeniedAt: Date.now() });
  await seed(org, "old-open", CUTOFF - DAY);
  Deno.env.set("DERIVED_MANAGER_QUEUE", "true");
  try {
    assertEquals(ids(await loadScopedManagerQueue(org, scope)), ["denied-later"]);
  } finally {
    Deno.env.delete("DERIVED_MANAGER_QUEUE");
  }
}});
