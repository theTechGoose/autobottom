/** Admin backfill business logic — reconcile stale indices/dimensions without
 *  re-running the audit pipeline. Firestore-backed. */

import {
  getStored, setStored, deleteStored,
  listStored, listStoredWithKeys, listStoredByCompletedAtWithKeys, listAllStoredByOrg,
} from "@core/data/firestore/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";
import type { AuditDoneIndexEntry, WireDeductionEntry, ChargebackEntry } from "@core/dto/types.ts";
import { getFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { writeAuditDoneIndex } from "@audit/domain/data/stats-repository/mod.ts";
import { getPartnerDimensions } from "@admin/domain/data/admin-repository/mod.ts";

const AUDIT_INDEX_BACKFILL_PAGE = 100;
const PARTNER_BACKFILL_BATCH = 100;

function padTs(ts: number): string { return String(ts).padStart(15, "0"); }

// ── Backfill review scores into completed-audit-stat ─────────────────────────

export async function backfillReviewScores(
  orgId: OrgId,
  since: number,
  until: number,
): Promise<{ scanned: number; updated: number }> {
  let scanned = 0, updated = 0;
  // Server-side range filter on ts — returns only rows in the requested
  // window. Was listStoredWithKeys (capped at 1000 rows, silently
  // truncating large windows). Compare verified equivalence: 9526/9526
  // on a 30-day window with zero missing-field.
  const rows = await listStoredByCompletedAtWithKeys<Record<string, unknown>>(
    "completed-audit-stat", orgId, since, until, { fieldName: "ts", limit: 50_000 },
  );
  for (const { key, value: v } of rows) {
    scanned++;
    const findingId = v.findingId as string | undefined;
    if (!findingId) continue;
    const finding = await getFinding(orgId, findingId);
    const reviewScore = (finding as Record<string, unknown> | null)?.reviewScore as number | undefined;
    if (reviewScore !== undefined && reviewScore !== v.score) {
      await setStored("completed-audit-stat", orgId, key, { ...v, score: reviewScore });
      updated++;
      console.log(`[BACKFILL-REVIEW-SCORES] ${findingId}: ${v.score}% → ${reviewScore}%`);
    }
  }
  return { scanned, updated };
}

// ── Backfill audit-done-idx with voName/owner/dept/shift ─────────────────────

/** Walk audit-done-idx (one page at a time via offset cursor). */
export async function backfillAuditDoneIndex(
  orgId: OrgId,
  cursor?: string,
): Promise<{ scanned: number; updated: number; cursor: string | null; done: boolean }> {
  const all = await listStored<AuditDoneIndexEntry>("audit-done-idx", orgId);
  const offset = cursor ? Number(cursor) : 0;
  const page = all.slice(offset, offset + AUDIT_INDEX_BACKFILL_PAGE);
  const done = offset + page.length >= all.length;
  const nextCursor = done ? null : String(offset + page.length);

  const toUpdate = page.filter((e) => e.voName === undefined && e.owner === undefined);
  let updated = 0;
  for (const entry of toUpdate) {
    const finding = await getFinding(orgId, entry.findingId);
    if (!finding) continue;
    const rec = finding.record as Record<string, unknown> | undefined;
    const isPackage = finding.recordingIdField === "GenieNumber";
    const rawVo = String(rec?.VoName ?? "");
    const voName = rawVo.includes(" - ")
      ? rawVo.split(" - ").slice(1).join(" - ").trim()
      : rawVo.trim() || undefined;
    const department = String(
      isPackage ? (rec?.OfficeName ?? "") : (rec?.ActivatingOffice ?? ""),
    ) || undefined;
    const shift = isPackage ? undefined : String(rec?.Shift ?? "") || undefined;
    await writeAuditDoneIndex(orgId, {
      ...entry,
      isPackage,
      voName: voName || undefined,
      owner: finding.owner as string | undefined,
      department,
      shift,
      startedAt: entry.startedAt ?? (finding.startedAt as number | undefined),
    });
    updated++;
  }

  return { scanned: page.length, updated, cursor: nextCursor, done };
}

// ── Backfill stale scores ────────────────────────────────────────────────────

export async function backfillStaleScores(
  orgId: OrgId,
  cursor?: string,
): Promise<{ scanned: number; updated: number; cursor: string | null; done: boolean }> {
  const all = await listStored<AuditDoneIndexEntry>("audit-done-idx", orgId);
  const offset = cursor ? Number(cursor) : 0;
  const page = all.slice(offset, offset + 50);
  const done = offset + page.length >= all.length;
  const nextCursor = done ? null : String(offset + page.length);

  let scanned = 0, updated = 0;
  for (const entry of page) {
    scanned++;
    const finding = await getFinding(orgId, entry.findingId);
    if (!finding || (finding as Record<string, unknown>).reAuditedAt) {
      await deleteStored("audit-done-idx", orgId, padTs(entry.completedAt), entry.findingId);
      updated++;
      console.log(
        `[BACKFILL-SCORES] ${entry.findingId}: deleted index entry (${!finding ? "finding not found" : "re-audited"})`,
      );
      continue;
    }
    const reviewScore = (finding as Record<string, unknown>).reviewScore as number | undefined;
    const actualScore = reviewScore ?? (finding.answeredQuestions?.length
      ? Math.round(
        (finding.answeredQuestions.filter((q: any) => q.answer === "Yes").length /
          finding.answeredQuestions.length) * 100,
      )
      : undefined);
    const answers = finding.answeredQuestions as any[] ?? [];
    const reviewerEmail = answers.find((a: any) => a.reviewedBy)?.reviewedBy as string | undefined;

    const scoreMismatch = actualScore !== undefined && actualScore !== entry.score;
    const missingReviewer = !entry.reviewedBy && reviewerEmail;
    if (!scoreMismatch && !missingReviewer) continue;

    const rec = (finding as any).record as Record<string, any> ?? {};
    const isPackage = finding.recordingIdField === "GenieNumber";
    const rawVo = String(rec.VoName ?? "");
    const voName = rawVo.includes(" - ")
      ? rawVo.split(" - ").slice(1).join(" - ").trim()
      : rawVo.trim();
    await writeAuditDoneIndex(orgId, {
      ...entry,
      score: actualScore ?? entry.score,
      isPackage,
      voName: voName || undefined,
      owner: finding.owner as string | undefined,
      department:
        String(isPackage ? (rec.OfficeName ?? "") : (rec.ActivatingOffice ?? "")) || undefined,
      shift: isPackage ? undefined : String(rec.Shift ?? "") || undefined,
      startedAt: entry.startedAt ?? (finding as any).startedAt,
      durationMs: entry.durationMs ?? (finding as any).durationMs,
      reviewedBy: reviewerEmail ?? entry.reviewedBy,
    });

    // Whenever we stamp reviewedBy onto the index from a per-question
    // pencil-flip stamp, also write the review-done sentinel so the
    // sentinel-based getReviewedFindingIds query agrees with what we just
    // put on the index. Without this, the Reviewed column on /admin/audits
    // shows "—" even though the Auditor column shows the reviewer email.
    // Idempotent — skip if review-done already exists.
    const newReviewer = reviewerEmail ?? entry.reviewedBy;
    if (newReviewer) {
      const existingDone = await getStored<{ reviewedAt?: string }>("review-done", orgId, entry.findingId);
      if (!existingDone) {
        await setStored("review-done", orgId, [entry.findingId], {
          reviewedAt: new Date().toISOString(),
          reviewScore: actualScore ?? entry.score,
          reviewedBy: newReviewer,
        });
      }
    }
    updated++;
  }

  return { scanned, updated, cursor: nextCursor, done };
}

// ── Reconcile reviewedBy / review-done divergence across the org ─────────────
//
// One-shot pass for historical data — every audit-done-idx entry with a
// reviewedBy gets a matching review-done sentinel (and vice versa). Closes
// the divergence introduced by the gap between adminFlipQuestion / admin-
// FlipFinding / finalizePerfectFinding (write review-done, skipped
// reviewedBy on the index) and backfillScores (wrote reviewedBy on the
// index, skipped review-done). New write paths now write both signals; this
// helper backfills the legacy data so /admin/audits stops showing the
// "aknight / —" or "api (dim) / ✓ Reviewed" mismatches.
//
// Idempotent — re-runs are no-ops once both stores agree.
export async function reconcileReviewedSignals(
  orgId: OrgId,
): Promise<{ scanned: number; sentinelsWritten: number; indexUpdates: number }> {
  const entries = await listStoredWithKeys<AuditDoneIndexEntry>("audit-done-idx", orgId);
  let scanned = 0;
  let sentinelsWritten = 0;
  let indexUpdates = 0;
  for (const { key, value: entry } of entries) {
    scanned++;
    if (!entry?.findingId) continue;

    const indexHasReviewer = !!entry.reviewedBy;
    const sentinel = await getStored<{ reviewedAt?: string; reviewScore?: number; reviewedBy?: string }>(
      "review-done", orgId, entry.findingId,
    );
    const sentinelExists = !!sentinel;

    // Case 1: index says someone reviewed it, sentinel missing → write the sentinel.
    if (indexHasReviewer && !sentinelExists) {
      await setStored("review-done", orgId, [entry.findingId], {
        reviewedAt: new Date(entry.doneAt ?? entry.completedAt ?? Date.now()).toISOString(),
        reviewScore: entry.score,
        reviewedBy: entry.reviewedBy,
      });
      sentinelsWritten++;
      continue;
    }

    // Case 2: sentinel says reviewed but index has no reviewedBy → stamp the
    // reviewer from the sentinel onto the index.
    if (sentinelExists && !indexHasReviewer && sentinel?.reviewedBy) {
      await setStored("audit-done-idx", orgId, key, { ...entry, reviewedBy: sentinel.reviewedBy });
      indexUpdates++;
    }
  }
  console.log(`🔧 [RECONCILE-REVIEWED] org=${orgId} scanned=${scanned} sentinelsWritten=${sentinelsWritten} indexUpdates=${indexUpdates}`);
  return { scanned, sentinelsWritten, indexUpdates };
}

// ── Backfill partner dimensions from finished findings ───────────────────────

export async function backfillPartnerDimensions(
  orgId: OrgId,
  cursor?: string,
): Promise<{ scanned: number; saved: number; cursor: string | null; done: boolean }> {
  // Walk audit-finding header docs (key.length === 1) — chunked storage
  // doesn't matter for finding-id discovery; we re-fetch via getFinding.
  const allDocs = await listStoredWithKeys<unknown>("audit-finding", orgId);
  const findingIdsSet = new Set<string>();
  for (const { key } of allDocs) {
    if (key.length === 1) findingIdsSet.add(String(key[0]));
  }
  const findingIds = Array.from(findingIdsSet);

  const offset = cursor ? Number(cursor) : 0;
  const page = findingIds.slice(offset, offset + PARTNER_BACKFILL_BATCH);
  const done = offset + page.length >= findingIds.length;
  const nextCursor = done ? null : String(offset + page.length);

  const dims = await getPartnerDimensions(orgId);
  let scanned = 0, saved = 0;

  for (const findingId of page) {
    const finding = await getFinding(orgId, findingId);
    scanned++;
    if (!finding || finding.recordingIdField !== "GenieNumber") continue;
    const rec = finding.record as any ?? {};
    if (!rec.OfficeName || !rec.GmEmail) continue;

    const officeName = String(rec.OfficeName);
    const incoming = String(rec.GmEmail).split(";").map((e: string) => e.trim()).filter(Boolean);
    const existing = dims.offices[officeName] ?? [];
    const merged = [...existing];
    let changed = false;
    for (const email of incoming) {
      if (!merged.includes(email)) { merged.push(email); changed = true; }
    }
    if (changed) { dims.offices[officeName] = merged.sort(); saved++; }
  }

  await setStored("partner-dimensions-config", orgId, [], dims);
  return { scanned, saved, cursor: nextCursor, done };
}

// ── Purge old entries by date range ──────────────────────────────────────────

export async function purgeOldEntries(
  orgId: OrgId,
  since: number,
  before: number,
): Promise<{ completed: number; chargebacks: number; wire: number }> {
  // Server-side ts-range filter against each of the three stores.
  // Compare verified equivalence per store: 9526/9526 completed-audit-stat,
  // 5294/5294 chargeback-entry, 391/391 wire-deduction-entry; all with
  // zero missing-field. Removes the silent 1000-row truncation that
  // hit the brute-force scan on big purge windows.
  const purgeOne = async <T extends { ts?: number }>(type: string): Promise<number> => {
    let deleted = 0;
    const rows = await listStoredByCompletedAtWithKeys<T>(type, orgId, since, before, {
      fieldName: "ts",
      limit: 100_000,
    });
    for (const { key } of rows) {
      await deleteStored(type, orgId, ...key);
      deleted++;
    }
    return deleted;
  };

  const [completed, chargebacks, wire] = await Promise.all([
    purgeOne<{ ts?: number }>("completed-audit-stat"),
    purgeOne<ChargebackEntry>("chargeback-entry"),
    purgeOne<WireDeductionEntry>("wire-deduction-entry"),
  ]);

  return { completed, chargebacks, wire };
}

// ── Purge bypassed offices' wire deductions ──────────────────────────────────

export async function purgeBypassedWireDeductions(
  orgId: OrgId,
  patterns: string[],
): Promise<{ deleted: number; kept: number }> {
  let deleted = 0, kept = 0;
  const rows = await listStoredWithKeys<WireDeductionEntry>("wire-deduction-entry", orgId);
  for (const { key, value } of rows) {
    const office = (value.office ?? "").toLowerCase();
    const isBypassed = patterns.length > 0 && patterns.some((p) => office.includes(p.toLowerCase()));
    if (isBypassed) {
      await deleteStored("wire-deduction-entry", orgId, ...key);
      deleted++;
    } else {
      kept++;
    }
  }
  return { deleted, kept };
}

// ── Wipe org — DESTRUCTIVE, requires explicit confirmation ──────────────────

/** Delete every Firestore doc belonging to this org. Requires
 *  `confirm === "YES"` from the caller. Endpoint name kept as wipeKv for
 *  backwards compatibility with existing /admin/wipe-state routes. */
export async function wipeKv(
  orgId: OrgId,
  confirm: string,
): Promise<{ ok: boolean; deleted?: number; error?: string }> {
  if (confirm !== "YES") {
    return { ok: false, error: "wipe requires { confirm: \"YES\" } — refused" };
  }
  const rows = await listAllStoredByOrg(orgId);
  let deleted = 0;
  for (const { id } of rows) {
    const { deleteDoc } = await import("@core/data/firestore/mod.ts");
    await deleteDoc(id);
    deleted++;
  }
  console.log(`[WIPE] 💣 org=${orgId} deleted=${deleted} docs`);
  return { ok: true, deleted };
}

// ── Dump / Import ───────────────────────────────────────────────────────────

export interface KvDumpEntry {
  type: string;
  org: string;
  key: string[];
  value: unknown;
}

/** Dump every Firestore doc under this org. Caller is responsible for size. */
export async function dumpKv(orgId: OrgId): Promise<{ entries: KvDumpEntry[]; count: number }> {
  const rows = await listAllStoredByOrg(orgId);
  const entries: KvDumpEntry[] = [];
  for (const { body } of rows) {
    const { _type, _org, _key, _updatedAt: _u, _expiresAt: _e, ...rest } = body;
    const value = "_value" in rest ? (rest as { _value: unknown })._value : rest;
    entries.push({ type: String(_type), org: String(_org), key: Array.isArray(_key) ? _key.map(String) : [], value });
  }
  return { entries, count: entries.length };
}

/** Restore entries produced by dumpKv. Requires confirm==="YES". */
export async function importKv(
  orgId: OrgId,
  confirm: string,
  entries: KvDumpEntry[],
): Promise<{ ok: boolean; written?: number; skipped?: number; error?: string }> {
  if (confirm !== "YES") {
    return { ok: false, error: "import requires { confirm: \"YES\" } — refused" };
  }
  if (!Array.isArray(entries)) return { ok: false, error: "entries must be an array" };
  let written = 0, skipped = 0;
  for (const e of entries) {
    if (!e?.type || e.org !== orgId || !Array.isArray(e.key)) { skipped++; continue; }
    await setStored(e.type, orgId, e.key, e.value);
    written++;
  }
  console.log(`[IMPORT] org=${orgId} written=${written} skipped=${skipped}`);
  return { ok: true, written, skipped };
}
