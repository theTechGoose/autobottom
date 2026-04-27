/** Manager queue repository. Ported from manager/kv.ts. */

import { getKv, orgKey } from "@core/data/deno-kv/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";
import type { ReviewDecision } from "@core/dto/types.ts";
import { getFinding } from "@audit/domain/data/audit-repository/mod.ts";

export interface ManagerQueueItem {
  findingId: string;
  addedAt: number;
  status: string;
  owner?: string;
  recordId?: string;
  recordingId?: string;
  totalQuestions?: number;
  failedCount?: number;
  completedAt?: number;
  jobTimestamp?: string;
}

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
  const remediatedAt = Date.now();
  await db.set(key, { ...existing, status: "remediated", remediatedBy: username, remediatedAt, notes });

  // Fire the `manager` webhook so the agent gets the remediation notes by
  // email. Best-effort — saved state above is the source of truth.
  try {
    const { getFinding } = await import("@audit/domain/data/audit-repository/mod.ts");
    const { fireWebhook } = await import("@admin/domain/data/admin-repository/mod.ts");
    const finding = await getFinding(orgId, findingId);
    if (finding) {
      fireWebhook(orgId, "manager", {
        findingId,
        finding,
        remediation: { notes, addressedBy: username, addressedAt: remediatedAt },
        remediatedAt: new Date(remediatedAt).toISOString(),
      }).catch((err) => console.error(`[MANAGER] ${findingId}: fireWebhook failed:`, err));
    }
  } catch (err) {
    console.error(`[MANAGER] ${findingId}: webhook prep failed:`, err);
  }

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

// ── Backfill manager queue from review-decided failures ─────────────────────

/** Scan review-decided entries for findings that have only confirm decisions
 *  and no pending items, then enqueue them into manager-queue for remediation.
 *  Port of main:manager/kv.ts:370+. */
export async function backfillManagerQueue(orgId: OrgId): Promise<{ added: number }> {
  const db = await getKv();
  let added = 0;

  const decidedByFinding: Record<string, ReviewDecision[]> = {};
  for await (const entry of db.list<ReviewDecision>({ prefix: orgKey(orgId, "review-decided") })) {
    const fid = entry.value.findingId;
    if (!decidedByFinding[fid]) decidedByFinding[fid] = [];
    decidedByFinding[fid].push(entry.value);
  }

  for (const [findingId, decisions] of Object.entries(decidedByFinding)) {
    // Skip if still has pending review items
    let hasPending = false;
    for await (const _ of db.list({ prefix: orgKey(orgId, "review-pending", findingId) })) {
      hasPending = true;
      break;
    }
    if (hasPending) continue;

    // Skip if already in manager queue
    const existing = await db.get(orgKey(orgId, "manager-queue", findingId));
    if (existing.value) continue;

    // Need at least one confirmed failure
    const confirmedFailures = decisions.filter((d) => d.decision === "confirm");
    if (confirmedFailures.length === 0) continue;

    const finding = await getFinding(orgId, findingId);
    if (!finding) continue;

    const totalQuestions = finding.answeredQuestions?.length ?? 0;
    const completedAt = decisions.reduce((max, d) => Math.max(max, d.decidedAt), 0);
    const rec = (finding.record as Record<string, unknown> | undefined) ?? {};

    const queueItem: ManagerQueueItem = {
      findingId,
      addedAt: Date.now(),
      status: "pending",
      owner: (finding.owner as string | undefined) ?? "",
      recordId: (rec.RecordId as string | undefined) ?? (rec.id as string | undefined) ?? "",
      recordingId: (finding.recordingId as string | undefined) ?? "",
      totalQuestions,
      failedCount: confirmedFailures.length,
      completedAt,
      jobTimestamp: (finding.job as { timestamp?: string } | undefined)?.timestamp ?? "",
    };

    await db.set(orgKey(orgId, "manager-queue", findingId), queueItem);
    added++;
  }

  return { added };
}

// Legacy alias preserves the controller dynamic-import call site.
export const backfillManagerQueueLegacy = backfillManagerQueue;
