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

/** Register all webhook email handlers. Call once at process startup. Idempotent. */
export function registerAllWebhookEmailHandlers(): void {
  registerWebhookEmailHandler("terminate", (orgId, payload) =>
    sendAuditCompleteEmail(orgId, payload as AuditCompletePayload),
  );
  // Other kinds (appeal, manager, judge, judge-finish, re-audit-receipt) are
  // intentionally not registered yet — port them when those flows need email.
  console.log(`📧 [WEBHOOK] email handlers registered: terminate`);
}
