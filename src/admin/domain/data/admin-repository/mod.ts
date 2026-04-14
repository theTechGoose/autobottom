/** Admin config repository — pipeline, webhooks, bypass, bonus, dimensions, scopes.
 *  Ported from lib/kv.ts config sections. */

import { getKv, orgKey } from "@core/data/deno-kv/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";
import type { PipelineConfig, WebhookConfig, BadWordConfig, OfficeBypassConfig, BonusPointsConfig } from "@core/dto/types.ts";

type WebhookKind = "terminate" | "appeal" | "manager" | "judge" | "judge-finish" | "review" | "re-audit-receipt";

const DEFAULT_PIPELINE_CONFIG: PipelineConfig = { maxRetries: 5, retryDelaySeconds: 10, parallelism: 20 };
const DEFAULT_BYPASS: OfficeBypassConfig = { patterns: [] };
const DEFAULT_BONUS: BonusPointsConfig = { internalBonusPoints: 0, partnerBonusPoints: 0 };
const DEFAULT_BAD_WORD: BadWordConfig = { enabled: false, emails: [], words: [], allOffices: false, officePatterns: [] };

// ── Pipeline Config ──────────────────────────────────────────────────────────

export async function getPipelineConfig(orgId: OrgId): Promise<PipelineConfig> {
  const db = await getKv();
  const v = (await db.get<PipelineConfig>(orgKey(orgId, "pipeline-config"))).value;
  return v ?? DEFAULT_PIPELINE_CONFIG;
}

export async function setPipelineConfig(orgId: OrgId, config: Partial<PipelineConfig>): Promise<PipelineConfig> {
  const current = await getPipelineConfig(orgId);
  const merged = { ...current, ...config };
  const db = await getKv();
  await db.set(orgKey(orgId, "pipeline-config"), merged);
  return merged;
}

// ── Webhook Config ───────────────────────────────────────────────────────────

export async function getWebhookConfig(orgId: OrgId, kind: WebhookKind): Promise<WebhookConfig | null> {
  const db = await getKv();
  return (await db.get<WebhookConfig>(orgKey(orgId, "webhook-config", kind))).value;
}

export async function saveWebhookConfig(orgId: OrgId, kind: WebhookKind, config: WebhookConfig): Promise<void> {
  const db = await getKv();
  await db.set(orgKey(orgId, "webhook-config", kind), config);
}

type WebhookEmailHandler = (orgId: OrgId, payload: unknown) => Promise<void>;
const _webhookEmailHandlers: Partial<Record<string, WebhookEmailHandler>> = {};

export function registerWebhookEmailHandler(kind: WebhookKind, handler: WebhookEmailHandler): void {
  _webhookEmailHandlers[kind] = handler;
}

export async function fireWebhook(orgId: OrgId, kind: WebhookKind, payload: unknown): Promise<void> {
  const fid = (payload as Record<string, unknown>).findingId ?? "";
  console.log(`🔔 [WEBHOOK:${kind}] org=${orgId} fid=${fid}`);
  const config = await getWebhookConfig(orgId, kind);

  const emailHandler = _webhookEmailHandlers[kind];
  if (emailHandler) {
    await emailHandler(orgId, payload).catch((err) =>
      console.error(`❌ [WEBHOOK:${kind}] Email handler failed fid=${fid}:`, err)
    );
  }

  if (config?.postUrl && config.postUrl !== "none") {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30_000);
      await fetch(config.postUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(config.postHeaders ?? {}) },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
    } catch (err) {
      console.error(`❌ [WEBHOOK:${kind}] POST failed:`, err);
    }
  }
}

// ── Bad Word Config ──────────────────────────────────────────────────────────

export async function getBadWordConfig(orgId: OrgId): Promise<BadWordConfig> {
  const db = await getKv();
  return (await db.get<BadWordConfig>(orgKey(orgId, "bad-word-config"))).value ?? DEFAULT_BAD_WORD;
}

export async function saveBadWordConfig(orgId: OrgId, config: BadWordConfig): Promise<void> {
  const db = await getKv();
  await db.set(orgKey(orgId, "bad-word-config"), config);
}

// ── Office Bypass Config ─────────────────────────────────────────────────────

export async function getOfficeBypassConfig(orgId: OrgId): Promise<OfficeBypassConfig> {
  const db = await getKv();
  return (await db.get<OfficeBypassConfig>(orgKey(orgId, "office-bypass-config"))).value ?? DEFAULT_BYPASS;
}

