/** Admin config repository — pipeline, webhooks, bypass, bonus, dimensions, scopes.
 *  Firestore-backed; falls back to in-memory store when Firebase env unset (tests). */

import {
  getStored, setStored, deleteStored, listStoredWithKeys,
} from "@core/data/firestore/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";
import type { PipelineConfig, WebhookConfig, BadWordConfig, OfficeBypassConfig, BonusPointsConfig } from "@core/dto/types.ts";

type WebhookKind = "terminate" | "appeal" | "manager" | "judge" | "judge-finish" | "review" | "re-audit-receipt";

const DEFAULT_PIPELINE_CONFIG: PipelineConfig = { maxRetries: 5, retryDelaySeconds: 10, parallelism: 20 };
const DEFAULT_BYPASS: OfficeBypassConfig = { patterns: [] };
const DEFAULT_BONUS: BonusPointsConfig = { internalBonusPoints: 0, partnerBonusPoints: 0 };
const DEFAULT_BAD_WORD: BadWordConfig = { enabled: false, emails: [], words: [], allOffices: false, officePatterns: [] };

// ── Queue Pause State ────────────────────────────────────────────────────────

export async function isPipelinePaused(orgId: OrgId): Promise<boolean> {
  return (await getStored<boolean>("pipeline-paused", orgId)) === true;
}

export async function setPipelinePaused(orgId: OrgId, paused: boolean): Promise<void> {
  await setStored("pipeline-paused", orgId, [], paused);
}

// ── Pipeline Config ──────────────────────────────────────────────────────────

export async function getPipelineConfig(orgId: OrgId): Promise<PipelineConfig> {
  return (await getStored<PipelineConfig>("pipeline-config", orgId)) ?? DEFAULT_PIPELINE_CONFIG;
}

export async function setPipelineConfig(orgId: OrgId, config: Partial<PipelineConfig>): Promise<PipelineConfig> {
  const current = await getPipelineConfig(orgId);
  const merged = { ...current, ...config };
  await setStored("pipeline-config", orgId, [], merged);
  return merged;
}

// ── Webhook Config ───────────────────────────────────────────────────────────

export async function getWebhookConfig(orgId: OrgId, kind: WebhookKind): Promise<WebhookConfig | null> {
  return await getStored<WebhookConfig>("webhook-config", orgId, kind);
}

export async function saveWebhookConfig(orgId: OrgId, kind: WebhookKind, config: WebhookConfig): Promise<void> {
  await setStored("webhook-config", orgId, [kind], config);
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
  return (await getStored<BadWordConfig>("bad-word-config", orgId)) ?? DEFAULT_BAD_WORD;
}

export async function saveBadWordConfig(orgId: OrgId, config: BadWordConfig): Promise<void> {
  await setStored("bad-word-config", orgId, [], config);
}

// ── Office Bypass Config ─────────────────────────────────────────────────────

export async function getOfficeBypassConfig(orgId: OrgId): Promise<OfficeBypassConfig> {
  return (await getStored<OfficeBypassConfig>("office-bypass-config", orgId)) ?? DEFAULT_BYPASS;
}

export async function saveOfficeBypassConfig(orgId: OrgId, config: OfficeBypassConfig): Promise<void> {
  await setStored("office-bypass-config", orgId, [], config);
}

// ── Bonus Points Config ──────────────────────────────────────────────────────

export async function getBonusPointsConfig(orgId: OrgId): Promise<BonusPointsConfig> {
  return (await getStored<BonusPointsConfig>("bonus-points-config", orgId)) ?? DEFAULT_BONUS;
}

export async function saveBonusPointsConfig(orgId: OrgId, config: BonusPointsConfig): Promise<void> {
  await setStored("bonus-points-config", orgId, [], config);
}

// ── Manager Scopes ───────────────────────────────────────────────────────────

export interface ManagerScope { departments: string[]; shifts: string[]; }

export async function getManagerScope(orgId: OrgId, managerEmail: string): Promise<ManagerScope> {
  return (await getStored<ManagerScope>("manager-scope-config", orgId, managerEmail)) ?? { departments: [], shifts: [] };
}

export async function saveManagerScope(orgId: OrgId, managerEmail: string, scope: ManagerScope): Promise<void> {
  await setStored("manager-scope-config", orgId, [managerEmail], scope);
}

export async function listManagerScopes(orgId: OrgId): Promise<Record<string, ManagerScope>> {
  const rows = await listStoredWithKeys<ManagerScope>("manager-scope-config", orgId);
  const result: Record<string, ManagerScope> = {};
  for (const { key, value } of rows) {
    const email = String(key[key.length - 1]);
    result[email] = value;
  }
  return result;
}

// ── Audit Dimensions ─────────────────────────────────────────────────────────

export interface AuditDimensions { departments: string[]; shifts: string[]; }

export async function getAuditDimensions(orgId: OrgId): Promise<AuditDimensions> {
  return (await getStored<AuditDimensions>("audit-dimensions-config", orgId)) ?? { departments: [], shifts: [] };
}

export async function saveAuditDimensions(orgId: OrgId, dims: AuditDimensions): Promise<void> {
  await setStored("audit-dimensions-config", orgId, [], dims);
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
  return (await getStored<PartnerDimensions>("partner-dimensions-config", orgId)) ?? { offices: {} };
}

export async function updatePartnerDimensions(orgId: OrgId, officeName: string, gmEmail: string): Promise<void> {
  const current = await getPartnerDimensions(orgId);
  if (!current.offices[officeName]) current.offices[officeName] = [];
  if (!current.offices[officeName].includes(gmEmail)) current.offices[officeName].push(gmEmail);
  await setStored("partner-dimensions-config", orgId, [], current);
}

// ── Reviewer Config ──────────────────────────────────────────────────────────

export interface ReviewerConfig { allowedTypes: ("date-leg" | "package")[]; }

export async function getReviewerConfig(orgId: OrgId, email: string): Promise<ReviewerConfig | null> {
  return await getStored<ReviewerConfig>("reviewer-config", orgId, email);
}

export async function saveReviewerConfig(orgId: OrgId, email: string, config: ReviewerConfig): Promise<void> {
  await setStored("reviewer-config", orgId, [email], config);
}

/** Delete a reviewer config (used when removing a reviewer). */
export async function deleteReviewerConfig(orgId: OrgId, email: string): Promise<void> {
  await deleteStored("reviewer-config", orgId, email);
}
