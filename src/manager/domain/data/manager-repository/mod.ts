/** Manager queue repository. Firestore-backed. */

import {
  getStored, setStored, listStored, listStoredWithKeys,
} from "@core/data/firestore/mod.ts";
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
  await setStored("manager-queue", orgId, [findingId], { findingId, addedAt: Date.now(), status: "pending" });
}

export async function getManagerQueue(orgId: OrgId): Promise<ManagerQueueItem[]> {
  return await listStored<ManagerQueueItem>("manager-queue", orgId);
}

export async function submitRemediation(orgId: OrgId, findingId: string, notes: string, username: string): Promise<{ ok: boolean }> {
  const existing = await getStored<ManagerQueueItem>("manager-queue", orgId, findingId);
  if (!existing) return { ok: false };
  const remediatedAt = Date.now();
  await setStored("manager-queue", orgId, [findingId], { ...existing, status: "remediated", remediatedBy: username, remediatedAt, notes });

  // Fire the `manager` webhook — best-effort
  try {
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

export async function backfillManagerQueue(orgId: OrgId): Promise<{ added: number }> {
  let added = 0;

  const decidedRows = await listStoredWithKeys<ReviewDecision>("review-decided", orgId);
  const decidedByFinding: Record<string, ReviewDecision[]> = {};
  for (const { value } of decidedRows) {
    const fid = value.findingId;
    if (!decidedByFinding[fid]) decidedByFinding[fid] = [];
    decidedByFinding[fid].push(value);
  }

  const pendingRows = await listStoredWithKeys("review-pending", orgId);
  const pendingFindingIds = new Set<string>();
  for (const { key } of pendingRows) pendingFindingIds.add(String(key[0]));

  for (const [findingId, decisions] of Object.entries(decidedByFinding)) {
    if (pendingFindingIds.has(findingId)) continue;
    const existing = await getStored("manager-queue", orgId, findingId);
    if (existing) continue;

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

    await setStored("manager-queue", orgId, [findingId], queueItem);
    added++;
  }

  return { added };
}

export const backfillManagerQueueLegacy = backfillManagerQueue;
