/** Email report config + template repository. Firestore-backed. */

import {
  getStored, setStored, deleteStored, listStored,
} from "@core/data/firestore/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";
import type { EmailReportConfig } from "@core/dto/types.ts";

// ── Email Report Configs ─────────────────────────────────────────────────────

export async function listEmailReportConfigs(orgId: OrgId): Promise<EmailReportConfig[]> {
  return await listStored<EmailReportConfig>("email-report-config", orgId);
}

export async function getEmailReportConfig(orgId: OrgId, id: string): Promise<EmailReportConfig | null> {
  return await getStored<EmailReportConfig>("email-report-config", orgId, id);
}

export async function saveEmailReportConfig(
  orgId: OrgId,
  config: Partial<EmailReportConfig> & { name: string; recipients: string[] },
): Promise<EmailReportConfig> {
  const existing = config.id ? await getEmailReportConfig(orgId, config.id) : null;
  const full: EmailReportConfig = {
    id: config.id || crypto.randomUUID(),
    name: config.name,
    recipients: config.recipients,
    onlyCompleted: config.onlyCompleted ?? true,
    reportSections: config.reportSections ?? existing?.reportSections ?? [],
    ...(config.dateRange ? { dateRange: config.dateRange } : {}),
    ...(config.cc ? { cc: config.cc } : {}),
    ...(config.bcc ? { bcc: config.bcc } : {}),
    ...(config.failedOnly != null ? { failedOnly: config.failedOnly } : {}),
    ...(config.weeklyType ? { weeklyType: config.weeklyType } : {}),
    ...(config.templateId ? { templateId: config.templateId } : {}),
    ...(config.schedule ? { schedule: config.schedule } : {}),
  };
  await setStored("email-report-config", orgId, [full.id], full);
  return full;
}

export async function deleteEmailReportConfig(orgId: OrgId, id: string): Promise<void> {
  await deleteStored("email-report-config", orgId, id);
}

// ── Email Report Previews (24h TTL) ──────────────────────────────────────────

export interface EmailReportPreview { html: string; renderedAt: number; }

export async function getEmailReportPreview(orgId: OrgId, configId: string): Promise<EmailReportPreview | null> {
  return await getStored<EmailReportPreview>("email-report-preview", orgId, configId);
}

export async function saveEmailReportPreview(orgId: OrgId, configId: string, html: string): Promise<void> {
  await setStored("email-report-preview", orgId, [configId], { html, renderedAt: Date.now() }, { expireInMs: 86_400_000 });
}

export async function deleteEmailReportPreview(orgId: OrgId, configId: string): Promise<void> {
  await deleteStored("email-report-preview", orgId, configId);
}

// ── Email Templates ──────────────────────────────────────────────────────────

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  html: string;
  createdAt: number;
  updatedAt: number;
}

export async function listEmailTemplates(orgId: OrgId): Promise<EmailTemplate[]> {
  return await listStored<EmailTemplate>("email-template", orgId);
}

export async function getEmailTemplate(orgId: OrgId, id: string): Promise<EmailTemplate | null> {
  return await getStored<EmailTemplate>("email-template", orgId, id);
}

export async function saveEmailTemplate(
  orgId: OrgId,
  template: Partial<EmailTemplate> & { name: string; subject: string; html: string },
): Promise<EmailTemplate> {
  const now = Date.now();
  const full: EmailTemplate = {
    id: template.id || crypto.randomUUID(),
    name: template.name,
    subject: template.subject,
    html: template.html,
    createdAt: template.createdAt || now,
    updatedAt: now,
  };
  await setStored("email-template", orgId, [full.id], full);
  return full;
}

export async function deleteEmailTemplate(orgId: OrgId, id: string): Promise<void> {
  await deleteStored("email-template", orgId, id);
}

// ── Report Last Fired ────────────────────────────────────────────────────────

export async function getReportLastFired(orgId: OrgId, reportId: string): Promise<number> {
  return (await getStored<number>("report-last-fired", orgId, reportId)) ?? 0;
}

export async function setReportLastFired(orgId: OrgId, reportId: string, ts: number): Promise<void> {
  await setStored("report-last-fired", orgId, [reportId], ts);
}
