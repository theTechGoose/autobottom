/** Admin backfill business logic — reconcile stale indices/dimensions without
 *  re-running the audit pipeline. Ported from main:lib/kv.ts. */

import { getKv, orgKey } from "@core/data/deno-kv/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";
import type { AuditDoneIndexEntry, WireDeductionEntry, ChargebackEntry } from "@core/dto/types.ts";
import { getFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { writeAuditDoneIndex } from "@audit/domain/data/stats-repository/mod.ts";
import { getPartnerDimensions } from "@admin/domain/data/admin-repository/mod.ts";

const AUDIT_INDEX_BACKFILL_PAGE = 100;
const PARTNER_BACKFILL_BATCH = 100;

function padTs(ts: number): string { return String(ts).padStart(15, "0"); }

// ── Backfill review scores into completed-audit-stat ─────────────────────────

/** Compare each completed-audit-stat entry in [since, until] to the finding's
 *  current reviewScore; rewrite the stat if drifted. Main:lib/kv.ts:444-462. */
export async function backfillReviewScores(
  orgId: OrgId,
  since: number,
  until: number,
): Promise<{ scanned: number; updated: number }> {
  const db = await getKv();
  let scanned = 0, updated = 0;

  for await (const entry of db.list<Record<string, unknown>>({
    prefix: orgKey(orgId, "completed-audit-stat"),
  })) {
    const v = entry.value;
    const ts = (v.ts as number) ?? 0;
    if (ts < since || ts > until) continue;
    scanned++;
    const findingId = v.findingId as string | undefined;
    if (!findingId) continue;
    const finding = await getFinding(orgId, findingId);
    const reviewScore = (finding as Record<string, unknown> | null)?.reviewScore as number | undefined;
    if (reviewScore !== undefined && reviewScore !== v.score) {
      await db.set(entry.key, { ...v, score: reviewScore });
      updated++;
      console.log(`[BACKFILL-REVIEW-SCORES] ${findingId}: ${v.score}% → ${reviewScore}%`);
    }
  }

  return { scanned, updated };
}

// ── Backfill audit-done-idx with voName/owner/dept/shift ─────────────────────

/** Walk audit-done-idx, enrich any entries missing voName/owner by looking up
 *  the backing finding. Paginated via Deno.KvListIterator cursor. */
export async function backfillAuditDoneIndex(
  orgId: OrgId,
  cursor?: string,
): Promise<{ scanned: number; updated: number; cursor: string | null; done: boolean }> {
  const db = await getKv();
  const iter = db.list<AuditDoneIndexEntry>(
    { prefix: orgKey(orgId, "audit-done-idx") },
    cursor ? { cursor } : {},
  );

  const page: AuditDoneIndexEntry[] = [];
  for await (const entry of iter) {
    if (entry.value) page.push(entry.value);
    if (page.length >= AUDIT_INDEX_BACKFILL_PAGE) break;
  }

  const done = page.length < AUDIT_INDEX_BACKFILL_PAGE;
  const nextCursor = done ? null : iter.cursor;
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

/** Iterate audit-done-idx, detect score drift vs finding.reviewScore, rewrite
 *  or delete orphaned index entries. Main:lib/kv.ts:1042-1130. */
export async function backfillStaleScores(
  orgId: OrgId,
  cursor?: string,
): Promise<{ scanned: number; updated: number; cursor: string | null; done: boolean }> {
  const db = await getKv();
  const iter = db.list<AuditDoneIndexEntry>(
    { prefix: orgKey(orgId, "audit-done-idx") },
    cursor ? { cursor } : {},
  );

  const page: Array<{ entry: AuditDoneIndexEntry; key: Deno.KvKey }> = [];
  for await (const entry of iter) {
    if (entry.value) page.push({ entry: entry.value, key: entry.key });
    if (page.length >= 50) break;
  }

  const done = page.length < 50;
  const nextCursor = done ? null : iter.cursor;

  let scanned = 0, updated = 0;
  for (const { entry } of page) {
    scanned++;
    const finding = await getFinding(orgId, entry.findingId);
    if (!finding || (finding as Record<string, unknown>).reAuditedAt) {
      await db.delete(orgKey(orgId, "audit-done-idx", padTs(entry.completedAt), entry.findingId));
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

/** Walk audit-finding storage, for package audits extract OfficeName/GmEmail
 *  and merge into partner-dimensions. Paginated. Main:lib/kv.ts:1350-1395. */
export async function backfillPartnerDimensions(
  orgId: OrgId,
  cursor?: string,
): Promise<{ scanned: number; saved: number; cursor: string | null; done: boolean }> {
  const db = await getKv();
  const prefix = orgKey(orgId, "audit-finding");

  // audit-finding entries are chunked: key = [orgId, "audit-finding", findingId, chunkIndexOrMeta]
  // Collect unique findingIds (up to PARTNER_BACKFILL_BATCH) to process this page
  const findingIds: string[] = [];
  const seen = new Set<string>();
  const iter = db.list({ prefix }, cursor ? { cursor } : {});
  for await (const entry of iter) {
    const key = entry.key as Deno.KvKey;
    if (key.length < 3) continue;
    const fid = key[2] as string;
    if (seen.has(fid)) continue;
    seen.add(fid);
    findingIds.push(fid);
    if (findingIds.length >= PARTNER_BACKFILL_BATCH) break;
  }

  const done = findingIds.length < PARTNER_BACKFILL_BATCH;
  const nextCursor = done ? null : iter.cursor;

  const dims = await getPartnerDimensions(orgId);
  let scanned = 0, saved = 0;

  for (const findingId of findingIds) {
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

  // Single write of the merged dimensions for this page
  await db.set(orgKey(orgId, "partner-dimensions"), dims);
  return { scanned, saved, cursor: nextCursor, done };
}

// ── Purge old entries by date range ──────────────────────────────────────────

/** Delete completed-audit-stat, chargeback, and wire entries with ts in
 *  [since, before]. Port of main:lib/kv.ts:365-398. */
export async function purgeOldEntries(
  orgId: OrgId,
  since: number,
  before: number,
): Promise<{ completed: number; chargebacks: number; wire: number }> {
  const db = await getKv();
  let completedDeleted = 0, cbDeleted = 0, wireDeleted = 0;

  for await (const entry of db.list<{ ts?: number }>({
    prefix: orgKey(orgId, "completed-audit-stat"),
  })) {
    const ts = entry.value?.ts ?? 0;
    if (ts >= since && ts <= before) {
      await db.delete(entry.key);
      completedDeleted++;
    }
  }
  for await (const entry of db.list<ChargebackEntry>({
    prefix: orgKey(orgId, "chargeback-entry"),
  })) {
    if (entry.value.ts >= since && entry.value.ts <= before) {
      await db.delete(entry.key);
      cbDeleted++;
    }
  }
  for await (const entry of db.list<WireDeductionEntry>({
    prefix: orgKey(orgId, "wire-deduction-entry"),
  })) {
    if (entry.value.ts >= since && entry.value.ts <= before) {
      await db.delete(entry.key);
      wireDeleted++;
    }
  }

  return { completed: completedDeleted, chargebacks: cbDeleted, wire: wireDeleted };
}

// ── Purge bypassed offices' wire deductions ──────────────────────────────────

/** Iterate wire-deduction-entry and delete ones whose office matches any
 *  bypass pattern (case-insensitive contains). Port of main:lib/kv.ts:323-342. */
export async function purgeBypassedWireDeductions(
  orgId: OrgId,
  patterns: string[],
): Promise<{ deleted: number; kept: number }> {
  const db = await getKv();
  let deleted = 0, kept = 0;
  for await (const entry of db.list<WireDeductionEntry>({
    prefix: orgKey(orgId, "wire-deduction-entry"),
  })) {
    const office = (entry.value.office ?? "").toLowerCase();
    const isBypassed =
      patterns.length > 0 && patterns.some((p) => office.includes(p.toLowerCase()));
    if (isBypassed) {
      await db.delete(entry.key);
      deleted++;
    } else {
      kept++;
    }
  }
  return { deleted, kept };
}

// ── Wipe KV — DESTRUCTIVE, requires explicit confirmation ────────────────────

/** Delete every key under this org's namespace. Requires `confirm === "YES"`
 *  from the caller — any other value refuses the request. Returns count of
 *  keys deleted across all prefixes. */
export async function wipeKv(
  orgId: OrgId,
  confirm: string,
): Promise<{ ok: boolean; deleted?: number; error?: string }> {
  if (confirm !== "YES") {
    return {
      ok: false,
      error: "wipe-kv requires { confirm: \"YES\" } — refused",
    };
  }
  const db = await getKv();
  let deleted = 0;
  // Iterate everything under [orgId, ...] and delete
  for await (const entry of db.list({ prefix: [orgId] })) {
    await db.delete(entry.key);
    deleted++;
  }
  console.log(`[WIPE-KV] 💣 org=${orgId} deleted=${deleted} keys`);
  return { ok: true, deleted };
}

// ── KV dump / import ─────────────────────────────────────────────────────────

export interface KvDumpEntry { key: Deno.KvKeyPart[]; value: unknown }

/** Dumps every KV entry under the org's prefix. Caller is responsible for
 *  size — large orgs can produce huge payloads. */
export async function dumpKv(orgId: OrgId): Promise<{ entries: KvDumpEntry[]; count: number }> {
  const db = await getKv();
  const entries: KvDumpEntry[] = [];
  for await (const entry of db.list({ prefix: [orgId] })) {
    entries.push({ key: entry.key as Deno.KvKeyPart[], value: entry.value });
  }
  return { entries, count: entries.length };
}

/** Restores entries from a dumpKv() output. Requires confirm==="YES". Will NOT
 *  wipe first — append-only restore (so test data can layer on top). Caller
 *  should call wipeKv first if they want a clean slate. */
export async function importKv(
  orgId: OrgId,
  confirm: string,
  entries: KvDumpEntry[],
): Promise<{ ok: boolean; written?: number; skipped?: number; error?: string }> {
  if (confirm !== "YES") {
    return { ok: false, error: "import-kv requires { confirm: \"YES\" } — refused" };
  }
  if (!Array.isArray(entries)) return { ok: false, error: "entries must be an array" };
  const db = await getKv();
  let written = 0, skipped = 0;
  for (const e of entries) {
    if (!Array.isArray(e?.key) || e.key.length === 0) { skipped++; continue; }
    if (e.key[0] !== orgId) { skipped++; continue; }  // safety: stay in target org
    await db.set(e.key as Deno.KvKey, e.value);
    written++;
  }
  console.log(`[IMPORT-KV] org=${orgId} written=${written} skipped=${skipped}`);
  return { ok: true, written, skipped };
}