export async function saveOfficeBypassConfig(orgId: OrgId, config: OfficeBypassConfig): Promise<void> {
  const db = await getKv();
  await db.set(orgKey(orgId, "office-bypass-config"), config);
}

// ── Bonus Points Config ──────────────────────────────────────────────────────

export async function getBonusPointsConfig(orgId: OrgId): Promise<BonusPointsConfig> {
  const db = await getKv();
  return (await db.get<BonusPointsConfig>(orgKey(orgId, "bonus-points-config"))).value ?? DEFAULT_BONUS;
}

export async function saveBonusPointsConfig(orgId: OrgId, config: BonusPointsConfig): Promise<void> {
  const db = await getKv();
  await db.set(orgKey(orgId, "bonus-points-config"), config);
}

// ── Manager Scopes ───────────────────────────────────────────────────────────

export interface ManagerScope { departments: string[]; shifts: string[]; }

export async function getManagerScope(orgId: OrgId, managerEmail: string): Promise<ManagerScope> {
  const db = await getKv();
  return (await db.get<ManagerScope>(orgKey(orgId, "manager-scope", managerEmail))).value ?? { departments: [], shifts: [] };
}

export async function saveManagerScope(orgId: OrgId, managerEmail: string, scope: ManagerScope): Promise<void> {
  const db = await getKv();
  await db.set(orgKey(orgId, "manager-scope", managerEmail), scope);
}

export async function listManagerScopes(orgId: OrgId): Promise<Record<string, ManagerScope>> {
  const db = await getKv();
  const result: Record<string, ManagerScope> = {};
  for await (const entry of db.list<ManagerScope>({ prefix: orgKey(orgId, "manager-scope") })) {
    const email = String(entry.key[entry.key.length - 1]);
    result[email] = entry.value;
  }
  return result;
}

// ── Audit Dimensions ─────────────────────────────────────────────────────────

export interface AuditDimensions { departments: string[]; shifts: string[]; }

export async function getAuditDimensions(orgId: OrgId): Promise<AuditDimensions> {
  const db = await getKv();
  return (await db.get<AuditDimensions>(orgKey(orgId, "audit-dimensions"))).value ?? { departments: [], shifts: [] };
}

export async function saveAuditDimensions(orgId: OrgId, dims: AuditDimensions): Promise<void> {
  const db = await getKv();
  await db.set(orgKey(orgId, "audit-dimensions"), dims);
}

export async function updateAuditDimensions(orgId: OrgId, department?: string, shift?: string): Promise<void> {
  const current = await getAuditDimensions(orgId);
  let changed = false;
  if (department && !current.departments.includes(department)) { current.departments.push(department); changed = true; }
  if (shift && !current.shifts.includes(shift)) { current.shifts.push(shift); changed = true; }
  if (changed) await saveAuditDimensions(orgId, current);
}

// ── Partner Dimensions ───────────────────────────────────────────────────────

export interface PartnerDimensions { offices: Record<string, string[]>; }

export async function getPartnerDimensions(orgId: OrgId): Promise<PartnerDimensions> {
  const db = await getKv();
  return (await db.get<PartnerDimensions>(orgKey(orgId, "partner-dimensions"))).value ?? { offices: {} };
}

export async function updatePartnerDimensions(orgId: OrgId, officeName: string, gmEmail: string): Promise<void> {
  const current = await getPartnerDimensions(orgId);
  if (!current.offices[officeName]) current.offices[officeName] = [];
  if (!current.offices[officeName].includes(gmEmail)) current.offices[officeName].push(gmEmail);
  const db = await getKv();
  await db.set(orgKey(orgId, "partner-dimensions"), current);
}

// ── Reviewer Config ──────────────────────────────────────────────────────────

export interface ReviewerConfig { allowedTypes: ("date-leg" | "package")[]; }

export async function getReviewerConfig(orgId: OrgId, email: string): Promise<ReviewerConfig | null> {
  const db = await getKv();
  return (await db.get<ReviewerConfig>(orgKey(orgId, "reviewer-config", email))).value;
}

export async function saveReviewerConfig(orgId: OrgId, email: string, config: ReviewerConfig): Promise<void> {
  const db = await getKv();
  await db.set(orgKey(orgId, "reviewer-config", email), config);
}
