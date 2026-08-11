/** Audit API controller — create audits, get findings/stats/recordings. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Req, Query, Body, HttpContext } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { ReturnedType, Description, BodyType } from "#danet/swagger-decorators";
import { AuditQueuedResponse, FindingResponse, MessageResponse, PipelineStatsResponse } from "@core/dto/responses.ts";
import { getStats, trackActive } from "@audit/domain/data/stats-repository/mod.ts";
import { defaultOrgId } from "@core/business/auth/mod.ts";
import { GenericBodyRequest } from "@core/dto/requests.ts";
import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import { authenticate } from "@core/business/auth/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";
import { saveFinding, saveJob, getFinding, getTranscript } from "@audit/domain/data/audit-repository/mod.ts";
import { getDateLegByRid, getPackageByRid } from "@audit/domain/data/quickbase/mod.ts";
import { enqueueStep, getSelfUrl, getQueueCounts } from "@core/data/qstash/mod.ts";
import { fileJudgeAppeal } from "@audit/domain/business/file-appeal/mod.ts";
import { startReauditWithGenies } from "@audit/domain/business/reaudit/mod.ts";

@SwaggerDescription("Audit pipeline — create audits, retrieve findings, pipeline stats")
@Controller("audit")
export class AuditController {

  @Post("test-by-rid") @ReturnedType(AuditQueuedResponse) @Description("Create date-leg audit from QuickBase record ID") @BodyType(GenericBodyRequest)
  async createDateLegAudit(@Body() body: any, @Query("rid") rid: string, @Query("callback_url") callbackUrl: string, @Query("qlab_config") qlabConfig: string, @Query("override") override: string, @Query("audit_id") auditId: string) {
    if (!rid) return { error: "rid parameter required" };

    const record = await getDateLegByRid(rid) ?? body?.record ?? { RecordId: rid };
    const recordingIdField = body?.recordingIdField ?? "VoGenie";

    const jobId = auditId ?? nanoid();
    const job = { id: jobId, doneAuditIds: [], status: "running", timestamp: new Date().toISOString(), owner: body?.owner ?? "api", updateEndpoint: callbackUrl ?? "none", recordsToAudit: [rid] };
    // Use defaultOrgId() to match DashboardController — both read/write to the same org.
    const orgId = defaultOrgId() as OrgId;
    await saveJob(orgId, job);

    const findingId = nanoid();
    const rawRecordingId = record[recordingIdField] ? String(record[recordingIdField]) : undefined;
    const genieIdList = rawRecordingId ? rawRecordingId.split(",").map((s: string) => s.trim()).filter(Boolean) : [];
    const finding = {
      id: findingId, auditJobId: jobId, findingStatus: "pending",
      feedback: { heading: "", text: "", viewUrl: "" },
      job, record, recordingIdField,
      recordingId: override ?? genieIdList[0] ?? rawRecordingId,
      genieIds: !override && genieIdList.length > 1 ? genieIdList : undefined,
      owner: job.owner, updateEndpoint: callbackUrl ?? "none",
      qlabConfig: qlabConfig ?? body?.qlabConfig ?? undefined,
      isTest: body?.isTest ?? undefined,
      testEmailRecipients: body?.testEmailRecipients ?? undefined,
      startedAt: Date.now(),
    };
    await saveFinding(orgId, finding);

    // Capture enqueue result + trackActive status so the frontend can surface any
    // failure without requiring log access. This lets the user see "audit started
    // BUT trackActive failed: <reason>" instead of a silent success that vanishes.
    let enqueueResult: { ok: boolean; messageId?: string; callback?: string; error?: string };
    try {
      const messageId = await enqueueStep("init", { findingId, orgId });
      enqueueResult = { ok: true, messageId, callback: `${getSelfUrl()}/audit/step/init` };
    } catch (e) {
      enqueueResult = { ok: false, error: (e as Error).message };
      console.error(`❌ [AUDIT] enqueueStep FAILED orgId=${orgId} finding=${findingId}:`, e);
    }

    let trackActiveResult: { ok: boolean; error?: string };
    try {
      await trackActive(orgId, findingId, "queued", { recordId: rid, isPackage: false, startedAt: Date.now() });
      trackActiveResult = { ok: true };
      console.log(`✅ [AUDIT] trackActive(queued) succeeded orgId=${orgId} finding=${findingId}`);
    } catch (e) {
      trackActiveResult = { ok: false, error: (e as Error).message };
      console.error(`❌ [AUDIT] trackActive FAILED orgId=${orgId} finding=${findingId}:`, e);
    }

    console.log(`🚀 [AUDIT] Date-leg audit started: job=${jobId} finding=${findingId} rid=${rid} orgId=${orgId}`);
    return { jobId, findingId, status: "queued", enqueue: enqueueResult, trackActive: trackActiveResult };
  }

  @Post("package-by-rid") @ReturnedType(AuditQueuedResponse) @Description("Create package audit from QuickBase record ID") @BodyType(GenericBodyRequest)
  async createPackageAudit(@Body() body: any, @Query("rid") rid: string, @Query("callback_url") callbackUrl: string, @Query("qlab_config") qlabConfig: string) {
    if (!rid) return { error: "rid parameter required" };

    const record = await getPackageByRid(rid) ?? body?.record ?? { RecordId: rid };
    const recordingIdField = body?.recordingIdField ?? "GenieNumber";

    // Use defaultOrgId() to match DashboardController — both read/write to the same org.
    const orgId = defaultOrgId() as OrgId;
    const jobId = nanoid();
    const job = { id: jobId, doneAuditIds: [], status: "running", timestamp: new Date().toISOString(), owner: body?.owner ?? "api", updateEndpoint: callbackUrl ?? "none", recordsToAudit: [rid] };
    await saveJob(orgId, job);

    const findingId = nanoid();
    const rawRecordingId = record[recordingIdField] ? String(record[recordingIdField]) : undefined;
    const genieIdList = rawRecordingId ? rawRecordingId.split(",").map((s: string) => s.trim()).filter(Boolean) : [];
    const finding = {
      id: findingId, auditJobId: jobId, findingStatus: "pending",
      feedback: { heading: "", text: "", viewUrl: "" },
      job, record, recordingIdField,
      recordingId: genieIdList[0] ?? rawRecordingId,
      genieIds: genieIdList.length > 1 ? genieIdList : undefined,
      owner: job.owner, updateEndpoint: callbackUrl ?? "none",
      qlabConfig: qlabConfig ?? body?.qlabConfig ?? undefined,
      isTest: body?.isTest ?? undefined,
      testEmailRecipients: body?.testEmailRecipients ?? undefined,
      startedAt: Date.now(),
    };
    await saveFinding(orgId, finding);

    let enqueueResult: { ok: boolean; messageId?: string; callback?: string; error?: string };
    try {
      const messageId = await enqueueStep("init", { findingId, orgId });
      enqueueResult = { ok: true, messageId, callback: `${getSelfUrl()}/audit/step/init` };
    } catch (e) {
      enqueueResult = { ok: false, error: (e as Error).message };
      console.error(`❌ [AUDIT] enqueueStep FAILED orgId=${orgId} finding=${findingId}:`, e);
    }

    let trackActiveResult: { ok: boolean; error?: string };
    try {
      await trackActive(orgId, findingId, "queued", { recordId: rid, isPackage: true, startedAt: Date.now() });
      trackActiveResult = { ok: true };
      console.log(`✅ [AUDIT] trackActive(queued) succeeded orgId=${orgId} finding=${findingId}`);
    } catch (e) {
      trackActiveResult = { ok: false, error: (e as Error).message };
      console.error(`❌ [AUDIT] trackActive FAILED orgId=${orgId} finding=${findingId}:`, e);
    }

    console.log(`🚀 [AUDIT] Package audit started: job=${jobId} finding=${findingId} rid=${rid} orgId=${orgId}`);
    return { jobId, findingId, status: "queued", enqueue: enqueueResult, trackActive: trackActiveResult };
  }

  @Get("finding") @ReturnedType(FindingResponse) @Description("Get audit finding by ID")
  async getFinding(@Query("id") id: string) {
    if (!id) return { error: "id parameter required" };
    const orgId = defaultOrgId() as OrgId;
    console.log(`[GET-FINDING] looking up id=${id} orgId=${orgId}`);
    let finding: Record<string, unknown> | null = null;
    // getFinding does a CHUNKED read (header + record + transcript +
    // answeredQuestions chunks, often 5-10 FS round-trips). If any single
    // chunk aborts on the 25s foreground watchdog, the whole call throws —
    // but the data is fine, the wedge is transient. Retry once on abort
    // before giving up; this catches the common "audit mid-pipeline + brief
    // pool wedge" case where the user opens the report page seconds after
    // triggering an audit. If the retry also aborts, return retry:true so
    // the frontend can render a Retry button instead of "lookup failed".
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        finding = await getFinding(orgId, id);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        const isAbort = msg.includes("aborted") || msg.includes("AbortError") || msg.includes("signal");
        console.warn(`[GET-FINDING] ⚠️ getFinding attempt ${attempt + 1} threw for id=${id}: ${msg}${isAbort ? " (abort — will retry)" : " (non-abort — giving up)"}`);
        if (!isAbort) break;
        if (attempt === 0) await new Promise((r) => setTimeout(r, 600));
      }
    }
    if (lastErr) {
      const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
      const isAbort = msg.includes("aborted") || msg.includes("AbortError") || msg.includes("signal");
      console.error(`[GET-FINDING] ❌ getFinding final fail for id=${id} orgId=${orgId}: ${msg}`);
      if (isAbort) {
        return { error: "Server busy, please retry", retry: true, detail: msg };
      }
      return { error: "lookup failed", detail: msg };
    }
    if (finding) {
      // Transcript text lives in two places: on the finding doc (working
      // copy for pipeline steps) and in the separate `audit-transcript`
      // chunked doc (canonical persistent record, written by step-transcribe-cb
      // + step-diarize-async). If either transcript field on the finding
      // is missing — chunked-read race, downstream save with a stale value,
      // or a skip-to-finalize that left the field empty — fall back to the
      // canonical doc so the report page always renders the call text.
      //
      // utteranceTimes counts as a missing field too: the scrub view
      // (/audit/scrub) seeks the audio to a clicked transcript line, and with no
      // per-line times every line is dead. The times index the STORE's raw
      // lines, so when we take them we take that raw text with them — mixing the
      // finding doc's raw with the store's times slides every timestamp onto the
      // wrong line. Same matched-pair rule as /manager/api/finding.
      const rec = finding as Record<string, unknown>;
      const hasTimes = Array.isArray(rec.utteranceTimes) && (rec.utteranceTimes as unknown[]).length > 0;
      if (!finding.rawTranscript || !finding.diarizedTranscript || !hasTimes) {
        try {
          const t = await getTranscript(orgId, id);
          if (t) {
            rec.diarizedTranscript ??= t.diarized;
            if (!hasTimes && t.utteranceTimes?.length && t.raw) {
              rec.rawTranscript = t.raw;
              rec.utteranceTimes = t.utteranceTimes;
            } else {
              rec.rawTranscript ??= t.raw;
              rec.utteranceTimes ??= t.utteranceTimes;
            }
          }
        } catch (err) {
          console.warn(`[GET-FINDING] ⚠️ getTranscript fallback failed for id=${id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      console.log(`[GET-FINDING] ✅ found id=${id} orgId=${orgId}`);
      return finding;
    }
    // Diagnostic: where else might this finding live?
    try {
      const { listStoredByIdPrefix, getDoc, encodeDocId } = await import("@core/data/firestore/mod.ts");
      const exactDocId = encodeDocId("audit-finding", orgId, id);
      const headerDoc = await getDoc(exactDocId);
      console.log(`[GET-FINDING] header doc at ${exactDocId} → ${headerDoc ? "EXISTS" : "missing"}`);
      if (headerDoc) {
        console.log(`[GET-FINDING] header keys: ${Object.keys(headerDoc).join(", ")} totalChunks=${(headerDoc as Record<string, unknown>).totalChunks ?? "n/a"}`);
      }
      const matches = await listStoredByIdPrefix<unknown>(`audit-finding__`, { limit: 50000 });
      const byId = matches.filter((m) => m.id.endsWith(`__${id}`));
      console.log(`[GET-FINDING] found ${byId.length} doc(s) with finding id ${id} across all orgs:`);
      for (const m of byId.slice(0, 10)) console.log(`[GET-FINDING]   - ${m.id} (key=${JSON.stringify(m.key)})`);
    } catch (err) {
      console.error(`[GET-FINDING] diagnostic scan failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return { error: "not found" };
  }

  // GET /audit/recording is served by a DIRECT-DISPATCH handler in main.ts
  // (handleRecordingAudio) so it can read the raw `Range` request header and
  // return 206 Partial Content for <audio> seeking. danet's @Req is broken via
  // router.fetch in unified mode, so the controller can't see the Range header.

  @Post("api/appeal") @ReturnedType(MessageResponse) @Description("File a judge appeal for a completed audit") @BodyType(GenericBodyRequest)
  async fileAppeal(@Body() body: GenericBodyRequest) {
    try {
      const b = (body ?? {}) as unknown as { findingId?: string; auditor?: string; comment?: string; appealedQuestions?: unknown };
      console.log(`📥 [AUDIT] fileAppeal received fid=${b.findingId ?? "<missing>"} auditor=${b.auditor ?? "<missing>"} qs=${Array.isArray(b.appealedQuestions) ? b.appealedQuestions.length : 0}`);
      if (!b.findingId || !b.auditor) return { ok: false, error: "findingId and auditor required" };
      const raw = Array.isArray(b.appealedQuestions) ? b.appealedQuestions : [];
      const indexes = raw.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n >= 0);
      if (!indexes.length) return { ok: false, error: "appealedQuestions required" };
      const orgId = defaultOrgId() as OrgId;
      const result = await fileJudgeAppeal(orgId, b.findingId, { auditor: b.auditor, comment: b.comment, appealedQuestions: indexes });
      return { ok: true, judgeUrl: result.judgeUrl, queued: result.queued };
    } catch (e) {
      console.error(`❌ [AUDIT] fileAppeal failed:`, e);
      return { ok: false, error: (e as Error).message ?? String(e) };
    }
  }

  @Post("api/appeal/different-recording") @ReturnedType(MessageResponse) @Description("Re-audit a finding with a different/additional genie recording") @BodyType(GenericBodyRequest)
  async reauditWithGenies(@Body() body: GenericBodyRequest) {
    try {
      const b = (body ?? {}) as unknown as { findingId?: string; recordingIds?: unknown; comment?: string; agentEmail?: string };
      console.log(`📥 [AUDIT] reauditWithGenies received fid=${b.findingId ?? "<missing>"} ids=${Array.isArray(b.recordingIds) ? (b.recordingIds as unknown[]).length : 0} agent=${b.agentEmail ?? "(none)"}`);
      if (!b.findingId) return { ok: false, error: "findingId required" };
      const rawIds = Array.isArray(b.recordingIds) ? b.recordingIds : [];
      const ids = rawIds.map((v) => String(v).trim()).filter(Boolean);
      if (!ids.length) return { ok: false, error: "recordingIds required" };
      const orgId = defaultOrgId() as OrgId;
      const result = await startReauditWithGenies(orgId, b.findingId, { recordingIds: ids, comment: b.comment, agentEmail: b.agentEmail ?? "" });
      return {
        ok: true,
        newFindingId: result.newFindingId,
        reportUrl: result.reportUrl,
        appealType: result.appealType,
        agentEmail: result.agentEmail,
      };
    } catch (e) {
      console.error(`❌ [AUDIT] reauditWithGenies failed:`, e);
      return { ok: false, error: (e as Error).message ?? String(e) };
    }
  }

  @Get("stats") @ReturnedType(PipelineStatsResponse) @Description("Get pipeline stats")
  async getStats() {
    const orgId = defaultOrgId();
    const now = Date.now();
    const cached = AuditController._statsCache.get(orgId);

    // Stale-while-revalidate (see DashboardController.dashboardData for
    // full rationale). Fresh cache → instant; stale cache → return stale,
    // refresh in background; cold start → 5s budget then placeholder.
    // Endpoint never blocks more than 5s even with FS saturated.
    if (cached && cached.expiresAt > now) return cached.value;

    let pending = AuditController._statsPending.get(orgId);
    if (!pending) {
      // CRITICAL: must never reject — see DashboardController.dashboardData
      // for the unhandled-rejection-crashes-isolate rationale. Resolve to
      // null on any failure so background fire-and-forget doesn't crash.
      pending = (async () => {
        try {
          const [stats, queueCounts] = await Promise.all([
            getStats(orgId),
            getQueueCounts().catch(() => ({} as Record<string, number>)),
          ]);
          const inPipe = Object.values(queueCounts).reduce((sum, n) => sum + (Number(n) || 0), 0);
          const result = {
            inPipe,
            active: stats.active,
            completed24h: stats.completedCount,
            errors24h: stats.errors.length,
            errors: stats.errors,
            retries24h: stats.retries.length,
            retries: stats.retries,
            completedTs: stats.completedTs,
            errorsTs: stats.errorsTs,
            retriesTs: stats.retriesTs,
          };
          AuditController._statsCache.set(orgId, { value: result, expiresAt: Date.now() + 5_000 });
          return result;
        } catch (err) {
          console.error(`❌ [STATS] background refresh failed orgId=${orgId}:`, err);
          return null;
        } finally {
          AuditController._statsPending.delete(orgId);
        }
      })();
      AuditController._statsPending.set(orgId, pending);
    }

    if (cached) return cached.value;

    const placeholder = {
      inPipe: 0, active: [], completed24h: 0, errors24h: 0, errors: [],
      retries24h: 0, retries: [], completedTs: [], errorsTs: [], retriesTs: [],
    };
    const result = await Promise.race([
      pending,
      new Promise<null>((r) => setTimeout(() => r(null), 5_000)),
    ]);
    return result ?? placeholder;
  }
  // 5s result cache + in-flight promise dedup. Cache value can outlive
  // expiresAt — it's served while a background refresh runs.
  private static _statsCache = new Map<string, { value: unknown; expiresAt: number }>();
  private static _statsPending = new Map<string, Promise<unknown>>();
}
