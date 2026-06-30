/** Manager queue repository. Firestore-backed. */

import {
  getStored, setStored, deleteStored, listStored, listStoredWithKeys,
} from "@core/data/firestore/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";
import type { ReviewDecision } from "@core/dto/types.ts";
import { getFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { buildIndexMeta } from "@audit/domain/data/stats-repository/mod.ts";

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

// ── Data maintenance: clear queue items by team / date ───────────────────────

export interface ManagerQueueFilter {
  /** Exact (trimmed) department match, e.g. "2ND". */
  department?: string;
  /** Exact (trimmed) shift match, e.g. "AM". */
  shift?: string;
  /** Audit-date window (ms). `since` inclusive, `until` exclusive. */
  since?: number;
  until?: number;
}

export interface ManagerQueueClearMatch {
  findingId: string;
  owner?: string;
  department?: string;
  shift?: string;
  date?: number;
}

export interface ManagerQueueClearResult {
  total: number;
  matched: number;
  deleted: number;
  dryRun: boolean;
  /** Up to 50 matched items, for an admin preview before committing. */
  sample: ManagerQueueClearMatch[];
}

/** Clear manager-queue items matching any combination of department / shift /
 *  date-range. dept + shift are exact (trimmed) matches resolved from each
 *  finding (so a stale queue can be scoped to a manager's team before they go
 *  live); the date is the audit's completion date (`completedAt`, falling back
 *  to `addedAt`). Pass `{ dryRun: true }` to preview the count + a sample
 *  without deleting.
 *
 *  Requires at least one filter — refuses an unfiltered wipe so an empty admin
 *  form can never nuke the entire queue. A pure date-range clear reads no
 *  findings; dept/shift filters resolve each finding once (deduped). */
export async function clearManagerQueue(
  orgId: OrgId,
  filter: ManagerQueueFilter,
  opts: { dryRun?: boolean } = {},
): Promise<ManagerQueueClearResult> {
  const dept = filter.department?.trim() || undefined;
  const shift = filter.shift?.trim() || undefined;
  const since = Number.isFinite(filter.since) ? Number(filter.since) : undefined;
  const until = Number.isFinite(filter.until) ? Number(filter.until) : undefined;

  if (!dept && !shift && since == null && until == null) {
    throw new Error("clearManagerQueue: at least one filter (department, shift, since, until) is required");
  }

  const items = await getManagerQueue(orgId);
  const needDeptShift = !!dept || !!shift;
  const metaCache = new Map<string, { department?: string; shift?: string }>();
  const matches: ManagerQueueClearMatch[] = [];

  for (const item of items) {
    const date = item.completedAt ?? item.addedAt;
    // Date filter first — cheap, and a pure date clear needs no finding read.
    if (since != null && (date == null || date < since)) continue;
    if (until != null && (date == null || date >= until)) continue;

    let itemDept: string | undefined;
    let itemShift: string | undefined;
    if (needDeptShift) {
      if (!metaCache.has(item.findingId)) {
        let resolved: { department?: string; shift?: string } = {};
        try {
          const finding = await getFinding(orgId, item.findingId);
          if (finding) {
            const meta = buildIndexMeta(finding);
            resolved = { department: meta.department, shift: meta.shift };
          }
        } catch { /* finding gone — unresolvable; won't match a dept/shift filter */ }
        metaCache.set(item.findingId, resolved);
      }
      const m = metaCache.get(item.findingId)!;
      itemDept = m.department;
      itemShift = m.shift;
      if (dept && itemDept !== dept) continue;
      if (shift && itemShift !== shift) continue;
    }

    matches.push({ findingId: item.findingId, owner: item.owner, department: itemDept, shift: itemShift, date });
  }

  let deleted = 0;
  if (!opts.dryRun) {
    for (const m of matches) {
      await deleteStored("manager-queue", orgId, m.findingId);
      deleted++;
    }
  }

  return { total: items.length, matched: matches.length, deleted, dryRun: !!opts.dryRun, sample: matches.slice(0, 50) };
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

  // Manager gamification — fire-and-forget. Latency = arrival → submit;
  // sub-24h triggers the same-day XP bonus + 24h badge counters.
  void import("@gamification/domain/business/gamification-lane/mod.ts")
    .then(({ awardForCompletion }) =>
      awardForCompletion({
        orgId, email: username, role: "manager",
        remediationLatencyMs: existing.addedAt ? Math.max(0, remediatedAt - existing.addedAt) : undefined,
      })
    )
    .catch((err) => console.error(`[MANAGER] ${findingId}: gamification lane import failed:`, err));

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
