/** Per-question failure counters. Lets the admin "Question Failures"
 *  report answer "how many audits failed Q12 in May" without scanning every
 *  finding's answeredQuestions array.
 *
 *  Counter doc layout — collection `question-fail-stat`, keyed by
 *  [configKey, questionKey, yyyymm]:
 *
 *    {
 *      configKey: string,        // qlabConfig name OR destinationId OR "default"
 *      questionKey: string,      // normalized header (lowercase, alnum-slugged)
 *      headerSample: string,     // one verbatim header for display
 *      yyyymm: string,           // bucket month (UTC)
 *      failed: number,           // count of "No"/non-compliant verdicts
 *      flippedToPass: number,    // reviewer/admin/judge flipped fail → pass
 *      flippedToFail: number,    // reviewer/admin flipped pass → fail
 *      sampleFindingIds: string[],   // ring buffer, last 10
 *      lastFailedAt?: number,
 *    }
 *
 *  Reads/writes use the existing getStored/setStored. No new index needed —
 *  reads are by exact (configKey, questionKey, month) tuple, and the range
 *  endpoint reads N month buckets in a loop. */
import { getStored, setStored, listStoredWithKeys, deleteStored } from "@core/data/firestore/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

export interface QuestionFailStat {
  configKey: string;
  questionKey: string;
  headerSample: string;
  yyyymm: string;
  failed: number;
  flippedToPass: number;
  flippedToFail: number;
  sampleFindingIds: string[];
  lastFailedAt?: number;
}

const SAMPLE_RING_SIZE = 10;

/** Normalize an arbitrary question header into a stable key. Question headers
 *  aren't stably-ID'd (review-matching uses (header, populated) text pairs),
 *  so we slug the header. Two configs sharing identical headers will roll
 *  up to the same questionKey under that config — correct semantic. */
