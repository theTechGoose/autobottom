/** TEMPORARY email-tracking spike (remove after the experiment).
 *
 *  Measures, for our real Postmark sends + recipients, WHEN a tracking pixel
 *  actually fires (delivery-time machine prefetch vs. human open) and whether
 *  link clicks are clean. Driven from the admin Data Maintenance tab. Strictly
 *  additive — sends its own test email, never touches real audit emails.
 *
 *  See the plan file for the experiment protocol + interpretation rubric. */

import { setStored, listStoredWithKeys } from "@core/data/firestore/mod.ts";
import { getSelfUrl } from "@core/data/qstash/mod.ts";
import { sendEmail } from "@reporting/domain/data/postmark/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

const SEND_TYPE = "track-test-send";
const HIT_TYPE = "track-test-hit";

/** 1×1 fully-transparent GIF. Returned by the pixel route. */
export const TRANSPARENT_GIF: Uint8Array = Uint8Array.from(
  atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"),
  (c) => c.charCodeAt(0),
);

export interface TrackTestSend {
  tid: string;
  toEmail: string;
  label: string;
  sentAt: number;
}

export interface TrackTestHit {
  tid: string;
  kind: "pixel" | "click";
  hitTs: number;
  msSinceSend: number;
  ua: string;
  ip: string;
}

export interface TrackTestResult extends TrackTestSend {
  hits: TrackTestHit[];
}

/** Token carries everything a hit needs with no lookup: provider label +
 *  exact send time. Shape: "<label>.<sentAtMs>.<nonce>". */
export function makeTid(label: string): string {
  const safe = (label || "other").toLowerCase().replace(/[^a-z0-9-]/g, "") || "other";
  const nonce = crypto.randomUUID().slice(0, 8);
  return `${safe}.${Date.now()}.${nonce}`;
}

export function parseTid(tid: string): { label: string; sentAt: number } {
  const parts = String(tid ?? "").split(".");
  return { label: parts[0] ?? "other", sentAt: Number(parts[1] ?? 0) || 0 };
}

function padTs(ts: number): string { return String(ts).padStart(15, "0"); }

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") ?? "";
  return (xff.split(",")[0] ?? "").trim() || "unknown";
}

/** Record a pixel/click hit. Best-effort — never throws to the caller so the
 *  pixel still returns a GIF and the click still redirects. */
export async function recordHit(kind: "pixel" | "click", tid: string, orgId: OrgId, req: Request): Promise<void> {
  try {
    if (!tid) return;
    const hitTs = Date.now();
    const { label, sentAt } = parseTid(tid);
    const ua = req.headers.get("user-agent") ?? "";
    const ip = clientIp(req);
    const msSinceSend = sentAt ? hitTs - sentAt : -1;
    console.log(`📡 [TRACK-TEST] ${kind} tid=${tid} label=${label} msSinceSend=${msSinceSend} ip=${ip} ua="${ua.slice(0, 120)}"`);
    // Key includes a nonce so two hits in the same millisecond (e.g. a prefetch
    // and an open landing together) don't collide on [tid, ts] and overwrite.
    // padTs prefix still preserves time-order; listTrackingHits re-sorts by hitTs.
    const hitKey = `${padTs(hitTs)}-${crypto.randomUUID().slice(0, 6)}`;
    await setStored(HIT_TYPE, orgId, [tid, hitKey], { tid, kind, hitTs, msSinceSend, ua, ip } as TrackTestHit);
  } catch (err) {
    console.warn(`⚠️ [TRACK-TEST] recordHit failed (non-fatal):`, err);
  }
}

/** Send the instrumented test email (pixel + click link) and record the send. */
export async function sendTrackingTest(orgId: OrgId, toEmail: string, label: string): Promise<{ ok: boolean; tid?: string; error?: string }> {
  const to = String(toEmail ?? "").trim();
  if (!to || !to.includes("@")) return { ok: false, error: "valid recipient email required" };

  const self = getSelfUrl();
  const tid = makeTid(label);
  const enc = encodeURIComponent(tid);
  const nonce = crypto.randomUUID().slice(0, 8);
  const pixelUrl = `${self}/track/pixel?tid=${enc}&cb=${nonce}`;
  const clickUrl = `${self}/track/click?tid=${enc}&to=report`;

  // Persist the send BEFORE emailing so an instant prefetch can't arrive before
  // its parent send doc exists.
  await setStored(SEND_TYPE, orgId, [tid], { tid, toEmail: to, label: parseTid(tid).label, sentAt: Date.now() } as TrackTestSend);

  const htmlBody = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111;">
    <p>Email-tracking experiment. Do not open this until instructed (Phase A), then open it (Phase B), then click the link (Phase C).</p>
    <p><a href="${clickUrl}">View report</a></p>
    <p style="color:#999;font-size:11px;">tid: ${tid}</p>
    <img src="${pixelUrl}" width="1" height="1" alt="" style="display:none;">
  </body></html>`;

  try {
    await sendEmail({ to, subject: "[autobottom] email-tracking experiment", htmlBody });
    return { ok: true, tid };
  } catch (err) {
    return { ok: false, tid, error: (err as Error).message };
  }
}

/** List sends (newest first), each with its hits ordered by time. */
export async function listTrackingHits(orgId: OrgId): Promise<TrackTestResult[]> {
  const [sendRows, hitRows] = await Promise.all([
    listStoredWithKeys<TrackTestSend>(SEND_TYPE, orgId),
    listStoredWithKeys<TrackTestHit>(HIT_TYPE, orgId),
  ]);
  const hitsByTid = new Map<string, TrackTestHit[]>();
  for (const { value } of hitRows) {
    if (!value?.tid) continue;
    const list = hitsByTid.get(value.tid) ?? [];
    list.push(value);
    hitsByTid.set(value.tid, list);
  }
  return sendRows
    .map(({ value }) => value)
    .filter((s): s is TrackTestSend => !!s?.tid)
    .sort((a, b) => b.sentAt - a.sentAt)
    .map((s) => ({
      ...s,
      hits: (hitsByTid.get(s.tid) ?? []).sort((a, b) => a.hitTs - b.hitTs),
    }));
}
