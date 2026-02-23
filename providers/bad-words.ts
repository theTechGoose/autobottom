/** Bad word detector - scans transcripts for prohibited keywords. */
import { sendEmail } from "./postmark.ts";

export interface ExclusionRule {
  word: string;
  buffer: number;
  type: "prefix" | "suffix";
}

export interface AlertConfig {
  word: string;
  exclusions?: ExclusionRule[];
}

/** Office ID -> name mapping loaded from OFFICE_NAMES_JSON env var. */
export const OFFICE_NAMES: Record<number, string> = (() => {
  try { return JSON.parse(Deno.env.get("OFFICE_NAMES_JSON") ?? "{}"); }
  catch { return {}; }
})();

export const TARGET_OFFICES = Object.keys(OFFICE_NAMES).map(Number);

const DEFAULT_EMAILS = (Deno.env.get("BAD_WORD_ALERT_EMAILS") ?? "").split(",").map(e => e.trim()).filter(Boolean);

import { env } from "../env.ts";
const KV_URL = env.badWordsKvUrl;

export const DEFAULT_ALERT_CONFIGS: AlertConfig[] = [
  { word: "resort taxes included" }, { word: "resort taxes covered" },
  { word: "resort fees included" }, { word: "resort fees covered" },
  { word: "taxes covered" }, { word: "all taxes included" }, { word: "all fees included" },
  { word: "flights included" }, { word: "airfare included" },
  { word: "discounted flights" }, { word: "flight discount" },
  { word: "air included" }, { word: "air package" }, { word: "free flights" },
  { word: "provide a code" }, { word: "promo code" }, { word: "discount code" },
  { word: "activation code", exclusions: [
    { word: "ecg", buffer: 30, type: "suffix" },
    { word: "e c g", buffer: 30, type: "suffix" },
    { word: "Edward", buffer: 30, type: "suffix" },
  ]},
  { word: "insurance covers up to a million" }, { word: "million dollar insurance" },
  { word: "1000000 medical coverage" }, { word: "one million medical coverage" },
  { word: "a million medical coverage" }, { word: "full medical coverage included" },
  { word: "no timeshare presentation" }, { word: "no presentation" },
  { word: "no timeshare tour" }, { word: "only an amenities tour" },
  { word: "amenities tour only" }, { word: "no sales pitch" }, { word: "not a timeshare" },
  { word: "upgrading to units that don't exist" }, { word: "upgrade to unavailable room" },
  { word: "room type that doesn't exist" }, { word: "phantom upgrade" },
  { word: "guaranteed" }, { word: "100% guaranteed" },
  { word: "guarantee your room" }, { word: "guarantee your dates" },
  { word: "free", exclusions: [
    { word: "day", buffer: 1, type: "prefix" }, { word: "toll", buffer: 1, type: "prefix" },
    { word: "months", buffer: 1, type: "prefix" }, { word: "trial", buffer: 1, type: "suffix" },
    { word: "not", buffer: 1, type: "prefix" }, { word: "hassle", buffer: 1, type: "prefix" },
    { word: "feel", buffer: 1, type: "prefix" }, { word: "any", buffer: 1, type: "prefix" },
    { word: "nights", buffer: 1, type: "suffix" },
    { word: "cancellation", buffer: 2, type: "prefix" },
    { word: "cancellation", buffer: 1, type: "suffix" },
    { word: "cruise", buffer: 1, type: "suffix" },
    { word: "months", buffer: 10, type: "prefix" },
    { word: "minute", buffer: 10, type: "prefix" },
    { word: "six months", buffer: 10, type: "suffix" },
  ]},
  { word: "waived", exclusions: [{ word: "expiration", buffer: 5, type: "suffix" }] },
  { word: "waive the fee" }, { word: "free upgrade" },
  { word: "free resort fees" }, { word: "free taxes" },
  { word: "viking" }, { word: "msc" }, { word: "celebrity" }, { word: "princess cruises" },
  { word: "upgrade" }, { word: "complimentary upgrade" },
  { word: "premium upgrade" }, { word: "vip upgrade" },
  { word: "amenities tour" }, { word: "amenities walkthrough" },
];

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getWordDistance(text: string, pos1: number, pos2: number): number {
  const start = Math.min(pos1, pos2);
  const end = Math.max(pos1, pos2);
  return text.substring(start, end).split(/\s+/).filter((w) => w.length > 0).length;
}

