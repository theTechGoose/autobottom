/** Email report config + template repository. Ported from lib/kv.ts. */

import { getKv, orgKey } from "@core/domain/data/deno-kv/mod.ts";
import type { OrgId } from "@core/domain/data/deno-kv/mod.ts";
import type { EmailReportConfig } from "@core/dto/types.ts";

// ── Email Report Configs ─────────────────────────────────────────────────────

export async function listEmailReportConfigs(orgId: OrgId): Promise<EmailReportConfig[]> {
  const db = await getKv();
  const results: EmailReportConfig[] = [];
  for await (const entry of db.list<EmailReportConfig>({ prefix: orgKey(orgId, "email-report-config") })) {
    results.push(entry.value);
  }
  return results;
}

export async function getEmailReportConfig(orgId: OrgId, id: string): Promise<EmailReportConfig | null> {
  const db = await getKv();
  return (await db.get<EmailReportConfig>(orgKey(orgId, "email-report-config", id))).value;
}

export async function saveEmailReportConfig(
  orgId: OrgId,
  config: Partial<EmailReportConfig> & { name: string; recipients: string[] },
): Promise<EmailReportConfig> {
  const db = await getKv();
  const now = Date.now();
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
  await db.set(orgKey(orgId, "email-report-config", full.id), full);
  return full;
}

export async function deleteEmailReportConfig(orgId: OrgId, id: string): Promise<void> {
  const db = await getKv();
  await db.delete(orgKey(orgId, "email-report-config", id));
}

// ── Email Report Previews (24h TTL) ──────────────────────────────────────────

export interface EmailReportPreview { html: string; renderedAt: number; }

export async function getEmailReportPreview(orgId: OrgId, configId: string): Promise<EmailReportPreview | null> {
  const db = await getKv();
  return (await db.get<EmailReportPreview>(orgKey(orgId, "email-report-preview", configId))).value;
}

export async function saveEmailReportPreview(orgId: OrgId, configId: string, html: string): Promise<void> {
  const db = await getKv();
  await db.set(orgKey(orgId, "email-report-preview", configId), { html, renderedAt: Date.now() }, { expireIn: 86_400_000 });
}

export async function deleteEmailReportPreview(orgId: OrgId, configId: string): Promise<void> {
  const db = await getKv();
  await db.delete(orgKey(orgId, "email-report-preview", configId));
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
  const db = await getKv();
  const results: EmailTemplate[] = [];
  for await (const entry of db.list<EmailTemplate>({ prefix: orgKey(orgId, "email-template") })) {
    results.push(entry.value);
  }
  return results;
}

export async function getEmailTemplate(orgId: OrgId, id: string): Promise<EmailTemplate | null> {
  const db = await getKv();
  return (await db.get<EmailTemplate>(orgKey(orgId, "email-template", id))).value;
}

export async function saveEmailTemplate(
  orgId: OrgId,
  template: Partial<EmailTemplate> & { name: string; subject: string; html: string },
): Promise<EmailTemplate> {
  const db = await getKv();
  const now = Date.now();
  const full: EmailTemplate = {
    id: template.id || crypto.randomUUID(),
    name: template.name,
    subject: template.subject,
    html: template.html,
    createdAt: template.createdAt || now,
    updatedAt: now,
  };
  await db.set(orgKey(orgId, "email-template", full.id), full);
  return full;
}

export async function deleteEmailTemplate(orgId: OrgId, id: string): Promise<void> {
  const db = await getKv();
  await db.delete(orgKey(orgId, "email-template", id));
}

// ── Report Last Fired ────────────────────────────────────────────────────────

export async function getReportLastFired(orgId: OrgId, reportId: string): Promise<number> {
  const db = await getKv();
  return (await db.get<number>(orgKey(orgId, "report-last-fired", reportId))).value ?? 0;
}

export async function setReportLastFired(orgId: OrgId, reportId: string, ts: number): Promise<void> {
  const db = await getKv();
  await db.set(orgKey(orgId, "report-last-fired", reportId), ts);
}