export function normalizeQuestionKey(header: string): string {
  return String(header ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "_unknown_";
}

/** Pick the configKey for a finding. Question Lab audits set `qlabConfig`
 *  (a name); QB audits set `record.RelatedDestinationId`. Either is fine
 *  as long as it's stable per audit-type. Fallback is "default". */
export function configKeyForFinding(finding: Record<string, any>): string {
  const ql = finding?.qlabConfig;
  if (typeof ql === "string" && ql.trim()) return `ql:${ql.trim()}`;
  const dest = finding?.record?.RelatedDestinationId;
  if (dest != null && String(dest).trim()) return `qb:${String(dest).trim()}`;
  return "default";
}

export function yyyymm(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function emptyStat(configKey: string, questionKey: string, header: string, month: string): QuestionFailStat {
  return {
    configKey, questionKey,
    headerSample: header,
    yyyymm: month,
    failed: 0, flippedToPass: 0, flippedToFail: 0,
    sampleFindingIds: [],
  };
}

async function readOrInit(orgId: OrgId, configKey: string, questionKey: string, header: string, month: string): Promise<QuestionFailStat> {
  const cur = await getStored<QuestionFailStat>("question-fail-stat", orgId, configKey, questionKey, month);
  if (cur) {
    // Refresh headerSample lazily — if a question got renamed, the latest
    // wins. We don't track history; sampleFindingIds is the audit trail.
    if (header && header !== cur.headerSample) cur.headerSample = header;
    return cur;
  }
  return emptyStat(configKey, questionKey, header, month);
}

async function persist(orgId: OrgId, stat: QuestionFailStat): Promise<void> {
  await setStored("question-fail-stat", orgId, [stat.configKey, stat.questionKey, stat.yyyymm], stat);
}

function pushSample(stat: QuestionFailStat, findingId: string): void {
  // Ring buffer: keep most-recent SAMPLE_RING_SIZE distinct findingIds.
  const existing = stat.sampleFindingIds.filter((id) => id !== findingId);
  existing.push(findingId);
  stat.sampleFindingIds = existing.slice(-SAMPLE_RING_SIZE);
}

export async function incrFailed(orgId: OrgId, configKey: string, header: string, findingId: string, completedAt: number): Promise<void> {
  const month = yyyymm(completedAt);
  const qKey = normalizeQuestionKey(header);
  const stat = await readOrInit(orgId, configKey, qKey, header, month);
  stat.failed += 1;
  stat.lastFailedAt = completedAt;
  pushSample(stat, findingId);
  await persist(orgId, stat);
}

export async function incrFlipToPass(orgId: OrgId, configKey: string, header: string, findingId: string, when: number): Promise<void> {
  const month = yyyymm(when);
  const qKey = normalizeQuestionKey(header);
  const stat = await readOrInit(orgId, configKey, qKey, header, month);
  stat.flippedToPass += 1;
  // Decrement the parallel `failed` count because finalize already added it
  // when the verdict was written. The flip means it shouldn't have counted
  // in the first place. Floor at 0 — guard against double-flip races.
  if (stat.failed > 0) stat.failed -= 1;
  await persist(orgId, stat);
}

export async function incrFlipToFail(orgId: OrgId, configKey: string, header: string, findingId: string, when: number): Promise<void> {
  const month = yyyymm(when);
  const qKey = normalizeQuestionKey(header);
  const stat = await readOrInit(orgId, configKey, qKey, header, month);
  stat.flippedToFail += 1;
  // Symmetric: flipping pass → fail bumps the failed count (it should have
  // counted in the first place).
  stat.failed += 1;
  stat.lastFailedAt = when;
  pushSample(stat, findingId);
  await persist(orgId, stat);
}

export interface QuestionFailRow {
  configKey: string;
  questionKey: string;
  headerSample: string;
  failed: number;        // net failures (already accounts for flipped-to-pass)
  flippedToPass: number;
  flippedToFail: number;
  netFailRate: number;   // (failed - flippedToPass) / failed*100, 0 if no fails
  sampleFindingIds: string[];
  lastFailedAt: number | null;
  months: string[];      // which yyyymm buckets contributed
}

/** Read counter docs across a month range. Bounded reads — N months × question
 *  buckets seen. Aggregates buckets per (configKey, questionKey) so the UI
 *  can show one row per question across the range. */
export async function readQuestionFailRange(
  orgId: OrgId,
  fromMonth: string,
  toMonth: string,
  filter?: { configKey?: string },
): Promise<QuestionFailRow[]> {
  // listStoredWithKeys scans the whole collection for the org — we filter
  // in-memory by month range. The collection is small (one doc per
  // (configKey, questionKey, month) tuple — typically < few thousand even
  // after a year of activity), so this is fast and avoids a new index.
  const all = await listStoredWithKeys<QuestionFailStat>("question-fail-stat", orgId);
  const agg = new Map<string, QuestionFailRow>();
  for (const { value } of all) {
    if (!value) continue;
    if (filter?.configKey && value.configKey !== filter.configKey) continue;
    if (value.yyyymm < fromMonth || value.yyyymm > toMonth) continue;
    const k = `${value.configKey}::${value.questionKey}`;
    const cur = agg.get(k) ?? {
      configKey: value.configKey,
      questionKey: value.questionKey,
      headerSample: value.headerSample,
      failed: 0, flippedToPass: 0, flippedToFail: 0, netFailRate: 0,
      sampleFindingIds: [],
      lastFailedAt: null,
      months: [],
    };
    cur.failed += value.failed;
    cur.flippedToPass += value.flippedToPass;
    cur.flippedToFail += value.flippedToFail;
    // Merge sample ring buffers (dedupe, keep most recent).
    const merged = [...cur.sampleFindingIds];
    for (const fid of value.sampleFindingIds) {
      if (!merged.includes(fid)) merged.push(fid);
    }
    cur.sampleFindingIds = merged.slice(-SAMPLE_RING_SIZE);
    if (value.lastFailedAt && (cur.lastFailedAt == null || value.lastFailedAt > cur.lastFailedAt)) {
      cur.lastFailedAt = value.lastFailedAt;
    }
    if (!cur.months.includes(value.yyyymm)) cur.months.push(value.yyyymm);
    // Header sample: prefer the bucket with the most recent activity. Keep
    // the latest non-empty value.
    if (value.headerSample) cur.headerSample = value.headerSample;
    agg.set(k, cur);
  }
  const rows = [...agg.values()];
  for (const r of rows) {
    r.netFailRate = r.failed > 0 ? Math.round(((r.failed - 0) / Math.max(1, r.failed + r.flippedToPass)) * 100) : 0;
    r.months.sort();
  }
  rows.sort((a, b) => b.failed - a.failed);
  return rows;
}

/** Backfill: wipe + rebuild counter docs for the month buckets touched by a
 *  range of audit-done-idx entries. Idempotent — re-running over the same
 *  range yields the same totals. Called from an admin Maintenance button. */
export async function deleteBucketsForMonths(orgId: OrgId, months: string[]): Promise<number> {
  if (!months.length) return 0;
  let deleted = 0;
  const rows = await listStoredWithKeys<QuestionFailStat>("question-fail-stat", orgId);
  const monthSet = new Set(months);
  for (const { key, value } of rows) {
    if (!value) continue;
    if (monthSet.has(value.yyyymm)) {
      await deleteStored("question-fail-stat", orgId, ...key);
      deleted++;
    }
  }
  return deleted;
}
