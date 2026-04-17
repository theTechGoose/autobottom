/** Webhook email handlers — registered into the in-process registry at
 *  fireWebhook lookup time so that `terminate` (audit-complete) actually sends
 *  email when stepFinalize fires the webhook.
 *
 *  Ported from the production main branch (`main:main.ts:2663`
 *  handleAuditCompleteWebhook), with the synthetic-Request indirection removed:
 *  fireWebhook calls the registered handler in-process and we avoid the
 *  Deno-Deploy 508 self-fetch loop entirely. */

import {
  registerWebhookEmailHandler,
  getWebhookConfig,
} from "@admin/domain/data/admin-repository/mod.ts";
import { getEmailTemplate, type EmailTemplate } from "@reporting/domain/data/email-repository/mod.ts";
import { sendEmail } from "@reporting/domain/data/postmark/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";
import type { WebhookConfig } from "@core/dto/types.ts";

const SELF_URL = (): string => Deno.env.get("SELF_URL") ?? "http://localhost:3000";
const QB_REALM = (): string => Deno.env.get("QB_REALM") ?? "";

/** Parse QB VoName field "VO MB - Harmony Eason" → { full: "Harmony Eason", first: "Harmony" } */
export function parseVoName(voNameRaw: string, fallback: string): { full: string; first: string } {
  const full = voNameRaw.includes(" - ")
    ? voNameRaw.split(" - ").slice(1).join(" - ").trim()
    : voNameRaw.trim();
  const display = full || (fallback.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || fallback);
  return { full: display, first: display.split(" ")[0] || display };
}

/** Mustache-style {{var}} substitution. */
export function renderTemplate(str: string, vars: Record<string, string>): string {
  return str.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
}

async function resolveTemplate(orgId: OrgId, cfg: WebhookConfig | null): Promise<EmailTemplate | null> {
  if (!cfg?.emailTemplateId) return null;
  return getEmailTemplate(orgId, cfg.emailTemplateId);
}

interface AuditCompletePayload {
  findingId?: string;
  finding?: Record<string, any>;
  score?: number;
  reason?: string;
}

/** Build template variables and send the audit-complete email. Mirrors
 *  main:main.ts handleAuditCompleteWebhook. Returns silently if not configured
 *  (no email template, no recipient) — fireWebhook already wraps in catch. */
