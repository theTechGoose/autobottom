/** Bad word detection — checks package transcripts for prohibited phrases and sends email alerts. */
import { sendEmail } from "./postmark.ts";
import type { BadWordConfig, BadWordEntry } from "../lib/kv.ts";

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return text.replace(/[&<>"']/g, (c) => map[c]);
}

export interface BadWordMatch {
  word: string;
  start: number;
  end: number;
  text: string;
}

export interface BadWordResult {
  violations: string[];
  matches: BadWordMatch[];
}

/** Check if an exclusion rule fires for a match at the given normalized position. */
function isExcluded(normalized: string, matchStart: number, matchEnd: number, entry: BadWordEntry): boolean {
  if (!entry.exclusions?.length) return false;
  for (const rule of entry.exclusions) {
    const normExcl = normalizeText(rule.word);
    if (!normExcl) continue;
    if (rule.type === "prefix") {
      // Take `buffer` words immediately before the match
      const before = normalized.slice(0, matchStart).trimEnd();
      const words = before.split(/\s+/).filter(Boolean);
      const window = words.slice(-rule.buffer).join(" ");
      if (new RegExp(`\\b${escapeRegex(normExcl)}\\b`).test(window)) return true;
    } else {
      // Take `buffer` words immediately after the match
      const after = normalized.slice(matchEnd).trimStart();
      const words = after.split(/\s+/).filter(Boolean);
      const window = words.slice(0, rule.buffer).join(" ");
      if (new RegExp(`\\b${escapeRegex(normExcl)}\\b`).test(window)) return true;
    }
  }
  return false;
}

/** Check transcript for configured words. Returns violations and match positions. */
export function detectBadWords(transcript: string, entries: (BadWordEntry | string)[]): BadWordResult {
  if (!transcript || !entries.length) return { violations: [], matches: [] };

  const normalized = normalizeText(transcript);
  const violations: string[] = [];
  const matches: BadWordMatch[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const wordEntry: BadWordEntry = typeof entry === "string" ? { word: entry } : entry;
    const word = wordEntry.word;
    if (!word.trim()) continue;
    const normWord = normalizeText(word);
    const regex = new RegExp(`\\b${escapeRegex(normWord)}\\b`, "gi");
    const hits = [...normalized.matchAll(regex)];

    // Filter out hits where an exclusion rule fires
    const nonExcluded = hits.filter((h) => !isExcluded(normalized, h.index!, h.index! + h[0].length, wordEntry));

    if (nonExcluded.length > 0 && !seen.has(normWord)) {
      seen.add(normWord);
      violations.push(word);

      // Map normalized positions back to original transcript
      const originalRegex = new RegExp(
        escapeRegex(word).split(/\s+/).join("[^a-z0-9]*\\s*[^a-z0-9]*"),
        "gi",
      );
      for (const m of transcript.matchAll(originalRegex)) {
        matches.push({ word, start: m.index!, end: m.index! + m[0].length, text: m[0] });
      }
    }
  }

  return { violations, matches };
}

/** Build highlighted HTML transcript with matched words in red. */
function buildHighlightedTranscript(transcript: string, matches: BadWordMatch[]): string {
  const sorted = [...matches].sort((a, b) => a.start - b.start);
  let html = "";
  let pos = 0;
  for (const m of sorted) {
    if (m.start < pos) continue;
    html += escapeHtml(transcript.slice(pos, m.start));
    html += `<span style="font-weight:bold;color:#fff;background:#e74c3c;padding:2px 5px;border-radius:3px;">${escapeHtml(m.text)}</span>`;
    pos = m.end;
  }
  html += escapeHtml(transcript.slice(pos));
  return html;
}

export interface BadWordEmailContext {
  findingId: string;
  recordId?: string;
  agentEmail?: string;
  officeName?: string;
  officeId?: number;
  guestName?: string;
  reservationId?: string;
  findingUrl?: string;
  recordUrl?: string;
}

/** Send bad word alert email via Postmark. */
export async function sendBadWordAlert(
  transcript: string,
  result: BadWordResult,
  ctx: BadWordEmailContext,
  recipients: string[],
): Promise<void> {
  if (!recipients.length) return;

  const timestamp = new Date().toLocaleString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York",
  }) + " EST";

  const triggerList = result.violations.join(", ");
  const highlightedTranscript = buildHighlightedTranscript(transcript, result.matches);

  const metaRow = (label: string, val: string | undefined, url?: string) =>
    val ? `<tr><td style="font-size:10px;color:#7f8c8d;padding:4px 0 1px;text-transform:uppercase;letter-spacing:.5px;">${escapeHtml(label)}</td><td style="font-size:14px;color:#2c3e50;padding-bottom:6px;">${url ? `<a href="${escapeHtml(url)}" style="color:#2980b9;text-decoration:none;font-weight:600;">${escapeHtml(val)}</a>` : escapeHtml(val)}</td></tr>` : "";

  const htmlBody = `<!DOCTYPE html><html><body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#ecf0f1;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:20px 0;background:#ecf0f1;">
<tr><td align="center">
<table width="100%" style="max-width:820px;background:#fff;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.15);overflow:hidden;" cellpadding="0" cellspacing="0">
  <tr><td style="background:linear-gradient(135deg,#e74c3c,#c0392b);padding:28px;text-align:center;">
    <h1 style="margin:0;color:#fff;font-size:26px;font-weight:700;">Bad Word Alert</h1>
  </td></tr>
  <tr><td style="padding:18px 28px;background:#fff3cd;border-bottom:3px solid #f39c12;">
    <div style="font-size:10px;color:#856404;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">TRIGGER KEYWORDS</div>
    <div style="font-size:20px;font-weight:700;color:#c0392b;">${escapeHtml(triggerList)}</div>
    <div style="margin-top:8px;font-size:11px;color:#856404;">${escapeHtml(timestamp)}</div>
  </td></tr>
  <tr><td style="padding:22px 28px;">
    <h2 style="margin:0 0 12px;font-size:16px;color:#2c3e50;">Finding Details</h2>
    <table cellpadding="0" cellspacing="0" style="width:100%;">
      ${metaRow("Finding ID", ctx.findingId, ctx.findingUrl)}
      ${metaRow("Record ID", ctx.recordId, ctx.recordUrl)}
      ${metaRow("Agent", ctx.agentEmail)}
      ${metaRow("Office", ctx.officeName ?? (ctx.officeId != null ? String(ctx.officeId) : undefined))}
      ${metaRow("Guest Name", ctx.guestName)}
      ${metaRow("Reservation ID", ctx.reservationId)}
    </table>
  </td></tr>
  <tr><td style="padding:0 28px 28px;">
    <h2 style="margin:0 0 12px;font-size:16px;color:#2c3e50;">Transcript</h2>
    <div style="background:#f8f9fa;padding:18px;border-radius:6px;line-height:1.8;font-size:14px;color:#2c3e50;white-space:pre-wrap;word-wrap:break-word;border:1px solid #e1e8ed;">${highlightedTranscript}</div>
  </td></tr>
  <tr><td style="padding:16px 28px;background:#34495e;text-align:center;">
    <p style="margin:0;font-size:11px;color:#ecf0f1;">Monster Reservations Group · AI Verification System · Automated compliance alert</p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;

  await sendEmail({
    to: recipients,
    subject: `Bad Word Alert: ${triggerList} — ${new Date().toLocaleDateString("en-US")}`,
    htmlBody,
  });
}

/**
 * Run bad word detection for a package finding.
 * Only fires if: config.enabled, officeId is in config.officeIds (or officeIds list is empty = all offices),
 * and transcript is non-empty.
 */
export async function checkFindingForBadWords(
  config: BadWordConfig,
  transcript: string,
  ctx: BadWordEmailContext,
): Promise<boolean> {
  if (!config.enabled) {
    console.log(`[BAD-WORD] ${ctx.findingId}: Skipping — detection disabled`);
    return false;
  }
  if (!transcript.trim()) {
    console.log(`[BAD-WORD] ${ctx.findingId}: Skipping — no transcript`);
    return false;
  }

  // Office filter
  if (!config.allOffices) {
    if (!config.officePatterns.length) {
      console.log(`[BAD-WORD] ${ctx.findingId}: Skipping — no office patterns configured and allOffices is off`);
      return false;
    }
    const name = (ctx.officeName ?? "").toLowerCase();
    const matched = config.officePatterns.some((p) => name.includes(p.toLowerCase()));
    if (!matched) {
      console.log(`[BAD-WORD] ${ctx.findingId}: Skipping — office "${ctx.officeName}" does not match any pattern`);
      return false;
    }
  }

  const words = config.words.filter((w) => w.word?.trim());
  if (!words.length) {
    console.log(`[BAD-WORD] ${ctx.findingId}: Skipping — no words configured`);
    return false;
  }

  console.log(`[BAD-WORD] ${ctx.findingId}: Checking ${words.length} words against transcript...`);
  const result = detectBadWords(transcript, words);

  if (!result.violations.length) {
    console.log(`[BAD-WORD] ${ctx.findingId}: No violations found`);
    return false;
  }

  console.log(`[BAD-WORD] ${ctx.findingId}: Found ${result.violations.length} violation(s): ${result.violations.join(", ")}`);

  if (config.emails.length) {
    await sendBadWordAlert(transcript, result, ctx, config.emails);
    console.log(`[BAD-WORD] ${ctx.findingId}: Alert sent to ${config.emails.length} recipient(s)`);
  } else {
    console.warn(`[BAD-WORD] ${ctx.findingId}: Violations found but no email recipients configured`);
  }

  return true;
}
