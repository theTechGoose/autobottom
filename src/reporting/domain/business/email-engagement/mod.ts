/** Audit-email engagement tracking — opens (prefetch-filtered) + clicks.
 *
 *  Evolved from the email-tracking spike. The audit-complete (terminate) email
 *  embeds an open-pixel and routes its links through a click tracker; both hit
 *  the public /track/* routes in main.ts, which call recordOpen/recordClick.
 *  We store one binary mark per finding (first open / first click) so a repeat
 *  open or a link-scanner's duplicate click can't inflate the metric.
 *
 *  Open filter: Gmail fetches the pixel on actual open (trackable); Apple Mail
 *  Privacy Protection prefetches at delivery (within seconds). So an open whose
 *  Δ-since-send is under OPEN_PREFETCH_WINDOW_MS is treated as a machine
 *  prefetch and NOT counted as a human open. (Confirmed empirically — see the
 *  plan file's FINDINGS.) */

import { getStored, setStored } from "@core/data/firestore/mod.ts";
import { queryAuditDoneIndex } from "@audit/domain/data/stats-repository/mod.ts";
import { getFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { getAppeal } from "@judge/domain/data/judge-repository/mod.ts";
import type { AppealRecord, AuditDoneIndexEntry } from "@core/dto/types.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

const MARK_TYPE = "audit-email-mark";

/** Opens arriving sooner than this after send are machine prefetch (Apple MPP),
 *  not human opens. Gmail opens land minutes+ later. */
export const OPEN_PREFETCH_WINDOW_MS = 10_000;

/** 1×1 fully-transparent GIF. Returned by the open-pixel route. */
export const TRANSPARENT_GIF: Uint8Array = Uint8Array.from(
  atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"),
  (c) => c.charCodeAt(0),
);

export interface EmailMark {
  findingId: string;
  sentAt?: number;
  openedAt?: number;
  openPrefetchAt?: number;
  firstClickAt?: number;
  // Most-recent open/click + source. Opens are usually fetched by the mail
  // provider's proxy (Gmail's GoogleImageProxy, Apple MPP), so lastOpenSource
  // is typically a proxy label, NOT the recipient's real browser. Clicks are
  // hit by the recipient's real browser, so lastClickSource is the real client.
  lastOpenAt?: number;
  openCount?: number;
  lastOpenSource?: string;
  lastOpenUa?: string;
  lastClickAt?: number;
  clickCount?: number;
  lastClickSource?: string;
  lastClickUa?: string;
}

/** Classify a User-Agent into a friendly source label. Email opens are usually
 *  proxied (Gmail → GoogleImageProxy, Yahoo → YahooMailProxy, Outlook); only
 *  clicks and non-proxied dev opens carry the real browser. */
export function classifyUa(ua: string): string {
  const s = (ua ?? "").trim();
  if (!s) return "Unknown";
  if (/GoogleImageProxy/i.test(s)) return "Gmail proxy";
  if (/YahooMailProxy/i.test(s)) return "Yahoo proxy";
  if (/Microsoft Office|MSOffice|Outlook|ms-office|Office\//i.test(s)) return "Outlook";
  if (/GoogleDocs|Google-Apps-Script|AHC|curl|wget|python-requests|HeadlessChrome/i.test(s)) return "Bot/agent";
  if (/Edg\//i.test(s)) return "Edge";
  if (/Firefox\//i.test(s) && !/Seamonkey/i.test(s)) return "Firefox";
  if (/Chrome\//i.test(s) && !/Chromium/i.test(s)) return "Chrome";
  if (/Safari\//i.test(s) && /Version\//i.test(s)) return "Safari";
  if (/Mozilla\//i.test(s)) return "Real browser";
  return "Other";
}

export interface EmailEngagement {
  total: number;
  sent: number;
  opened: number;
  clicked: number;
  appealed: number;
  appealedAmongOpened: number;
  appealedAmongClicked: number;
  openRate: number;
  clickRate: number;
  appealRateAll: number;
  appealRateOpened: number;
  appealRateClicked: number;
}

// ── Link signing (HMAC) ──────────────────────────────────────────────────────

function secret(): string { return Deno.env.get("TRACK_LINK_SECRET") ?? ""; }

async function hmacHex(msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

/** Sign a findingId for use in a tracked link. */
export function signFinding(findingId: string): Promise<string> {
  return hmacHex(findingId);
}

/** Verify a tracked-link signature. Degrades to `true` when TRACK_LINK_SECRET is
 *  unset (records without forgery protection) so a missing secret doesn't break
 *  tracking — it just removes the anti-forgery guard. */
export async function verifyFinding(findingId: string, sig: string): Promise<boolean> {
  if (!secret()) return true;
  const expected = await hmacHex(findingId);
  return constantTimeEq(expected, sig ?? "");
}

// ── Mark CRUD ────────────────────────────────────────────────────────────────

function getMark(orgId: OrgId, findingId: string): Promise<EmailMark | null> {
  return getStored<EmailMark>(MARK_TYPE, orgId, findingId);
}

function putMark(orgId: OrgId, mark: EmailMark): Promise<void> {
  return setStored(MARK_TYPE, orgId, [mark.findingId], mark);
}

/** Stamp that the audit-complete email was sent for this finding. */
export async function stampSent(orgId: OrgId, findingId: string): Promise<void> {
  try {
    const mark = (await getMark(orgId, findingId)) ?? { findingId };
    mark.sentAt = Date.now();
    await putMark(orgId, mark);
  } catch (err) {
    console.warn(`⚠️ [EMAIL-ENGAGE] stampSent failed (non-fatal) fid=${findingId}:`, err);
  }
}

/** Record an email open. Applies the prefetch filter; sets openedAt (first only)
 *  for human opens, openPrefetchAt for machine prefetch. Also tracks most-recent
 *  open time, total human-open count, and the source (from the User-Agent — see
 *  classifyUa; usually a proxy label, not the real browser). Best-effort. */
export async function recordOpen(orgId: OrgId, findingId: string, req: Request): Promise<void> {
  try {
    const now = Date.now();
    const ua = req.headers.get("user-agent") ?? "";
    const mark = (await getMark(orgId, findingId)) ?? { findingId };
    const sentAt = mark.sentAt ?? 0;
    const delta = sentAt ? now - sentAt : Infinity;
    if (sentAt && delta < OPEN_PREFETCH_WINDOW_MS) {
      if (!mark.openPrefetchAt) mark.openPrefetchAt = now;
      console.log(`📭 [EMAIL-OPEN] ${findingId} PREFETCH Δ=${delta}ms — not counted as open`);
    } else {
      if (!mark.openedAt) mark.openedAt = now;
      mark.lastOpenAt = now;
      mark.openCount = (mark.openCount ?? 0) + 1;
      mark.lastOpenSource = classifyUa(ua);
      mark.lastOpenUa = ua ? ua.slice(0, 300) : undefined;
      console.log(`📬 [EMAIL-OPEN] ${findingId} open #${mark.openCount} Δ=${sentAt ? `${delta}ms` : "unknown"} src=${mark.lastOpenSource}`);
    }
    await putMark(orgId, mark);
  } catch (err) {
    console.warn(`⚠️ [EMAIL-ENGAGE] recordOpen failed (non-fatal) fid=${findingId}:`, err);
  }
}

/** Record an email click. Keeps firstClickAt (binary, first only) and also tracks
 *  most-recent click + count + source. Clicks are hit by the recipient's real
 *  browser, so lastClickSource is the real client (not a proxy). Best-effort. */
export async function recordClick(orgId: OrgId, findingId: string, req: Request): Promise<void> {
  try {
    const now = Date.now();
    const ua = req.headers.get("user-agent") ?? "";
    const mark = (await getMark(orgId, findingId)) ?? { findingId };
    if (!mark.firstClickAt) mark.firstClickAt = now;
    mark.lastClickAt = now;
    mark.clickCount = (mark.clickCount ?? 0) + 1;
    mark.lastClickSource = classifyUa(ua);
    mark.lastClickUa = ua ? ua.slice(0, 300) : undefined;
    console.log(`🖱️ [EMAIL-CLICK] ${findingId} #${mark.clickCount} src=${mark.lastClickSource}`);
    await putMark(orgId, mark);
  } catch (err) {
    console.warn(`⚠️ [EMAIL-ENGAGE] recordClick failed (non-fatal) fid=${findingId}:`, err);
  }
}

// ── Engagement rollup ────────────────────────────────────────────────────────

function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : 0;
}

/** Pure tally over a cohort + its per-finding marks/appeals. Exported for tests. */
export function tallyEngagement(
  marks: Array<EmailMark | null>,
  appeals: Array<{ findingId: string } | null>,
): EmailEngagement {
  const total = marks.length;
  let sent = 0, opened = 0, clicked = 0, appealed = 0, appealedAmongOpened = 0, appealedAmongClicked = 0;
  for (let i = 0; i < total; i++) {
    const m = marks[i];
    const a = appeals[i];
    if (m?.sentAt) sent++;
    const isOpened = !!m?.openedAt;
    const isClicked = !!m?.firstClickAt;
    if (isOpened) opened++;
    if (isClicked) clicked++;
    if (a) {
      appealed++;
      if (isOpened) appealedAmongOpened++;
      if (isClicked) appealedAmongClicked++;
    }
  }
  return {
    total, sent, opened, clicked, appealed, appealedAmongOpened, appealedAmongClicked,
    openRate: pct(opened, sent),
    clickRate: pct(clicked, sent),
    appealRateAll: pct(appealed, total),
    appealRateOpened: pct(appealedAmongOpened, opened),
    appealRateClicked: pct(appealedAmongClicked, clicked),
  };
}

/** Compute engagement over the audits completed in [from, to]. Cohort comes from
 *  audit-done-idx; each finding's mark + appeal is hydrated in parallel. */
export async function getEmailEngagement(orgId: OrgId, from: number, to: number): Promise<EmailEngagement> {
  const entries = await queryAuditDoneIndex(orgId, from, to);
  const [marks, appeals] = await Promise.all([
    Promise.all(entries.map((e) => getMark(orgId, e.findingId).catch(() => null))),
    Promise.all(entries.map((e) => getAppeal(orgId, e.findingId).catch(() => null))),
  ]);
  return tallyEngagement(marks, appeals);
}

// ── Drill-down detail ─────────────────────────────────────────────────────────

/** One per-email row for the full-page drill-down. */
export interface EngagementRow {
  findingId: string;
  completedAt: number;
  voName?: string;
  department?: string;
  isPackage?: boolean;
  recordingId?: string;
  recordId?: string;
  score: number;
  sentAt?: number;
  openedAt?: number;
  openPrefetchAt?: number;
  firstClickAt?: number;
  appealStatus?: "pending" | "complete" | null;
  // Open/click recency + source (see EmailMark).
  lastOpenAt?: number;
  openCount?: number;
  lastOpenSource?: string;
  lastClickAt?: number;
  clickCount?: number;
  lastClickSource?: string;
}

/** A segment tally — the same engagement metrics scoped to one group. */
export type GroupTally = { key: string } & EmailEngagement;

export interface EmailEngagementDetail {
  aggregate: EmailEngagement;
  byDepartment: GroupTally[];
  byType: GroupTally[];
  rows: EngagementRow[];
  total: number;
  page: number;
  pages: number;
  /** Cohort size (audits completed in the window). */
  cohortSize: number;
  /** True when the cohort exceeded HYDRATE_CAP — only the visible page was
   *  hydrated, so the department breakdown reflects only what the index carried
   *  for the un-hydrated remainder. */
  hydrationCapped: boolean;
}

/** Finding-doc hydration is bounded. The audit-done-idx writer doesn't store
 *  department / VoName on most entries (they're back-filled lazily by the
 *  /admin/audits page), so an un-hydrated breakdown is ~all "Unknown". Small
 *  windows (Today / a month) hydrate the whole cohort for accurate department +
 *  team-member grouping; very large windows hydrate only the visible page (so
 *  the per-email table stays accurate) and set hydrationCapped. */
const HYDRATE_CAP = 2000;
const HYDRATE_CONCURRENCY = 25;

interface Enriched {
  e: AuditDoneIndexEntry;
  m: EmailMark | null;
  a: AppealRecord | null;
  voName?: string;
  department?: string;
  isPackage?: boolean;
  recordingId?: string;
}

/** Fill missing voName / department / isPackage / recordingId from the finding
 *  doc — mirrors the dashboard's hydrateMissing extraction (date-leg department =
 *  ActivatingOffice, package department = OfficeName). */
function enrichFromFinding(it: Enriched, f: Record<string, unknown> | null): void {
  if (!f) return;
  const rec = f.record as Record<string, unknown> | undefined;
  const isPkg = f.recordingIdField === "GenieNumber";
  const rawVo = String(rec?.VoName ?? "");
  const vo = rawVo.includes(" - ") ? rawVo.split(" - ").slice(1).join(" - ").trim() : rawVo.trim();
  it.isPackage = it.isPackage ?? isPkg;
  it.voName = it.voName || (vo || undefined);
  it.department = it.department || (String(isPkg ? (rec?.OfficeName ?? "") : (rec?.ActivatingOffice ?? "")) || undefined);
  it.recordingId = it.recordingId || (String(f.recordingId ?? "").trim() || undefined);
}

/** Fetch finding docs for the given ids in bounded-concurrency batches. */
async function hydrateFindings(orgId: OrgId, ids: string[]): Promise<Map<string, Record<string, unknown> | null>> {
  const map = new Map<string, Record<string, unknown> | null>();
  for (let i = 0; i < ids.length; i += HYDRATE_CONCURRENCY) {
    const slice = ids.slice(i, i + HYDRATE_CONCURRENCY);
    const docs = await Promise.all(slice.map((id) => getFinding(orgId, id).catch(() => null)));
    slice.forEach((id, j) => map.set(id, (docs[j] as Record<string, unknown> | null) ?? null));
  }
  return map;
}

function tallyGroup(key: string, group: Enriched[]): GroupTally {
  return { key, ...tallyEngagement(group.map((g) => g.m), group.map((g) => g.a)) };
}

function toRow(it: Enriched): EngagementRow {
  return {
    findingId: it.e.findingId,
    completedAt: it.e.completedAt,
    voName: it.voName,
    department: it.department,
    isPackage: it.isPackage,
    recordingId: it.recordingId,
    recordId: it.e.recordId,
    score: it.e.score,
    sentAt: it.m?.sentAt,
    openedAt: it.m?.openedAt,
    openPrefetchAt: it.m?.openPrefetchAt,
    firstClickAt: it.m?.firstClickAt,
    appealStatus: it.a?.status ?? null,
    lastOpenAt: it.m?.lastOpenAt,
    openCount: it.m?.openCount,
    lastOpenSource: it.m?.lastOpenSource,
    lastClickAt: it.m?.lastClickAt,
    clickCount: it.m?.clickCount,
    lastClickSource: it.m?.lastClickSource,
  };
}

/** Detailed engagement over [from, to]: headline aggregate + per-department and
 *  per-type (Internal/Partner) breakdowns + a paginated per-email row list.
 *
 *  Reuses the same cohort + parallel mark/appeal hydration that
 *  getEmailEngagement does, then enriches missing department / team-member
 *  fields from the finding docs (bounded — see HYDRATE_CAP). Aggregate + type
 *  breakdown cover the whole window; only `rows` are paginated. */
export async function getEmailEngagementDetail(
  orgId: OrgId,
  from: number,
  to: number,
  page = 1,
  limit = 100,
): Promise<EmailEngagementDetail> {
  const entries = await queryAuditDoneIndex(orgId, from, to);
  const [marks, appeals] = await Promise.all([
    Promise.all(entries.map((e) => getMark(orgId, e.findingId).catch(() => null))),
    Promise.all(entries.map((e) => getAppeal(orgId, e.findingId).catch(() => null))),
  ]);

  const aggregate = tallyEngagement(marks, appeals);

  // Most-recently-sent first (fall back to completedAt).
  const items: Enriched[] = entries
    .map((e, i): Enriched => ({
      e, m: marks[i], a: appeals[i],
      voName: e.voName, department: e.department, isPackage: e.isPackage, recordingId: e.recordingId,
    }))
    .sort((x, y) => ((y.m?.sentAt ?? y.e.completedAt) - (x.m?.sentAt ?? x.e.completedAt)));

  const cohortSize = items.length;
  const lim = Math.min(500, Math.max(10, limit));
  const pages = Math.max(1, Math.ceil(cohortSize / lim));
  const pg = Math.min(Math.max(1, page), pages);
  const pageItems = items.slice((pg - 1) * lim, pg * lim);

  // Hydrate department / team-member from finding docs. Whole cohort for small
  // windows; only the visible page when the cohort blows past HYDRATE_CAP.
  const hydrationCapped = cohortSize > HYDRATE_CAP;
  const hydrateSet = hydrationCapped ? pageItems : items;
  const needIds = [...new Set(
    hydrateSet
      .filter((it) => !it.department || !it.voName || it.isPackage === undefined || !it.recordingId)
      .map((it) => it.e.findingId),
  )];
  if (needIds.length) {
    const fmap = await hydrateFindings(orgId, needIds);
    hydrateSet.forEach((it) => enrichFromFinding(it, fmap.get(it.e.findingId) ?? null));
  }

  // Department breakdown (enriched) + audit-type breakdown (index isPackage is
  // reliably written, so type doesn't need hydration).
  const deptGroups = new Map<string, Enriched[]>();
  const typeGroups = new Map<string, Enriched[]>();
  for (const it of items) {
    const dept = (it.department ?? "").trim() || "Unknown";
    (deptGroups.get(dept) ?? deptGroups.set(dept, []).get(dept)!).push(it);
    const type = it.isPackage ? "Partner" : "Internal";
    (typeGroups.get(type) ?? typeGroups.set(type, []).get(type)!).push(it);
  }
  const byDepartment = [...deptGroups.entries()]
    .map(([key, group]) => tallyGroup(key, group))
    .sort((a, b) => b.sent - a.sent || b.total - a.total);
  const byType = ["Internal", "Partner"]
    .filter((k) => typeGroups.has(k))
    .map((k) => tallyGroup(k, typeGroups.get(k)!));

  return {
    aggregate, byDepartment, byType,
    rows: pageItems.map(toRow),
    total: cohortSize, page: pg, pages, cohortSize, hydrationCapped,
  };
}
