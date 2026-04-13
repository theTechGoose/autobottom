/** Manager queue repository. Ported from manager/kv.ts. */

import { getKv, orgKey } from "@core/domain/data/deno-kv/mod.ts";
import type { OrgId } from "@core/domain/data/deno-kv/mod.ts";

export interface ManagerQueueItem { findingId: string; addedAt: number; status: string; }

export async function populateManagerQueue(orgId: OrgId, findingId: string): Promise<void> {
  const db = await getKv();
  await db.set(orgKey(orgId, "manager-queue", findingId), { findingId, addedAt: Date.now(), status: "pending" });
}

export async function getManagerQueue(orgId: OrgId): Promise<ManagerQueueItem[]> {
  const db = await getKv();
  const items: ManagerQueueItem[] = [];
  for await (const entry of db.list<ManagerQueueItem>({ prefix: orgKey(orgId, "manager-queue") })) {
    items.push(entry.value);
  }
  return items;
}

export async function submitRemediation(orgId: OrgId, findingId: string, notes: string, username: string): Promise<{ ok: boolean }> {
  const db = await getKv();
  const key = orgKey(orgId, "manager-queue", findingId);
  const existing = (await db.get<ManagerQueueItem>(key)).value;
  if (!existing) return { ok: false };
  await db.set(key, { ...existing, status: "remediated", remediatedBy: username, remediatedAt: Date.now(), notes });
  return { ok: true };
}

export async function getManagerStats(orgId: OrgId): Promise<{ total: number; pending: number; remediated: number }> {
  const items = await getManagerQueue(orgId);
  return {
    total: items.length,
    pending: items.filter((i) => i.status === "pending").length,
    remediated: items.filter((i) => i.status === "remediated").length,
  };
}