async function sendAuditCompleteEmail(orgId: OrgId, payload: AuditCompletePayload): Promise<void> {
  const cfg = await getWebhookConfig(orgId, "terminate").catch((err) => {
    console.error(`❌ [WEBHOOK:terminate] getWebhookConfig failed:`, err);
    return null;
  });
  const finding = payload.finding;
  const findingId = String(payload.findingId ?? finding?.id ?? "");
  console.log(`📧 [WEBHOOK:terminate] org=${orgId} fid=${findingId} emailTemplateId=${cfg?.emailTemplateId ?? "NONE"} testEmail=${cfg?.testEmail ?? ""}`);

  if (!finding) {
    console.warn(`⚠️ [WEBHOOK:terminate] payload missing finding fid=${findingId} — skipping email`);
    return;
  }

  const template = await resolveTemplate(orgId, cfg);
  if (!template) {
    console.log(`📧 [WEBHOOK:terminate] skipped fid=${findingId} — no emailTemplateId configured`);
    return;
  }

  const agentEmail = String(finding.owner ?? "");
  const voEmail = String(finding.record?.VoEmail ?? "");
  const supervisorEmail = String(finding.record?.SupervisorEmail ?? "");
  const gmEmail = String(finding.record?.GmEmail ?? "");
  const { full: teamMemberFull, first: teamMemberFirst } = parseVoName(String(finding.record?.VoName ?? ""), agentEmail);
  const recordId = String(finding.record?.RecordId ?? "");
  const isPackage = finding.recordingIdField === "GenieNumber";
  const qbTableId = isPackage ? "bttffb64u" : "bpb28qsnn";
  const crmUrl = recordId && QB_REALM() ? `https://${QB_REALM()}.quickbase.com/db/${qbTableId}?a=dr&rid=${recordId}` : "";

  const allQs = Array.isArray(finding.answeredQuestions) ? finding.answeredQuestions : [];
  const yeses = allQs.filter((q: any) => q.answer === "Yes").length;
  const total = allQs.length;
  const scoreVal = payload.score ?? (total > 0 ? Math.round((yeses / total) * 100) : 0);
  const missedQs = allQs.filter((q: any) => q.answer === "No");
  const scoreColor = scoreVal === 100 ? "#3fb950" : scoreVal >= 80 ? "#58a6ff" : scoreVal >= 60 ? "#d29922" : "#f85149";
  const passedOrFailed = scoreVal === 100 ? "Passed" : "Failed";
  const scoreVerbiage = scoreVal === 100 ? "Perfect score — great call! Review your audit below."
    : scoreVal >= 80 ? "Strong performance overall. Check the missed questions below."
    : scoreVal >= 60 ? "A few areas to work on. Review your missed questions below."
    : "There's room to improve here. Take a look at what was missed.";
  const isInvalidGenie = payload.reason === "invalid_genie";

  const missedQuestionsRows = missedQs.length
    ? missedQs.map((q: any, i: number) =>
        `<tr><td style="padding:8px 12px;border-bottom:1px solid #21262d;color:#8b949e;font-size:12px;width:32px;text-align:center;">${i + 1}</td><td style="padding:8px 12px;border-bottom:1px solid #21262d;color:#e6edf3;font-size:13px;">${q.header ?? q.question ?? "Unknown"}</td></tr>`
      ).join("")
    : `<tr><td colspan="2" style="padding:8px 12px;color:#6e7681;font-size:13px;font-style:italic;">No missed questions — perfect score!</td></tr>`;

  const notesSection = isInvalidGenie
    ? `<div style="background:#161b22;border:1px solid #30363d;border-left:3px solid #f85149;border-radius:8px;padding:18px 20px;"><p style="margin:0 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#f85149;">Recording Invalid</p><p style="margin:0;font-size:14px;color:#c9d1d9;line-height:1.6;">Your Genie recording could not be located. <a href="${SELF_URL()}/audit/report?id=${findingId}" style="color:#58a6ff;text-decoration:none;">Click here to view your report and submit a new recording →</a></p></div>`
    : missedQs.length === 0
      ? `<div style="background:#161b22;border:1px solid #2ea043;border-radius:8px;padding:18px 20px;text-align:center;"><p style="margin:0;font-size:15px;font-weight:600;color:#3fb950;">Perfect score — great call!</p><p style="margin:6px 0 0;font-size:13px;color:#8b949e;">Review your audit below to see what you did right.</p></div>`
      : `<p style="margin:0 0 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#8b949e;">Missed Questions</p><table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #21262d;border-radius:8px;overflow:hidden;"><tr style="background:#161b22;"><td style="padding:8px 14px;font-size:11px;font-weight:700;color:#8b949e;width:32px;">#</td><td style="padding:8px 14px;font-size:11px;font-weight:700;color:#8b949e;">Category</td></tr>${missedQuestionsRows}</table>`;

  const auditTypeLabel = isPackage ? "package verification" : "date leg";
  const guestNameVal = String(finding.record?.GuestName ?? "");
  const greeting = isPackage ? "Hi," : `Hi ${teamMemberFirst},`;
  const guestContext = (!isPackage && guestNameVal)
    ? ` for <strong style="color:#c9d1d9;">${guestNameVal}</strong>`
    : "";
  const supportTeamName = isPackage ? "AI Team" : "Excellence Audit Team";
  const recordTypeLabel = isPackage ? "Package ID" : "Date Leg ID";
  const urgentNote = isPackage ? "" : `For urgent issues, include your <em>${recordTypeLabel}</em> in the subject so we can find it fast.`;

  const vars: Record<string, string> = {
    agentName: teamMemberFull,
    agentEmail: voEmail || agentEmail,
    teamMember: teamMemberFull,
    teamMemberFirst,
    supervisorEmail,
    score: scoreVal + "%",
    scoreVerbiage,
    scoreColor,
    passedOrFailed,
    notesSection,
    findingId,
    recordId,
    guestName: guestNameVal,
    subjectGuest: guestNameVal || (isPackage ? `Package #${recordId}` : `#${recordId}`),
    greeting,
    auditTypeLabel,
    guestContext,
    supportTeamName,
    recordTypeLabel,
    urgentNote,
    reportUrl: `${SELF_URL()}/audit/report?id=${findingId}`,
    recordingUrl: `${SELF_URL()}/audit/recording?id=${findingId}`,
    appealUrl: `${SELF_URL()}/audit/appeal?findingId=${findingId}`,
    feedbackText: finding.feedback?.text ?? "",
    missedQuestions: missedQuestionsRows,
    missedCount: String(missedQs.length),
    passedCount: String(total - missedQs.length),
    totalQuestions: String(total),
    crmUrl,
    managerNotesDisplay: missedQs.length === 0 ? "display:none" : "",
    logoUrl: `${SELF_URL()}/logo.png`,
    selfUrl: SELF_URL(),
  };

  const resolvedTest = cfg?.testEmail || "";
  const to = resolvedTest || (isPackage ? gmEmail : (voEmail || agentEmail));
  if (!to) {
    console.warn(`⚠️ [WEBHOOK:terminate] no recipient resolved fid=${findingId} isPackage=${isPackage} — skipping`);
    return;
  }
  const cc = resolvedTest ? undefined : (supervisorEmail || undefined);
  const bcc = resolvedTest ? undefined : (cfg?.bcc || undefined);

  console.log(`📧 [WEBHOOK:terminate] sending fid=${findingId} to=${to} cc=${cc ?? "none"} bcc=${bcc ?? "none"} score=${scoreVal}%`);
  try {
    await sendEmail({
      to,
      subject: renderTemplate(template.subject, vars),
      htmlBody: renderTemplate(template.html, vars),
      cc,
      bcc,
    });
    console.log(`✅ [WEBHOOK:terminate] email sent fid=${findingId} → ${to}`);
  } catch (err) {
    console.error(`❌ [WEBHOOK:terminate] sendEmail failed fid=${findingId}:`, err);
  }
}