function isExcluded(normalized: string, matchStart: number, matchEnd: number, exclusions: ExclusionRule[]): boolean {
  if (!exclusions?.length) return false;
  for (const excl of exclusions) {
    const normExcl = normalize(excl.word);
    let pos = 0;
    while (pos < normalized.length) {
      const found = normalized.indexOf(normExcl, pos);
      if (found === -1) break;
      const exclEnd = found + normExcl.length;
      if (excl.type === "prefix" && exclEnd <= matchStart) {
        if (getWordDistance(normalized, exclEnd, matchStart) <= excl.buffer) return true;
      } else if (excl.type === "suffix" && found >= matchEnd) {
        if (getWordDistance(normalized, matchEnd, found) <= excl.buffer) return true;
      }
      pos = found + 1;
    }
  }
  return false;
}

export function findBadWords(transcript: string, configs = DEFAULT_ALERT_CONFIGS): string[] {
  const normalized = normalize(transcript);
  const violations: string[] = [];
  const seen = new Set<string>();

  for (const config of configs) {
    const normKeyword = normalize(config.word);
    const regex = new RegExp(`\\b${escapeRegex(normKeyword)}\\b`, "gi");
    const matches = [...normalized.matchAll(regex)];

    for (const match of matches) {
      const start = match.index!;
      const end = start + normKeyword.length;
      if (isExcluded(normalized, start, end, config.exclusions ?? [])) continue;
      if (!seen.has(config.word.toLowerCase())) {
        violations.push(config.word);
        seen.add(config.word.toLowerCase());
      }
    }
  }
  return violations;
}

async function isNotificationEnabled(): Promise<boolean> {
  try {
    const res = await fetch(`${KV_URL}/api/state`);
    if (!res.ok) return true;
    const data = await res.json();
    return data.partnerStoreRedFlag === true;
  } catch {
    return true;
  }
}

/** Check a finding for bad words and send alert email if found. Returns true if violations found. */
export async function checkFinding(finding: any): Promise<boolean> {
  const enabled = await isNotificationEnabled();
  if (!enabled) return false;

  const record = finding.record;
  if (!record) return false;

  const officeId = Number(record.RelatedOfficeId);
  if (!TARGET_OFFICES.includes(officeId)) return false;

  const transcript = finding.rawTranscript || finding.fixedTranscript || finding.diarizedTranscript;
  if (!transcript) return false;

  const violations = findBadWords(transcript);
  if (violations.length === 0) return false;

  console.log(`[BAD-WORD] Found ${violations.length} violations: ${violations.join(", ")}`);

  const officeName = OFFICE_NAMES[officeId] || String(officeId);
  const timestamp = new Date().toLocaleString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York",
  }) + " EST";

  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));

  const htmlBody = `<div style="font-family:Arial,sans-serif;padding:20px;background:#fff5f5;border:2px solid #e74c3c;">
    <h1 style="color:#e74c3c;">Verified AI Detection Alert</h1>
    <p><strong>Trigger Keywords:</strong> ${esc(violations.join(", "))}</p>
    <p><strong>Timestamp:</strong> ${esc(timestamp)}</p>
    <p><strong>Office:</strong> ${esc(officeName)} (${officeId})</p>
    <p><strong>Record:</strong> ${esc(String(record.RecordId || ""))}</p>
    <p><strong>Guest:</strong> ${esc(String(record.GuestFullName || ""))}</p>
    <p><strong>Genie:</strong> ${esc(String(finding.recordingId || ""))}</p>
    <hr/>
    <pre style="white-space:pre-wrap;background:#f8f9fa;padding:15px;border-radius:6px;">${esc(transcript)}</pre>
  </div>`;

  await sendEmail({
    to: DEFAULT_EMAILS,
    subject: `Verified AI Detection Alert: ${violations.join(", ")} - ${timestamp}`,
    htmlBody,
  });

  return true;
}
