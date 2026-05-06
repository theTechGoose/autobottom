/** Admin backfill business logic — reconcile stale indices/dimensions without
 *  re-running the audit pipeline. Firestore-backed. */

import {
  getStored, setStored, deleteStored,
  listStored, listStoredWithKeys, listAllStoredByOrg,
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
  const rows = await listStoredWithKeys<Record<string, unknown>>("completed-audit-stat", orgId);
  for (const { key, value: v } of rows) {
    const ts = (v.ts as number) ?? 0;
    if (ts < since || ts > until) continue;
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
    updated++;
  }

  return { scanned, updated, cursor: nextCursor, done };
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
  let completedDeleted = 0, cbDeleted = 0, wireDeleted = 0;

  const completed = await listStoredWithKeys<{ ts?: number }>("completed-audit-stat", orgId);
  for (const { key, value } of completed) {
    const ts = value?.ts ?? 0;
    if (ts >= since && ts <= before) {
      await deleteStored("completed-audit-stat", orgId, ...key);
      completedDeleted++;
    }
  }

  const cbRows = await listStoredWithKeys<ChargebackEntry>("chargeback-entry", orgId);
  for (const { key, value } of cbRows) {
    if (value.ts >= since && value.ts <= before) {
      await deleteStored("chargeback-entry", orgId, ...key);
      cbDeleted++;
    }
  }

  const wireRows = await listStoredWithKeys<WireDeductionEntry>("wire-deduction-entry", orgId);
  for (const { key, value } of wireRows) {
    if (value.ts >= since && value.ts <= before) {
      await deleteStored("wire-deduction-entry", orgId, ...key);
      wireDeleted++;
    }
  }

  return { completed: completedDeleted, chargebacks: cbDeleted, wire: wireDeleted };
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