// ── Appeal Filed ──────────────────────────────────────────────────────────────

interface AppealFiledPayload {
  findingId?: string;
  finding?: Record<string, any>;
  auditor?: string;
  questionCount?: number;
  comment?: string;
  appealedAt?: number;
}

/** Prod's default appeal-filed HTML. Used when no template is configured via
 *  the admin email-templates modal. Mustache-substituted at send time. */
const DEFAULT_APPEAL_TEMPLATE: EmailTemplate = {
  id: "__default_appeal__",
  name: "Appeal Filed (default)",
  subject: "Appeal Filed: {{guestName}} - Record: {{recordId}}",
  createdAt: 0,
  updatedAt: 0,
  html: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Appeal Filed</title></head><body style="margin:0;padding:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#0d1117;min-height:100vh;"><tr><td align="center" style="padding:32px 16px;"><table width="560" cellpadding="0" cellspacing="0" style="max-width:100%;width:560px;border:1px solid #3d2b00;border-radius:12px;overflow:hidden;"><tr><td style="background:#1c1600;padding:24px 28px 20px;border-bottom:1px solid #3d2b00;"><p style="margin:0 0 4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#d29922;">Action Required</p><h1 style="margin:0;font-size:20px;font-weight:700;color:#f0c842;">Appeal Filed</h1><p style="margin:6px 0 0;font-size:12px;color:#9e8300;">A team member has submitted an appeal for review.</p></td></tr><tr><td style="padding:22px 28px 0;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td style="width:50%;padding-right:8px;vertical-align:top;"><div style="background:#161b22;border:1px solid #3d2b00;border-radius:8px;padding:14px 16px;"><p style="margin:0 0 2px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#d29922;">Team Member</p><p style="margin:0;font-size:14px;font-weight:600;color:#f0f6fc;">{{agentName}}</p><p style="margin:2px 0 0;font-size:11px;color:#8b949e;">{{agentEmail}}</p></div></td><td style="width:50%;padding-left:8px;vertical-align:top;"><div style="background:#161b22;border:1px solid #3d2b00;border-radius:8px;padding:14px 16px;"><p style="margin:0 0 2px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#d29922;">Guest / Record</p><p style="margin:0;font-size:14px;font-weight:600;color:#f0f6fc;">{{guestName}}</p><p style="margin:2px 0 0;font-size:11px;color:#8b949e;">Record #{{recordId}}</p></div></td></tr></table></td></tr><tr><td style="padding:14px 28px 0;"><div style="border-left:3px solid #d29922;padding:12px 16px;background:#161b22;border-radius:0 8px 8px 0;"><p style="margin:0 0 4px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#d29922;">Agent Comment</p><p style="margin:0;font-size:13px;color:#c9d1d9;line-height:1.6;">{{comment}}</p></div></td></tr><tr><td style="padding:22px 28px 24px;text-align:center;"><table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr><td style="padding-right:10px;"><a href="{{judgeUrl}}" style="display:inline-block;background:#9e6a03;color:#ffffff;font-size:13px;font-weight:700;text-decoration:none;padding:10px 22px;border-radius:6px;border:1px solid #d29922;">Open Judge Panel</a></td><td><a href="{{reportUrl}}" style="display:inline-block;background:#161b22;color:#c9d1d9;font-size:13px;font-weight:600;text-decoration:none;padding:10px 22px;border-radius:6px;border:1px solid #30363d;">View Report</a></td></tr></table></td></tr><tr><td style="background:#0d1117;border-top:1px solid #3d2b00;padding:14px 28px;text-align:center;"><p style="margin:0;font-size:11px;color:#6e7681;">Filed {{appealedAt}} &nbsp;·&nbsp; Audit ID: {{findingId}}</p></td></tr></table></td></tr></table></body></html>`,
};

