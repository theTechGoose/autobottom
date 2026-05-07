/** Bad word detection — checks package transcripts for prohibited phrases and sends email alerts. */
import { sendEmail } from "@reporting/domain/data/postmark/mod.ts";
export interface BadWordEntry {
  word: string;
  exclusions?: { word: string; buffer: number; type: string }[];
}
export type BadWordConfig = {
  enabled: boolean;
  emails: string[];
  words: (BadWordEntry | string)[];
  allOffices: boolean;
  officePatterns: string[];
};

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return text.replace(/[&<>"']/g, (c) => map[c]);
}

/** Redact credit-card-like digit runs in a transcript. Matches a leading
 *  4-digit group followed by 2-3 more 4-digit groups (separated by `-` or
 *  whitespace) plus an optional 1-3 digit trailing group — covers 12-19
 *  digit cards (Visa-13 / Amex-15 / Visa-MC-Discover-16 / Maestro-19).
 *  Replaces every digit EXCEPT the last 4 with `*`. Length-preserving:
 *  each digit becomes exactly one `*`, separators stay in place — so
 *  highlight match offsets computed against the original transcript still
 *  line up with the redacted output. Industry-standard last-4 masking.
 *
 *  Conservative pattern: requires the 4-4-4 prefix (so 8-digit 4-4 order
 *  numbers like "1234-5678" don't trip it), and won't match inside a
 *  longer digit run thanks to lookarounds. Phone numbers are 3-3-4 or
 *  3-4 — they don't fit. */
export function redactCreditCards(text: string): string {
  if (!text) return text;
  const cc = /(?<!\d)\d{4}(?:[-\s]?\d{4}){2,3}(?:[-\s]?\d{1,3})?(?!\d)/g;
  return text.replace(cc, (match) => {
    const digitCount = (match.match(/\d/g) ?? []).length;
    if (digitCount < 12 || digitCount > 19) return match;
    let seen = 0;
    return match.replace(/\d/g, (d) => {
      seen++;
      return seen <= digitCount - 4 ? "*" : d;
    });
  });
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
function isExcluded(
  normalized: string,
  matchStart: number,
  matchEnd: number,
  entry: BadWordEntry,
): boolean {
  if (!entry.exclusions?.length) return false;
  for (const rule of entry.exclusions) {
    const normExcl = normalizeText(rule.word);
    if (!normExcl) continue;
    if (rule.type === "prefix") {
      // Take `buffer` words immediately before the match
      const before = normalized.slice(0, matchStart).trimEnd();
      const words = before.split(/\s+/).filter(Boolean);
      const window = words.slice(-rule.buffer).join(" ");
      if (new RegExp(`\\b${escapeRegex(normExcl)}\\b`).test(window)) {
        return true;
      }
    } else {
      // Take `buffer` words immediately after the match
      const after = normalized.slice(matchEnd).trimStart();
      const words = after.split(/\s+/).filter(Boolean);
      const window = words.slice(0, rule.buffer).join(" ");
      if (new RegExp(`\\b${escapeRegex(normExcl)}\\b`).test(window)) {
        return true;
      }
    }
  }
  return false;
}

/** Check transcript for configured words. Returns violations and match positions. */
export function detectBadWords(
  transcript: string,
  entries: (BadWordEntry | string)[],
): BadWordResult {
  if (!transcript || !entries.length) return { violations: [], matches: [] };

  const normalized = normalizeText(transcript);
  const violations: string[] = [];
  const matches: BadWordMatch[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const wordEntry: BadWordEntry = typeof entry === "string"
      ? { word: entry }
      : entry;
    const word = wordEntry.word;
    if (!word.trim()) continue;
    const normWord = normalizeText(word);
    const regex = new RegExp(`\\b${escapeRegex(normWord)}\\b`, "gi");
    const hits = [...normalized.matchAll(regex)];

    // Filter out hits where an exclusion rule fires
    const nonExcluded = hits.filter((h) =>
      !isExcluded(normalized, h.index!, h.index! + h[0].length, wordEntry)
    );

    if (nonExcluded.length > 0 && !seen.has(normWord)) {
      seen.add(normWord);
      violations.push(word);

      // Map normalized positions back to original transcript
      const originalRegex = new RegExp(
        escapeRegex(word).split(/\s+/).join("[^a-z0-9]*\\s*[^a-z0-9]*"),
        "gi",
      );
      for (const m of transcript.matchAll(originalRegex)) {
        matches.push({
          word,
          start: m.index!,
          end: m.index! + m[0].length,
          text: m[0],
        });
      }
    }
  }

  return { violations, matches };
}

/** Build highlighted HTML transcript with matched words in red. */
function buildHighlightedTranscript(
  transcript: string,
  matches: BadWordMatch[],
): string {
  const sorted = [...matches].sort((a, b) => a.start - b.start);
  let html = "";
  let pos = 0;
  for (const m of sorted) {
    if (m.start < pos) continue;
    html += escapeHtml(transcript.slice(pos, m.start));
    html +=
      `<span style="font-weight:bold;color:#fff;background:#e74c3c;padding:2px 5px;border-radius:3px;">${
        escapeHtml(m.text)
      }</span>`;
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
  // Optional richer context — when provided, sendBadWordAlert renders the
  // two-column Guest Information / Booking Information layout that
  // stakeholders flagged as the "right office on the email" template.
  record?: Record<string, unknown>;
  recordingId?: string;
  findingOwner?: string;
}

/** RelatedOfficeId → canonical office name. Ported from the pre-refactor
 *  providers/bad-words.ts (commit 51b89f8). The QB record's OfficeName field
 *  is sometimes truncated or wrong; the office ID is the source of truth.
 *  Stakeholders explicitly asked for the right office to appear in alerts. */
export const OFFICE_NAMES_BY_ID: Record<number, string> = {
  21: "JAY", 147: "JAY209O", 150: "JAY209N", 151: "JAY123", 152: "JAY187",
  153: "JAY201", 154: "JAY301", 155: "JAY314", 156: "JAY315", 157: "JAY309",
  158: "JAY401", 159: "JAY407", 160: "JAY484", 161: "JAY514", 162: "JAY702",
  163: "JAY915", 164: "JAY954", 165: "JAY390", 201: "JAY111", 202: "JAY249",
  203: "JAY250", 204: "JAY732", 205: "JAY754", 206: "JAY863", 221: "JAY777",
  227: "JAY423", 228: "JAY532", 229: "JAY626", 230: "JAY676", 231: "JAY696",
  233: "JAY778", 234: "JAY779", 1259: "JAY747", 1262: "JAY703", 1266: "JAY917",
  1267: "JAY703", 1268: "JAY908", 1273: "JAY101", 1274: "JAY316", 1275: "JAY125",
  1281: "JAY430", 1436: "JAY916", 1437: "JAY772", 1456: "JAY311", 1462: "JAY007",
  1480: "JAY705", 1483: "JAY615", 1488: "JAY918", 1491: "JAY720", 1492: "JAY611",
  1493: "JAY973",
};

function resolveOfficeName(ctx: BadWordEmailContext): string {
  const rec = ctx.record ?? {};
  const idCandidates = [
    ctx.officeId,
    rec.RelatedOfficeId,
    rec.OfficeId,
    rec.officeId,
  ];
  for (const c of idCandidates) {
    if (c == null) continue;
    const n = Number(c);
    if (Number.isFinite(n) && OFFICE_NAMES_BY_ID[n]) return OFFICE_NAMES_BY_ID[n];
  }
  return ctx.officeName ?? "";
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
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/New_York",
  }) + " EST";

  const triggerList = result.violations.join(", ");
  // Redact credit-card-like digit sequences before rendering. Length-preserving
  // so result.matches offsets (computed against the original transcript) still
  // align with the redacted output.
  const safeTranscript = redactCreditCards(transcript);
  const highlightedTranscript = buildHighlightedTranscript(
    safeTranscript,
    result.matches,
  );

  // Two-column "Monster Verified AI Detection" layout — stakeholders asked
  // us to restore the rich template so the right office is unambiguous on
  // every alert. Office name resolves from the office-id lookup first, with
  // the QB record's OfficeName as fallback.
  const rec = (ctx.record ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const v = rec[k];
      if (v == null) continue;
      const s = String(v).trim();
      if (s) return s;
    }
    return "";
  };
  const officeName = resolveOfficeName(ctx);
  const officeId = (() => {
    const candidates = [ctx.officeId, rec.RelatedOfficeId, rec.OfficeId, rec.officeId];
    for (const c of candidates) {
      if (c == null) continue;
      const n = Number(c);
      if (Number.isFinite(n)) return String(n);
    }
    return "";
  })();

  const guestEmail = pick("EmailAddress", "GuestEmail", "Email");
  const guestEmailHtml = guestEmail
    ? `<a href="mailto:${escapeHtml(guestEmail)}" style="color:#2980b9;text-decoration:none;">${escapeHtml(guestEmail)}</a>`
    : "";

  /** Field card — same look as the screenshot: small uppercase label,
   *  larger value, blue left border, light grey background. Renders even
   *  when value is empty so the layout stays stable. */
  const card = (icon: string, label: string, valueHtml: string) =>
    `<div style="background:#f8f9fa;border-left:4px solid #2980b9;padding:10px 14px;margin-bottom:10px;border-radius:0 4px 4px 0;">
      <div style="font-size:10px;color:#7f8c8d;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">${icon} ${escapeHtml(label)}</div>
      <div style="font-size:14px;color:#2c3e50;font-weight:500;">${valueHtml || "&nbsp;"}</div>
    </div>`;

  const guestSection = `
    <h2 style="margin:0 0 12px;font-size:16px;color:#2c3e50;border-left:4px solid #2980b9;padding-left:10px;">👤 Guest Information</h2>
    ${card("🔑", "RecordID", escapeHtml(ctx.recordId ?? pick("RecordId")))}
    ${card("👤", "GuestFull Name", escapeHtml(ctx.guestName ?? pick("GuestFullName", "GuestName")))}
    ${card("👥", "SpouseFull Name", escapeHtml(pick("SpouseFullName", "SpouseName")))}
    ${card("📧", "EmailAddress", guestEmailHtml)}
    ${card("📱", "PhoneNumber", escapeHtml(pick("PhoneNumber", "Phone")))}
    ${card("📞", "AlternateNumber", escapeHtml(pick("AlternateNumber", "AltPhone")))}
    ${card("🏢", "Office Name", escapeHtml(officeName))}
    ${card("🏢", "RelatedOfficeId", escapeHtml(officeId))}
    ${card("🌍", "Destination", escapeHtml(pick("DestinationDisplay", "Destination")))}
  `;

  const bookingSection = `
    <h2 style="margin:0 0 12px;font-size:16px;color:#2c3e50;border-left:4px solid #2980b9;padding-left:10px;">📅 Booking Information</h2>
    ${card("📅", "DateOfBooking", escapeHtml(pick("DateOfBooking", "BookingDate")))}
    ${card("🎫", "ReservationID", escapeHtml(ctx.reservationId ?? pick("ReservationId")))}
    ${card("🎫", "RespkgID", escapeHtml(pick("ResPkgId", "RespkgId")))}
    ${card("🎤", "Genie", escapeHtml(ctx.recordingId ?? pick("GenieNumber")))}
    ${card("💰", "TotalPaid", escapeHtml(pick("TotalPaid", "145")))}
    ${card("📋", "Finding_Owner", escapeHtml(ctx.findingOwner ?? ""))}
  `;

  const htmlBody =
    `<!DOCTYPE html><html><body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#ecf0f1;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:20px 0;background:#ecf0f1;">
<tr><td align="center">
<table width="100%" style="max-width:980px;background:#fff;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.15);overflow:hidden;" cellpadding="0" cellspacing="0">
  <tr><td style="background:linear-gradient(135deg,#e74c3c,#c0392b);padding:28px;text-align:center;">
    <h1 style="margin:0;color:#fff;font-size:26px;font-weight:700;">⚠️ Monster Verified AI Detection</h1>
  </td></tr>
  <tr><td style="padding:18px 28px;background:linear-gradient(135deg,#fff8dc,#fff3cd);border-bottom:3px solid #f39c12;">
    <div style="font-size:10px;color:#856404;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">TRIGGER KEYWORDS</div>
    <div style="font-size:22px;font-weight:700;color:#c0392b;">${escapeHtml(triggerList)}</div>
    <div style="margin-top:10px;font-size:11px;color:#856404;"><strong>TIMESTAMP:</strong> ${escapeHtml(timestamp)}</div>
  </td></tr>
  <tr><td style="padding:22px 28px;">
    <table cellpadding="0" cellspacing="0" style="width:100%;">
      <tr>
        <td valign="top" style="width:50%;padding-right:12px;">${guestSection}</td>
        <td valign="top" style="width:50%;padding-left:12px;">${bookingSection}</td>
      </tr>
    </table>
  </td></tr>
  <tr><td style="padding:0 28px 28px;">
    <h2 style="margin:0 0 12px;font-size:16px;color:#2c3e50;border-left:4px solid #2980b9;padding-left:10px;">📝 Transcript</h2>
    <div style="background:#f8f9fa;padding:18px;border-radius:6px;line-height:1.8;font-size:14px;color:#2c3e50;white-space:pre-wrap;word-wrap:break-word;border:1px solid #e1e8ed;">${highlightedTranscript}</div>
    ${ctx.findingUrl ? `<div style="margin-top:14px;font-size:12px;"><a href="${escapeHtml(ctx.findingUrl)}" style="color:#2980b9;font-weight:600;text-decoration:none;">View Finding →</a>${ctx.recordUrl ? ` &middot; <a href="${escapeHtml(ctx.recordUrl)}" style="color:#2980b9;font-weight:600;text-decoration:none;">View QB Record →</a>` : ""}</div>` : ""}
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
    subject: `🚨 Monster Verified AI Detection:  ${triggerList} — ${
      new Date().toLocaleDateString("en-US")
    }`,
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
      console.log(
        `[BAD-WORD] ${ctx.findingId}: Skipping — no office patterns configured and allOffices is off`,
      );
      return false;
    }
    const name = (ctx.officeName ?? "").toLowerCase();
    const matched = config.officePatterns.some((p) =>
      name.includes(p.toLowerCase())
    );
    if (!matched) {
      console.log(
        `[BAD-WORD] ${ctx.findingId}: Skipping — office "${ctx.officeName}" does not match any pattern`,
      );
      return false;
    }
  }

  const words = config.words.filter((w: any) =>
    typeof w === "string" ? w.trim() : w.word?.trim()
  );
  if (!words.length) {
    console.log(`[BAD-WORD] ${ctx.findingId}: Skipping — no words configured`);
    return false;
  }

  console.log(
    `[BAD-WORD] ${ctx.findingId}: Checking ${words.length} words against transcript...`,
  );
  const result = detectBadWords(transcript, words);

  if (!result.violations.length) {
    console.log(`[BAD-WORD] ${ctx.findingId}: No violations found`);
    return false;
  }

  console.log(
    `[BAD-WORD] ${ctx.findingId}: Found ${result.violations.length} violation(s): ${
      result.violations.join(", ")
    }`,
  );

  if (config.emails.length) {
    await sendBadWordAlert(transcript, result, ctx, config.emails);
    console.log(
      `[BAD-WORD] ${ctx.findingId}: Alert sent to ${config.emails.length} recipient(s)`,
    );
  } else {
    console.warn(
      `[BAD-WORD] ${ctx.findingId}: Violations found but no email recipients configured`,
    );
  }

  return true;
}
