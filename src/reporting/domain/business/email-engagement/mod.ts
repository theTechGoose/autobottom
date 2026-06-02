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
import { getAppeal } from "@judge/domain/data/judge-repository/mod.ts";
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
 *  for human opens, openPrefetchAt for machine prefetch. Best-effort. */
export async function recordOpen(orgId: OrgId, findingId: string, _req: Request): Promise<void> {
  try {
    const now = Date.now();
    const mark = (await getMark(orgId, findingId)) ?? { findingId };
    const sentAt = mark.sentAt ?? 0;
    const delta = sentAt ? now - sentAt : Infinity;
    if (sentAt && delta < OPEN_PREFETCH_WINDOW_MS) {
      if (!mark.openPrefetchAt) mark.openPrefetchAt = now;
      console.log(`📭 [EMAIL-OPEN] ${findingId} PREFETCH Δ=${delta}ms — not counted as open`);
    } else {
      if (!mark.openedAt) mark.openedAt = now;
      console.log(`📬 [EMAIL-OPEN] ${findingId} open Δ=${sentAt ? `${delta}ms` : "unknown"}`);
    }
    await putMark(orgId, mark);
  } catch (err) {
    console.warn(`⚠️ [EMAIL-ENGAGE] recordOpen failed (non-fatal) fid=${findingId}:`, err);
  }
}

/** Record an email click (binary per finding — first click only). Best-effort. */
export async function recordClick(orgId: OrgId, findingId: string, _req: Request): Promise<void> {
  try {
    const mark = (await getMark(orgId, findingId)) ?? { findingId };
    if (!mark.firstClickAt) mark.firstClickAt = Date.now();
    console.log(`🖱️ [EMAIL-CLICK] ${findingId}`);
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