async function sendAppealFiledEmail(orgId: OrgId, payload: AppealFiledPayload): Promise<void> {
  const cfg = await getWebhookConfig(orgId, "appeal").catch((err) => {
    console.error(`❌ [WEBHOOK:appeal] getWebhookConfig failed:`, err);
    return null;
  });
  const finding = payload.finding;
  const findingId = String(payload.findingId ?? finding?.id ?? "");
  if (!finding || !findingId) {
    console.warn(`⚠️ [WEBHOOK:appeal] payload missing finding fid=${findingId} — skipping email`);
    return;
  }

  // Template lookup: configured id → fall back to prod's default HTML.
  const template = (await resolveTemplate(orgId, cfg)) ?? DEFAULT_APPEAL_TEMPLATE;

  const agentEmail = String(finding.owner ?? "");
  const voEmail = String(finding.record?.VoEmail ?? "");
  const gmEmail = String(finding.record?.GmEmail ?? "");
  const isPackage = finding.recordingIdField === "GenieNumber";
  const recipientEmail = isPackage ? gmEmail : (voEmail || agentEmail);
  const { full: agentName } = parseVoName(String(finding.record?.VoName ?? ""), recipientEmail);

  const appealedAtStr = payload.appealedAt
    ? new Date(payload.appealedAt).toLocaleString("en-US", { timeZone: "America/New_York" }) + " EST"
    : "";

  const vars: Record<string, string> = {
    findingId,
    agentName,
    agentEmail: recipientEmail,
    teamMemberName: agentName,
    teamMemberEmail: recipientEmail,
    gmEmail,
    recordId: String(finding.record?.RecordId ?? ""),
    guestName: String(finding.record?.GuestName ?? ""),
    reportUrl: `${SELF_URL()}/audit/report?id=${findingId}`,
    judgeUrl: `${SELF_URL()}/judge`,
    comment: payload.comment ?? "",
    questionCount: String(payload.questionCount ?? 0),
    auditor: payload.auditor ?? "",
    appealedAt: appealedAtStr,
    logoUrl: `${SELF_URL()}/logo.png`,
    selfUrl: SELF_URL(),
  };

  // Appeal email is a staff notification — BCC list drives recipients.
  const resolvedTest = cfg?.testEmail || "";
  const bccList = cfg?.bcc || "";
  const bccParts = bccList.split(",").map((s) => s.trim()).filter(Boolean);
  const to = resolvedTest || bccParts[0] || "";
  if (!to) {
    console.warn(`⚠️ [WEBHOOK:appeal] no recipient configured (testEmail/bcc both empty) fid=${findingId} — skipping`);
    return;
  }
  const bcc = resolvedTest ? undefined : (bccParts.slice(1).join(",") || undefined);

  console.log(`📧 [WEBHOOK:appeal] sending fid=${findingId} to=${to} bcc=${bcc ?? "none"} template=${template.id}`);
  try {
    await sendEmail({
      to,
      subject: renderTemplate(template.subject, vars),
      htmlBody: renderTemplate(template.html, vars),
      bcc,
    });
    console.log(`✅ [WEBHOOK:appeal] email sent fid=${findingId} → ${to}`);
  } catch (err) {
    console.error(`❌ [WEBHOOK:appeal] sendEmail failed fid=${findingId}:`, err);
  }
}

