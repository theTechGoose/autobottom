/** Re-audit business module — ports prod main:controller.ts
 *  handleAppealDifferentRecording. Creates a new finding pointing back to the
 *  original (appealSourceFindingId + appealType) and enqueues it through the
 *  normal audit pipeline starting at init. The existing step-init already
 *  handles multi-genie download + stitch, and step-transcribe concatenates the
 *  transcripts, so "additional-recording" just works once `genieIds` is set.
 *
 *  appealType is chosen by whether the original genie stays in the list:
 *    - keeps original → "additional-recording" (concat + audit as one call)
 *    - drops original → "different-recording" (swap, single re-audit)
 *
 *  A "re-audit-receipt" webhook fires so the agent gets a confirmation email. */

import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";
import { getFinding, saveFinding, getJob, saveJob } from "@audit/domain/data/audit-repository/mod.ts";
import { enqueueStep } from "@core/data/qstash/mod.ts";
import { cleanupFindingFromIndices } from "@judge/domain/data/judge-repository/mod.ts";
import { fireWebhook } from "@admin/domain/data/admin-repository/mod.ts";

export interface ReauditInput {
  recordingIds: string[];
  comment?: string;
  agentEmail: string;
}

export interface ReauditResult {
  ok: true;
  newFindingId: string;
  reportUrl: string;
  appealType: "different-recording" | "additional-recording";
  agentEmail: string;
}

function selfUrl(): string {
  return Deno.env.get("SELF_URL") ?? "http://localhost:3000";
}

export async function startReauditWithGenies(
  orgId: OrgId,
  findingId: string,
  input: ReauditInput,
): Promise<ReauditResult> {
  const old = await getFinding(orgId, findingId);
  if (!old) throw new Error(`finding not found: ${findingId}`);

  const normalized = input.recordingIds.map((r) => String(r).trim()).filter(Boolean);
  if (!normalized.length) throw new Error("recordingIds must not be empty");
  for (const rid of normalized) {
    if (!/^\d+$/.test(rid)) throw new Error(`invalid recording ID: ${rid}`);
  }

  const originalId = old.recordingId ? String(old.recordingId) : undefined;
  const appealType: "different-recording" | "additional-recording" =
    originalId && normalized.includes(originalId) ? "additional-recording" : "different-recording";

  // Soft-delete old finding: mark reAuditedAt and scrub it from every queue/
  // index so the UI stops showing it. Chunks stay so the report page still
  // renders for anyone following a stale link.
  (old as Record<string, unknown>).reAuditedAt = Date.now();
  await saveFinding(orgId, old);
  cleanupFindingFromIndices(orgId, findingId).catch((err) =>
    console.error(`[REAUDIT] ❌ cleanup old fid=${findingId} failed:`, err));

  // Spin up a fresh job so the new audit appears independent in admin views.
  const oldJobId = old.auditJobId as string | undefined;
  const newJobId = nanoid();
  const newJob: Record<string, unknown> = {
    id: newJobId,
    doneAuditIds: [],
    status: "running",
    timestamp: new Date().toISOString(),
    owner: old.owner ?? "api",
    updateEndpoint: old.updateEndpoint ?? "none",
    recordsToAudit: old.record?.RecordId ? [String(old.record.RecordId)] : [],
  };
  await saveJob(orgId, newJob);
  if (oldJobId) {
    const existing = await getJob(orgId, oldJobId).catch(() => null);
    if (existing) {
      // Not strictly required — just helps admin see the lineage.
      (existing as Record<string, unknown>).appealedTo = newJobId;
      await saveJob(orgId, existing).catch(() => {});
    }
  }

  const newFindingId = nanoid();
  const newFinding: Record<string, unknown> = {
    id: newFindingId,
    auditJobId: newJobId,
    findingStatus: "pending",
    feedback: { heading: "", text: "", viewUrl: "" },
    job: newJob,
    record: old.record,
    recordingIdField: old.recordingIdField,
    recordingId: normalized[0],
    genieIds: normalized,
    owner: old.owner,
    updateEndpoint: old.updateEndpoint,
    qlabConfig: old.qlabConfig,
    appealSourceFindingId: findingId,
    appealType,
    ...(input.comment ? { appealComment: input.comment } : {}),
    startedAt: Date.now(),
  };
  await saveFinding(orgId, newFinding);

  try {
    await enqueueStep("init", { findingId: newFindingId, orgId });
  } catch (err) {
    console.error(`[REAUDIT] ❌ enqueueStep failed new=${newFindingId}:`, err);
    throw err;
  }

  const reportUrl = `${selfUrl()}/audit/report?id=${newFindingId}`;

  fireWebhook(orgId, "re-audit-receipt", {
    findingId: newFindingId,
    originalFindingId: findingId,
    finding: newFinding,
    appealType,
    genieIds: normalized,
    originalGenieId: originalId ?? "",
    agentEmail: input.agentEmail,
    comment: input.comment ?? "",
    reAuditedAt: Date.now(),
    reportUrl,
    originalReportUrl: `${selfUrl()}/audit/report?id=${findingId}`,
  }).catch((err) => console.error(`[REAUDIT] ❌ re-audit-receipt webhook fid=${newFindingId}:`, err));

  console.log(`📣 [REAUDIT] ${appealType}: old=${findingId} new=${newFindingId} recordings=${normalized.join(",")} agent=${input.agentEmail || "(none)"}`);
  return { ok: true, newFindingId, reportUrl, appealType, agentEmail: input.agentEmail };
}