// ── Re-Audit Receipt ──────────────────────────────────────────────────────────

interface ReAuditReceiptPayload {
  findingId?: string;
  originalFindingId?: string;
  finding?: Record<string, any>;
  appealType?: string;
  genieIds?: string[];
  originalGenieId?: string;
  agentEmail?: string;
  comment?: string;
  reAuditedAt?: number;
  reportUrl?: string;
  originalReportUrl?: string;
}

const DEFAULT_REAUDIT_RECEIPT_TEMPLATE: EmailTemplate = {
  id: "__default_reaudit_receipt__",
  name: "Re-Audit Receipt (default)",
  subject: "Re-Audit Submitted — Record {{recordId}}",
  createdAt: 0,
  updatedAt: 0,
  html: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Recording Submitted</title></head><body style="margin:0;padding:0;background:#070d18;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#070d18;min-height:100vh;"><tr><td align="center" style="padding:40px 16px;"><table width="580" cellpadding="0" cellspacing="0" style="max-width:100%;width:580px;background:#0d1520;border:1px solid #1e2d45;border-radius:16px;overflow:hidden;"><tr><td style="padding:28px 32px 24px;text-align:center;border-bottom:1px solid #1a2840;"><div style="margin-bottom:12px;"><span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#3b82f6;">{{appealTypeLabel}}</span></div><h1 style="margin:0 0 10px;font-size:24px;font-weight:700;color:#e6edf3;line-height:1.2;">Re-Audit Submitted</h1><p style="margin:0;font-size:14px;color:#8b949e;">Hey <strong style="color:#c9d1d9;">{{teamMemberFirst}}</strong>, your results will be available shortly.</p></td></tr><tr><td style="padding:24px 32px;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#111d2e;border:1px solid #1e2d45;border-radius:10px;overflow:hidden;"><tr><td style="padding:16px 20px;text-align:center;border-bottom:1px solid #1a2840;"><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#4a6080;margin-bottom:6px;">Record</div><div style="font-size:20px;font-weight:700;color:#e6edf3;">{{recordId}}</div></td></tr><tr><td style="padding:16px 20px;text-align:center;border-bottom:1px solid #1a2840;"><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#4a6080;margin-bottom:6px;">Original Genie</div><div style="font-size:16px;font-weight:600;color:#3b82f6;">{{originalGenieId}}</div></td></tr><tr><td style="padding:16px 20px;text-align:center;border-bottom:1px solid #1a2840;"><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#4a6080;margin-bottom:6px;">New Genie(s)</div><div style="font-size:16px;font-weight:600;color:#e6edf3;">{{newGenieIds}}</div></td></tr><tr><td style="padding:16px 20px;text-align:center;"><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#4a6080;margin-bottom:6px;">Submitted</div><div style="font-size:14px;font-weight:500;color:#c9d1d9;">{{submittedAt}}</div></td></tr></table></td></tr><tr><td style="padding:0 32px 32px;text-align:center;"><a href="{{reportUrl}}" style="display:inline-block;padding:12px 32px;background:#3b82f6;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;border:1px solid #2563eb;">View Audit Report</a></td></tr><tr><td style="background:#080f1a;border-top:1px solid #1a2840;padding:14px 28px;text-align:center;"><p style="margin:0;font-size:10px;color:#3a5070;font-family:monospace;">Audit ID: {{findingId}}</p></td></tr></table></td></tr></table></body></html>`,
};

async function sendReAuditReceiptEmail(orgId: OrgId, payload: ReAuditReceiptPayload): Promise<void> {
  const cfg = await getWebhookConfig(orgId, "re-audit-receipt").catch(() => null);
  const finding = payload.finding;
  const findingId = String(payload.findingId ?? finding?.id ?? "");
  if (!findingId || !finding) {
    console.warn(`⚠️ [WEBHOOK:re-audit-receipt] payload missing finding fid=${findingId} — skipping`);
    return;
  }

  const template = (await resolveTemplate(orgId, cfg)) ?? DEFAULT_REAUDIT_RECEIPT_TEMPLATE;

  const agentEmail = String(finding.owner ?? "");
  const voEmail = String(finding.record?.VoEmail ?? "");
  const gmEmail = String(finding.record?.GmEmail ?? "");
  const isPackage = finding.recordingIdField === "GenieNumber";
  const recipientEmail = isPackage ? gmEmail : (voEmail || (agentEmail !== "api" ? agentEmail : ""));
  const { full: teamMemberFull, first: teamMemberFirst } = parseVoName(String(finding.record?.VoName ?? ""), recipientEmail);
  const recordId = String(finding.record?.RecordId ?? "");

  const appealType = String(payload.appealType ?? finding.appealType ?? "");
  const appealTypeLabel = appealType === "additional-recording" ? "Additional Recording"
    : appealType === "different-recording" ? "Replacement Recording"
    : appealType === "upload-recording" ? "Uploaded Recording"
    : "Re-Audit";
  const newGenieIds = (payload.genieIds && payload.genieIds.length)
    ? payload.genieIds.join(", ")
    : (Array.isArray(finding.genieIds) ? finding.genieIds.join(", ") : String(finding.recordingId ?? ""));

  const vars: Record<string, string> = {
    agentName: teamMemberFull,
    agentEmail: recipientEmail,
    gmEmail,
    teamMember: teamMemberFull,
    teamMemberFirst,
    findingId,
    originalFindingId: payload.originalFindingId ?? "",
    recordId,
    guestName: String(finding.record?.GuestName ?? ""),
    reportUrl: payload.reportUrl ?? `${SELF_URL()}/audit/report?id=${findingId}`,
    originalReportUrl: payload.originalReportUrl ?? (payload.originalFindingId ? `${SELF_URL()}/audit/report?id=${payload.originalFindingId}` : ""),
    appealType,
    appealTypeLabel,
    newGenieIds,
    originalGenieId: payload.originalGenieId ?? "",
    comment: payload.comment ?? "",
    submittedAt: new Date(payload.reAuditedAt ?? Date.now()).toLocaleString("en-US", { timeZone: "America/New_York" }) + " EST",
    logoUrl: `${SELF_URL()}/logo.png`,
    selfUrl: SELF_URL(),
  };

  const resolvedTest = cfg?.testEmail || "";
  const to = resolvedTest || recipientEmail;
  if (!to) {
    console.warn(`⚠️ [WEBHOOK:re-audit-receipt] no recipient for fid=${findingId} — skipping`);
    return;
  }
  const bcc = resolvedTest ? undefined : (cfg?.bcc || undefined);

  console.log(`📧 [WEBHOOK:re-audit-receipt] sending fid=${findingId} to=${to} bcc=${bcc ?? "none"}`);
  try {
    await sendEmail({
      to,
      subject: renderTemplate(template.subject, vars),
      htmlBody: renderTemplate(template.html, vars),
      bcc,
    });
    console.log(`✅ [WEBHOOK:re-audit-receipt] email sent fid=${findingId} → ${to}`);
  } catch (err) {
    console.error(`❌ [WEBHOOK:re-audit-receipt] sendEmail failed fid=${findingId}:`, err);
  }
}

/** Register all webhook email handlers. Call once at process startup. Idempotent. */
export function registerAllWebhookEmailHandlers(): void {
  registerWebhookEmailHandler("terminate", (orgId, payload) =>
    sendAuditCompleteEmail(orgId, payload as AuditCompletePayload),
  );
  registerWebhookEmailHandler("appeal", (orgId, payload) =>
    sendAppealFiledEmail(orgId, payload as AppealFiledPayload),
  );
  registerWebhookEmailHandler("re-audit-receipt", (orgId, payload) =>
    sendReAuditReceiptEmail(orgId, payload as ReAuditReceiptPayload),
  );
  // manager, judge, judge-finish still deferred — port when those flows need email.
  console.log(`📧 [WEBHOOK] email handlers registered: terminate, appeal, re-audit-receipt`);
}
