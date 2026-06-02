/** Unified entrypoint — serves both backend API (danet) and frontend (Fresh)
 *  from one process.
 */
import "npm:reflect-metadata@0.1.13";

// Global unhandled-rejection handler. Deno Deploy CRASHES the isolate by
// default when a promise rejects without a .catch — and any cold start
// after a crash hits Deno Deploy's edge with a 503 while the new isolate
// boots (~3-5s). Some FS abort errors were escaping our try/catch
// wrappers (fire-and-forget queueMicrotask deletes, etc.) and
// crash-looping the isolate every time the connection pool wedged. This
// listener swallows the rejection, logs it loudly so we can fix the
// missing catch, and prevents the crash.
addEventListener("unhandledrejection", (e) => {
  const reason = e.reason;
  const msg = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
  console.error(`🚨 [UNHANDLED-REJECTION] ${msg}`);
  if (reason instanceof Error && reason.stack) {
    console.error(reason.stack);
  }
  e.preventDefault();
});

// Datadog OTel disabled to reduce isolate cold-start cost. The init makes
// a synchronous network connection to otlp.us5.datadoghq.com on every
// isolate boot, which on a serverless platform that cold-starts isolates
// frequently (we've seen 11 boots in 10 min on this app) was adding
// latency we couldn't afford. Uncomment if you want OTel back; otherwise
// keep telemetry via Deno Deploy's built-in metrics + our app logs.
// import { initOtel } from "@core/data/datadog-otel/mod.ts";
// initOtel();

import { runWithOrigin } from "@core/data/qstash/mod.ts";

// Register cron jobs
import { registerCrons } from "@cron/domain/business/cron-core/mod.ts";
registerCrons();

// --- Backend: initialize danet app, extract Hono handler ---
import { DanetApplication } from "@danet/core";
import { AppModule } from "./bootstrap/mod.ts";
import { authenticate } from "@core/business/auth/mod.ts";
import { registerAllWebhookEmailHandlers } from "@reporting/domain/business/webhook-handlers/mod.ts";
import { getGameState, getEarnedBadges } from "@gamification/domain/data/gamification-repository/mod.ts";
import { getFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { getKv, orgKey } from "@core/data/deno-kv/mod.ts";
import { defaultOrgId } from "@core/business/auth/mod.ts";
import { startUploadReaudit } from "@audit/domain/business/upload-reaudit/mod.ts";
import { startReauditWithGenies } from "@audit/domain/business/reaudit/mod.ts";
import { fileJudgeAppeal } from "@audit/domain/business/file-appeal/mod.ts";
import { saveFinding, saveJob } from "@audit/domain/data/audit-repository/mod.ts";
import { trackActive, getHiddenFindingIds } from "@audit/domain/data/stats-repository/mod.ts";
import { getDateLegByRid, getPackageByRid } from "@audit/domain/data/quickbase/mod.ts";
import { enqueueStep, getSelfUrl, applyDefaultQueueParallelism } from "@core/data/qstash/mod.ts";
import { runInBackgroundLane } from "@core/data/firestore/mod.ts";
import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import { bucketWeeklyTrend } from "@audit/domain/business/agent-trend/mod.ts";
import { handleKvExport, handleKvInventory, handleKvBatchList } from "@admin/entrypoints/kv-export/mod.ts";
import { handleCanaryErrors } from "@admin/entrypoints/canary-errors/mod.ts";
import { recordOpen, recordClick, verifyFinding, TRANSPARENT_GIF } from "@reporting/domain/business/email-engagement/mod.ts";
import { handleEventsStream, handleChatStream } from "@events/entrypoints/events-stream/mod.ts";
import { buildDispatchErrorResponse, isDanetAbortBody } from "@core/business/dispatch-error/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

// --- Pipeline step functions: dispatched DIRECTLY by this handler (bypassing
// danet) because danet's @Req decorator returns undefined when reached via
// router.fetch(), which crashes the step handlers. See plan notes (repo root
// plan file) for the investigation. Same pattern as /admin/api/me above. ---
import {
  stepInit, stepTranscribe, stepTranscribeCb, stepPollTranscript,
  stepDiarizeAsync, stepPineconeAsync, stepPrepare,
  stepAskAll, stepFinalize, stepCleanup, stepBadWordCheck,
} from "@audit/mod-root.ts";

const STEP_HANDLERS: Record<string, (req: Request) => Promise<Response>> = {
  "init": stepInit,
  "transcribe": stepTranscribe,
  "poll-transcript": stepPollTranscript,
  "transcribe-complete": stepTranscribeCb,
  "diarize-async": stepDiarizeAsync,
  "pinecone-async": stepPineconeAsync,
  "prepare": stepPrepare,
  "ask-all": stepAskAll,
  "finalize": stepFinalize,
  "cleanup": stepCleanup,
  "bad-word-check": stepBadWordCheck,
};

// ── Auth-context direct-dispatch handlers ──
// Danet's @Req decorator returns undefined via router.fetch(), so any endpoint
// that needs the session cookie to answer "who is the current user?" has to be
// dispatched directly from here. Each handler resolves `authenticate(req)` and
// returns 401 if no session. Pattern mirrors /admin/api/me below.
async function handleMe(req: Request): Promise<Response> {
  const auth = await authenticate(req);
  if (!auth) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json({ username: auth.email, email: auth.email, role: auth.role, orgId: auth.orgId });
}

async function handleGameState(req: Request): Promise<Response> {
  const auth = await authenticate(req);
  if (!auth) return Response.json({ error: "unauthorized" }, { status: 401 });
  // Soft-fallback: under FS wedge, return a zero-shaped game state rather
  // than a 5xx. The frontend gamification UI renders fine with zeroes; a
  // 500 here used to break the entire /agent and /review pages because
  // they fetch game-state in parallel with the main panel.
  try {
    const [gs, badges] = await Promise.all([
      getGameState(auth.orgId, auth.email),
      getEarnedBadges(auth.orgId, auth.email),
    ]);
    return Response.json({ ...gs, badges: badges.map((b) => b.badgeId) });
  } catch (err) {
    console.warn(`⚠️ [GAME-STATE] failed for ${auth.email} — soft fallback:`, err);
    return Response.json({ xp: 0, level: 1, badges: [] });
  }
}

async function handleGetBadges(req: Request): Promise<Response> {
  const auth = await authenticate(req);
  if (!auth) return Response.json({ error: "unauthorized" }, { status: 401 });
  // Soft-fallback: badges fetch is polled from the gamification UI on
  // dashboards; a 500 here used to break the surrounding stat grid via
  // the parallel Promise.all in the page handler. Mirror handleGameState.
  try {
    const badges = await getEarnedBadges(auth.orgId, auth.email);
    return Response.json({ badges });
  } catch (err) {
    console.warn(`⚠️ [BADGES] failed for ${auth.email} — soft fallback:`, err);
    return Response.json({ badges: [], retry: true });
  }
}

async function handleManagerAuditHistory(req: Request): Promise<Response> {
  const auth = await authenticate(req);
  if (!auth) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (auth.role !== "manager" && auth.role !== "admin") {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const q = url.searchParams;
  const intOr = (k: string, dflt: number | undefined): number | undefined => {
    const v = q.get(k);
    if (v == null || v === "") return dflt;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : dflt;
  };
  // /manager/api/audit-history is the backing endpoint for /manager/audits.
  // Anyone hitting it gets the manager experience (scoped to dept/shift +
  // reviewed-only) regardless of their real role — the page contract is
  // "manager view." Admins who want unrestricted access hit /admin/audits.
  //
  // Honor `?as=<email>` so an admin impersonating a specific manager gets
  // that manager's scope (departments + shifts), not the admin's empty
  // scope. The middleware swap of ctx.state.user doesn't propagate to
  // backend calls — they only see the session cookie — so we read `?as=`
  // off the request URL directly.
  const asEmail = q.get("as");
  const scopeEmail = (asEmail && auth.role === "admin") ? asEmail : auth.email;
  const { getAuditHistory } = await import("@manager/domain/business/audit-history/mod.ts");
  try {
    const result = await getAuditHistory(auth.orgId, scopeEmail, "manager", {
      owner: q.get("owner") || undefined,
      shift: q.get("shift") || undefined,
      department: q.get("department") || undefined,
      reviewed: q.get("reviewed") || undefined,
      scoreMin: intOr("scoreMin", undefined),
      scoreMax: intOr("scoreMax", undefined),
      page: intOr("page", undefined),
      limit: intOr("limit", undefined),
      since: intOr("since", undefined),
      until: intOr("until", undefined),
    });
    return Response.json(result);
  } catch (err) {
    console.error(`❌ [MANAGER-AUDITS] failed:`, err);
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

async function handleAgentDashboard(req: Request): Promise<Response> {
  const auth = await authenticate(req);
  if (!auth) return Response.json({ error: "unauthorized" }, { status: 401 });
  // Soft-fallback: any FS abort during the iteration below would otherwise
  // surface as a 500 on /agent — empty dashboard is acceptable; a 500 is not.
  try {
    return await _computeAgentDashboard(auth);
  } catch (err) {
    console.warn(`⚠️ [AGENT-DASH] failed for ${auth.email} — soft fallback:`, err);
    return Response.json({
      email: auth.email,
      totalAudits: 0, avgScore: 0, perfectCount: 0,
      recentAudits: [], weeklyTrend: [],
      retry: true,
    });
  }
}

async function _computeAgentDashboard(auth: { orgId: OrgId; email: string }): Promise<Response> {
  const db = await getKv();
  const findingIds = new Set<string>();
  for await (const entry of db.list({ prefix: orgKey(auth.orgId, "audit-finding") })) {
    const key = entry.key as Deno.KvKey;
    if (key.length >= 3 && typeof key[2] === "string") findingIds.add(key[2] as string);
  }
  // Drop dedup soft-hidden duplicates so the agent's totalAudits / avgScore
  // / perfectCount / weeklyTrend reflect the post-dedup reality, not the
  // pre-dedup count that includes copies we already pruned.
  const hidden = await getHiddenFindingIds(auth.orgId);
  let totalYes = 0, totalQuestions = 0;
  let perfectCount = 0;
  const audits: Array<Record<string, unknown>> = [];
  const scorePoints: Array<{ completedAt: number; score: number }> = [];

  for (const findingId of findingIds) {
    if (hidden.has(findingId)) continue;
    const finding = await getFinding(auth.orgId, findingId);
    if (!finding || finding.findingStatus !== "finished") continue;
    if (finding.owner !== auth.email) continue;
    const qs: Array<{ answer: string }> = finding.answeredQuestions ?? [];
    const passed = qs.filter((q) => q.answer === "Yes").length;
    const failed = qs.filter((q) => q.answer === "No").length;
    totalYes += passed;
    totalQuestions += qs.length;
    const score = qs.length > 0 ? Math.round((passed / qs.length) * 100) : 0;
    if (score === 100) perfectCount += 1;
    const completedAt = Number(finding.completedAt ?? Date.now());
    audits.push({
      findingId,
      recordId: (finding.record as Record<string, unknown> | undefined)?.RecordId ?? "",
      recordingId: finding.recordingId ?? "",
      totalQuestions: qs.length,
      passedCount: passed,
      failedCount: failed,
      completedAt,
      score,
      type: finding.recordingIdField === "GenieNumber" ? "partner" : "internal",
    });
    scorePoints.push({ completedAt, score });
  }
  audits.sort((a, b) => Number(b.completedAt) - Number(a.completedAt));
  const avgScore = totalQuestions > 0 ? Math.round((totalYes / totalQuestions) * 100) : 0;
  const weeklyTrend = bucketWeeklyTrend(scorePoints, Date.now());

  return Response.json({
    email: auth.email,
    totalAudits: audits.length,
    avgScore,
    perfectCount,
    recentAudits: audits.slice(0, 20),
    weeklyTrend,
  });
}

// Direct-dispatch: POST /audit/api/appeal/upload-recording accepts a multipart
// form with a file, so we bypass danet (whose @Req decorator returns undefined
// via router.fetch). Same workaround pattern as step callbacks above.
async function handleUploadReauditAppeal(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return Response.json({ error: "POST required" }, { status: 405 });
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "multipart/form-data required" }, { status: 400 });
  }
  const findingId = String(form.get("findingId") ?? "").trim();
  const file = form.get("file");
  if (!findingId) return Response.json({ error: "findingId required" }, { status: 400 });
  if (!(file instanceof File)) return Response.json({ error: "file required" }, { status: 400 });

  const snipStartRaw = form.get("snipStart");
  const snipEndRaw = form.get("snipEnd");
  const snipStart = snipStartRaw != null && String(snipStartRaw).length ? Number(snipStartRaw) : undefined;
  const snipEnd = snipEndRaw != null && String(snipEndRaw).length ? Number(snipEndRaw) : undefined;
  if (snipStart !== undefined && (!Number.isFinite(snipStart) || snipStart < 0)) {
    return Response.json({ error: "invalid snipStart" }, { status: 400 });
  }
  if (snipEnd !== undefined && (!Number.isFinite(snipEnd) || snipEnd < 0)) {
    return Response.json({ error: "invalid snipEnd" }, { status: 400 });
  }
  const comment = String(form.get("comment") ?? "") || undefined;
  const agentEmail = String(form.get("agentEmail") ?? "");

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength === 0) return Response.json({ error: "empty file" }, { status: 400 });

  try {
    const orgId = defaultOrgId() as OrgId;
    const result = await startUploadReaudit(orgId, findingId, {
      file: bytes,
      contentType: file.type || "audio/mpeg",
      snipStart,
      snipEnd,
      comment,
      agentEmail,
    });
    return Response.json(result);
  } catch (err) {
    console.error(`❌ [UPLOAD-REAUDIT] failed fid=${findingId}:`, err);
    return Response.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

// Direct-dispatch: POST /audit/api/appeal/different-recording — same workaround
// as upload-recording. JSON body parsing via danet's @Body decorator returns
// undefined-ish values via router.fetch in unified mode (the same issue that
// breaks @Req for QStash callbacks), so we parse the body directly here.
async function handleReauditDifferentRecording(req: Request): Promise<Response> {
  if (req.method !== "POST") return Response.json({ error: "POST required" }, { status: 405 });
  let body: { findingId?: string; recordingIds?: unknown; comment?: string; agentEmail?: string };
  try {
    body = await req.json();
  } catch (err) {
    console.error(`❌ [REAUDIT-DIFFERENT] body parse failed:`, err);
    return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  const findingId = String(body.findingId ?? "").trim();
  if (!findingId) return Response.json({ ok: false, error: "findingId required" }, { status: 400 });
  const rawIds = Array.isArray(body.recordingIds) ? body.recordingIds : [];
  const ids = rawIds.map((v) => String(v).trim()).filter(Boolean);
  if (!ids.length) return Response.json({ ok: false, error: "recordingIds required" }, { status: 400 });
  const comment = body.comment ? String(body.comment) : undefined;
  const agentEmail = body.agentEmail ? String(body.agentEmail) : "";

  console.log(`📥 [REAUDIT-DIFFERENT] direct dispatch fid=${findingId} ids=${ids.length} agent=${agentEmail || "(none)"}`);
  try {
    const orgId = defaultOrgId() as OrgId;
    const result = await startReauditWithGenies(orgId, findingId, { recordingIds: ids, comment, agentEmail });
    return Response.json({
      ok: true,
      newFindingId: result.newFindingId,
      reportUrl: result.reportUrl,
      appealType: result.appealType,
      agentEmail: result.agentEmail,
    });
  } catch (err) {
    console.error(`❌ [REAUDIT-DIFFERENT] failed fid=${findingId}:`, err);
    return Response.json({ ok: false, error: (err as Error).message ?? String(err) }, { status: 500 });
  }
}

// Direct-dispatch: POST /audit/test-by-rid and /audit/package-by-rid — n8n
// triggers send `?rid=…` with NO body, but danet's @Body decorator
// unconditionally JSON.parse()'s the request body and throws "Unexpected end
// of JSON input" on empty input → 500. The handlers don't need a body
// (everything's in the query string), so we skip danet entirely and parse
// the body tolerantly here. Same workaround pattern as the appeal endpoints.

async function readJsonBodyTolerant(req: Request): Promise<Record<string, unknown>> {
  if (req.method === "GET" || req.method === "HEAD") return {};
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) return {};
  try {
    const text = await req.text();
    if (!text.trim()) return {};
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function handleCreateDateLegAudit(req: Request): Promise<Response> {
  if (req.method !== "POST") return Response.json({ error: "POST required" }, { status: 405 });
  const url = new URL(req.url);
  const rid = url.searchParams.get("rid") ?? "";
  if (!rid) return Response.json({ error: "rid parameter required" }, { status: 400 });
  const callbackUrl = url.searchParams.get("callback_url") ?? "none";
  const qlabConfig = url.searchParams.get("qlab_config") ?? undefined;
  const override = url.searchParams.get("override") ?? undefined;
  const auditId = url.searchParams.get("audit_id") ?? undefined;

  const body = await readJsonBodyTolerant(req);
  const record = (await getDateLegByRid(rid)) ?? (body.record as Record<string, unknown> | undefined) ?? { RecordId: rid };
  const recordingIdField = (body.recordingIdField as string | undefined) ?? "VoGenie";

  const orgId = defaultOrgId() as OrgId;
  const jobId = auditId ?? nanoid();
  const job = {
    id: jobId, doneAuditIds: [], status: "running",
    timestamp: new Date().toISOString(),
    owner: (body.owner as string | undefined) ?? "api",
    updateEndpoint: callbackUrl, recordsToAudit: [rid],
  };
  await saveJob(orgId, job);

  const findingId = nanoid();
  const rawRecordingId = (record as Record<string, unknown>)[recordingIdField] != null
    ? String((record as Record<string, unknown>)[recordingIdField])
    : undefined;
  const genieIdList = rawRecordingId ? rawRecordingId.split(",").map((s: string) => s.trim()).filter(Boolean) : [];
  const finding = {
    id: findingId, auditJobId: jobId, findingStatus: "pending",
    feedback: { heading: "", text: "", viewUrl: "" },
    job, record, recordingIdField,
    recordingId: override ?? genieIdList[0] ?? rawRecordingId,
    genieIds: !override && genieIdList.length > 1 ? genieIdList : undefined,
    owner: job.owner, updateEndpoint: callbackUrl,
    qlabConfig: qlabConfig ?? (body.qlabConfig as string | undefined),
    isTest: body.isTest,
    testEmailRecipients: body.testEmailRecipients,
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

  // Intentionally NOT calling trackActive("queued") here — it inflates the
  // dashboard "Active" count to include audits that are sitting in QStash
  // waiting to be delivered (so n8n bulk-firing 700 audits showed 700
  // "active" even though QStash only processes 8 at a time). step-init
  // will trackActive when it actually starts processing.
  console.log(`🚀 [AUDIT] Date-leg audit started: job=${jobId} finding=${findingId} rid=${rid} orgId=${orgId}`);
  return Response.json({ jobId, findingId, status: "queued", enqueue: enqueueResult });
}

async function handleCreatePackageAudit(req: Request): Promise<Response> {
  if (req.method !== "POST") return Response.json({ error: "POST required" }, { status: 405 });
  const url = new URL(req.url);
  const rid = url.searchParams.get("rid") ?? "";
  if (!rid) return Response.json({ error: "rid parameter required" }, { status: 400 });
  const callbackUrl = url.searchParams.get("callback_url") ?? "none";
  const qlabConfig = url.searchParams.get("qlab_config") ?? undefined;

  const body = await readJsonBodyTolerant(req);
  const record = (await getPackageByRid(rid)) ?? (body.record as Record<string, unknown> | undefined) ?? { RecordId: rid };
  const recordingIdField = (body.recordingIdField as string | undefined) ?? "GenieNumber";

  const orgId = defaultOrgId() as OrgId;
  const jobId = nanoid();
  const job = {
    id: jobId, doneAuditIds: [], status: "running",
    timestamp: new Date().toISOString(),
    owner: (body.owner as string | undefined) ?? "api",
    updateEndpoint: callbackUrl, recordsToAudit: [rid],
  };
  await saveJob(orgId, job);

  const findingId = nanoid();
  const rawRecordingId = (record as Record<string, unknown>)[recordingIdField] != null
    ? String((record as Record<string, unknown>)[recordingIdField])
    : undefined;
  const genieIdList = rawRecordingId ? rawRecordingId.split(",").map((s: string) => s.trim()).filter(Boolean) : [];
  const finding = {
    id: findingId, auditJobId: jobId, findingStatus: "pending",
    feedback: { heading: "", text: "", viewUrl: "" },
    job, record, recordingIdField,
    recordingId: genieIdList[0] ?? rawRecordingId,
    genieIds: genieIdList.length > 1 ? genieIdList : undefined,
    owner: job.owner, updateEndpoint: callbackUrl,
    qlabConfig: qlabConfig ?? (body.qlabConfig as string | undefined),
    isTest: body.isTest,
    testEmailRecipients: body.testEmailRecipients,
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

  // See comment in handleCreateDateLegAudit — no trackActive("queued") on
  // create; step-init handles tracking when it actually picks up the work.
  console.log(`🚀 [AUDIT] Package audit started: job=${jobId} finding=${findingId} rid=${rid} orgId=${orgId}`);
  return Response.json({ jobId, findingId, status: "queued", enqueue: enqueueResult });
}

// Direct-dispatch: POST /audit/api/appeal — file a judge appeal. Same body-
// parsing workaround as different-recording above.
async function handleFileAppeal(req: Request): Promise<Response> {
  if (req.method !== "POST") return Response.json({ error: "POST required" }, { status: 405 });
  let body: { findingId?: string; auditor?: string; comment?: string; appealedQuestions?: unknown };
  try {
    body = await req.json();
  } catch (err) {
    console.error(`❌ [FILE-APPEAL] body parse failed:`, err);
    return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  const findingId = String(body.findingId ?? "").trim();
  const auditor = String(body.auditor ?? "").trim();
  if (!findingId || !auditor) return Response.json({ ok: false, error: "findingId and auditor required" }, { status: 400 });
  const raw = Array.isArray(body.appealedQuestions) ? body.appealedQuestions : [];
  const indexes = raw.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n >= 0);
  if (!indexes.length) return Response.json({ ok: false, error: "appealedQuestions required" }, { status: 400 });
  const comment = body.comment ? String(body.comment) : undefined;

  console.log(`📥 [FILE-APPEAL] direct dispatch fid=${findingId} auditor=${auditor} qs=${indexes.length}`);
  try {
    const orgId = defaultOrgId() as OrgId;
    const result = await fileJudgeAppeal(orgId, findingId, { auditor, comment, appealedQuestions: indexes });
    return Response.json({ ok: true, judgeUrl: result.judgeUrl, queued: result.queued });
  } catch (err) {
    console.error(`❌ [FILE-APPEAL] failed fid=${findingId}:`, err);
    return Response.json({ ok: false, error: (err as Error).message ?? String(err) }, { status: 500 });
  }
}

// Direct-dispatch: POST /gamification/api/upload-sound writes the file into S3
// at sounds/<orgId>/<packId>/<slot>.mp3 and updates the pack's slot map.
// Multipart so it must bypass danet (same reason as upload-reaudit).
async function handleUploadSound(req: Request): Promise<Response> {
  if (req.method !== "POST") return Response.json({ error: "POST required" }, { status: 405 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "multipart/form-data required" }, { status: 400 });
  }
  const packId = String(form.get("packId") ?? "").trim();
  const slot = String(form.get("slot") ?? "").trim();
  const file = form.get("file");
  if (!packId || !slot) return Response.json({ error: "packId + slot required" }, { status: 400 });
  if (!(file instanceof File)) return Response.json({ error: "file required" }, { status: 400 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength === 0) return Response.json({ error: "empty file" }, { status: 400 });
  if (bytes.byteLength > 5 * 1024 * 1024) return Response.json({ error: "file too large (5MB max per slot)" }, { status: 400 });

  try {
    const orgId = defaultOrgId() as OrgId;
    const bucket = Deno.env.get("S3_BUCKET") ?? Deno.env.get("AWS_S3_BUCKET") ?? "";
    if (!bucket) return Response.json({ error: "S3_BUCKET not configured" }, { status: 500 });
    const { S3Ref } = await import("@core/data/s3/mod.ts");
    const { buildSoundPackS3Key } = await import("@gamification/domain/business/sound-pack-seed/mod.ts");
    const key = buildSoundPackS3Key(orgId, packId, slot);
    await new S3Ref(bucket, key).save(bytes);

    // Update the pack metadata so the slot points at this URL pattern.
    const { getSoundPack, saveSoundPack } = await import("@gamification/domain/data/gamification-repository/mod.ts");
    const existing = await getSoundPack(orgId, packId);
    const pack = existing ?? { id: packId, name: packId, slots: {}, createdAt: Date.now(), createdBy: "upload" };
    pack.slots[slot] = key;
    await saveSoundPack(orgId, pack);
    console.log(`🔊 [UPLOAD-SOUND] org=${orgId} pack=${packId} slot=${slot} bytes=${bytes.byteLength}`);
    return Response.json({ ok: true, key, bytes: bytes.byteLength });
  } catch (err) {
    console.error(`❌ [UPLOAD-SOUND] failed:`, err);
    return Response.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

const AUTH_CONTEXT_HANDLERS: Record<string, (req: Request) => Promise<Response>> = {
  "/review/api/me": handleMe,
  "/judge/api/me": handleMe,
  "/manager/api/me": handleMe,
  "/agent/api/me": handleMe,
  "/manager/api/game-state": handleGameState,
  "/manager/api/audit-history": handleManagerAuditHistory,
  "/agent/api/game-state": handleGameState,
  "/agent/api/dashboard": handleAgentDashboard,
  "/api/badges": handleGetBadges,
};

const danetApp = new DanetApplication();
// Silence danet's per-route "[Router] Registering [GET] /xxx" cold-start
// spam. We tried Deno.env.set("NO_LOG","1") (danet Logger's escape hatch) —
// it works locally but Deno Deploy appears to ignore runtime env writes
// for this read, so the lines kept appearing in prod after the first
// attempt. Console-intercept instead: wrap console.log + console.error
// during init() and drop lines that match the danet Logger's exact format
// (`<HTTP-date GMT> [<Namespace>] <text>`) AND mention router/injector
// chatter we never look at. Other warn/error paths still flow through.
// Try/finally guarantees restoration even if init throws.
const _origLog = console.log;
const _origErr = console.error;
const _origWarn = console.warn;
// Match by substring on the joined args so ANSI color escape prefixes
// (\x1b[37m, etc. — danet's Logger wraps every line in `white(date)
// yellow([Namespace]) green(text)`) don't slip past a strict ^anchor regex.
// `[Router]` and `[Injector]` are danet's namespaces, never used by our
// own logs, so the false-positive risk is zero.
function isDanetBootNoise(args: unknown[]): boolean {
  if (!args.length) return false;
  const joined = args.map((a) => typeof a === "string" ? a : "").join(" ");
  return joined.includes("[Router]") || joined.includes("[Injector]");
}
console.log = (...args: unknown[]) => { if (!isDanetBootNoise(args)) _origLog(...args); };
console.error = (...args: unknown[]) => { if (!isDanetBootNoise(args)) _origErr(...args); };
console.warn = (...args: unknown[]) => { if (!isDanetBootNoise(args)) _origWarn(...args); };
try {
  await danetApp.init(AppModule);
} finally {
  console.log = _origLog;
  console.error = _origErr;
  console.warn = _origWarn;
}

// Register in-process webhook email handlers. fireWebhook("terminate", ...) in
// stepFinalize routes through here to actually send the audit-complete email.
// Without this, fireWebhook silently no-ops because no handler is registered.
console.log("📧 [WEBHOOK] about to register email handlers...");
registerAllWebhookEmailHandlers();
console.log("📧 [WEBHOOK] registration complete, continuing boot");

// @ts-ignore — router is Hono app with .fetch()
const rawBackendFetch: (req: Request) => Promise<Response> = danetApp.router.fetch.bind(danetApp.router);

/** Foolproof boundary wrap around danet's router.fetch.
 *
 *  Danet has its OWN exception filter that catches uncaught controller
 *  exceptions BEFORE they reach our outer try/catch, and emits a Response
 *  with body `{"status":500,"message":"<err.message>"}`. The dispatch-catch
 *  we added at main.ts is therefore a NO-OP for danet 500s — our exception
 *  handler can't fire on an exception that never escaped.
 *
 *  This wrap inspects the response body AFTER danet finishes. If we see
 *  danet's auto-generated 500-abort signature, we rewrite it to the same
 *  retry-friendly shape buildDispatchErrorResponse produces: 200+{retry:true}
 *  for GETs, 503+{retry:true} for POSTs.
 *
 *  Verification by log grep:
 *    `❌ [BACKEND-CATCH]` — every line here is a 500-abort we intercepted.
 *    `❌ [API_FETCH] ... → 500: {"status":500,"message":"signal aborted"}`
 *      — these should drop to ZERO after this wrap deploys. If any remain,
 *      they came from a path that bypassed our backend dispatch entirely.
 *
 *  Per-endpoint try/catch is still preferred for shape-correct fallbacks
 *  (panel widgets need `{pending: 0}`, not `{retry: true}`). This wrap is
 *  the universal safety net for everything we missed. */
async function backendFetch(req: Request): Promise<Response> {
  const res = await rawBackendFetch(req);
  if (res.status !== 500) return res;
  const text = await res.text();
  if (isDanetAbortBody(text)) {
    const path = new URL(req.url).pathname;
    console.error(`❌ [BACKEND-CATCH] ${req.method} ${path} → 500 abort intercepted → retry:true`);
    const status = req.method === "GET" ? 200 : 503;
    return Response.json(
      { retry: true, error: "Server busy, please retry", path, method: req.method },
      { status },
    );
  }
  // Non-abort 500: re-emit with the consumed body so downstream callers see it.
  return new Response(text, { status: 500, headers: res.headers });
}

// --- Frontend: import pre-built Fresh handler from _fresh/server.js ---
// @ts-ignore — generated file, not type-checked
const freshServer = await import("./frontend/_fresh/server.js");
const frontendHandler: (req: Request, info?: Deno.ServeHandlerInfo) => Promise<Response> = freshServer.default.fetch;

// --- Set API_URL for frontend SSR fetches (same origin) ---
// ALWAYS override — this is a unified process, the backend IS localhost. If a
// stale env var points to another deployment, frontend SSR calls cross
// deployments via external HTTP and split the pipeline across builds (audit
// creation, enqueueStep, and step handlers end up on different deployments,
// making logs impossible to correlate).
const port = Number(Deno.env.get("PORT") ?? 3000);
Deno.env.set("API_URL", `http://localhost:${port}`);

// --- Route requests ---
// Frontend EXACT page paths — must match exactly (no prefix matching)
const FRONTEND_EXACT_PAGES = new Set([
  "/admin/dashboard", "/admin/users", "/admin/audits", "/admin/weekly-builder",
  "/admin/badge-editor",
  "/admin/impersonate-go",
  "/manager/audits",
  "/review", "/review/dashboard",
  "/judge", "/judge/dashboard",
  "/manager", "/agent", "/chat", "/store", "/question-lab",
  "/audit/report",
  "/super-admin",
  "/gamification",
  // QLab Fresh HTMX wrappers that share URLs with same-name danet endpoints
  // (the QL controller is mounted at @Controller("api")). Browser HTMX hits
  // these expecting an HTML fragment → Fresh. Server-side apiPost loopback
  // from those Fresh handlers sets Accept: application/json → must reach
  // the backend's JSON handler instead of recursing into the same Fresh
  // route. Without this, the delete handlers loop back through their own
  // Fresh route, the silent catch swallows the eventual timeout, and the
  // HX-Redirect still fires — user bounces to the list without anything
  // actually deleting.
  "/api/qlab/configs/clone",
  "/api/qlab/configs/delete",
  "/api/qlab/questions/restore",
  "/api/qlab/questions/update",
  "/api/qlab/questions/delete",
]);

// Frontend PREFIX paths — anything starting with these goes to Fresh
const FRONTEND_PREFIX_PATHS = [
  "/api/login", "/api/register", "/api/logout",
  "/api/admin/", "/api/review/", "/api/judge/",
  "/api/manager/", "/api/agent/", "/api/chat/",
  "/api/super-admin/",
  "/api/gamification/",
  "/api/store/buy",
  // Frontend-only QLab HTMX wrappers — render HTML fragments. Backend has plain
  // /api/qlab/configs (POST create) and /api/qlab/configs/update; everything
  // matched here is a Fresh route file under frontend/routes/api/qlab/**.
  "/api/qlab/configs/new",
  "/api/qlab/configs/clone",
  "/api/qlab/configs/delete",
  "/api/qlab/configs/bulk-delete",
  "/api/qlab/configs/rename",
  "/api/qlab/configs/toggle-active",
  "/api/qlab/configs/create",
  "/api/qlab/configs/field",
  "/api/qlab/configs/test-audit",
  "/api/qlab/configs/test-status",
  "/api/qlab/questions/field",
  "/api/qlab/questions/restore",
  "/api/qlab/configs/bulk-egregious-form",
  "/api/qlab/configs/bulk-egregious",
  "/api/qlab/configs/cancel",
  "/api/qlab/questions/create",
  "/api/qlab/questions/update",
  "/api/qlab/questions/delete",
  "/api/qlab/runner/",
  "/api/qlab/assignments/",
  "/styles.css", "/favicon.svg", "/_fresh/",
];

// Backend API routes — everything under these prefixes goes to danet
const BACKEND_PREFIXES = [
  "/admin", "/audit", "/review/api", "/judge/api", "/manager/api",
  "/agent/api", "/api/qlab", "/api/messages", "/api/users", "/api/events",
  "/api/store", "/api/equip", "/api/badges", "/gamification", "/cron",
  "/webhooks", "/docs",
];

const AUTH_PATHS = ["/login", "/register", "/logout"];

function isBackendRequest(req: Request): boolean {
  const path = new URL(req.url).pathname;
  const accept = req.headers.get("accept") ?? "";
  const wantsJson = accept.includes("application/json");

  // Exact frontend page matches — but a server-side apiFetch loopback to the
  // SAME url would otherwise infinite-recurse (page handler renders, calls
  // apiFetch on its own URL, dispatcher routes to the page again, ...).
  // apiFetch always sets Accept: application/json, so when the request wants
  // JSON we route to the backend's same-URL JSON handler instead of looping
  // back through Fresh.
  if (FRONTEND_EXACT_PAGES.has(path)) return wantsJson;

  // Frontend prefix matches (HTMX fragments, static assets)
  if (FRONTEND_PREFIX_PATHS.some(p => path.startsWith(p))) return false;

  // Auth page paths: POST → backend (JSON API), GET → frontend (HTML page)
  if (AUTH_PATHS.some(p => path === p)) return req.method === "POST";

  // Root: GET from browser → Fresh (redirect to dashboard), JSON accept → backend health check
  if (path === "/") return wantsJson;

  // Everything else with a known backend prefix → danet
  return BACKEND_PREFIXES.some(p => path.startsWith(p));
}

// Build banner — proves the deployment is running this commit.
// Push parallelism settings to QStash so the queues actually enforce a
// concurrency cap. Fire-and-forget so boot doesn't block on QStash.
applyDefaultQueueParallelism().catch((e) => {
  console.error(`⚠️ [BOOT] applyDefaultQueueParallelism failed: ${e instanceof Error ? e.message : String(e)}`);
});

console.log(`🚀 [BOOT] autobottom deployed at ${new Date().toISOString()} — direct-dispatch v3 (appeal+reaudit) + qstash-parallelism`);

Deno.serve({ port }, (req, info) => {
  // Wrap the entire request lifecycle in AsyncLocalStorage so QStash callbacks
  // use this deployment's origin (not the inherited SELF_URL from .env).
  // Critical for branch preview deployments where the hostname is dynamic.
  const origin = new URL(req.url).origin;
  return runWithOrigin(origin, async () => {
    const path = new URL(req.url).pathname;

    // Top-level try/catch — guarantees we NEVER bubble an uncaught exception
    // up to Fresh's _500.tsx renderer for backend-style requests. Any throw
    // here gets logged + returned as JSON.
    try {

    // /admin/api/me — handled directly (danet's @Req doesn't work via router.fetch)
    if (path === "/admin/api/me") {
      console.log(`[ROUTER] ${req.method} ${path} → direct auth handler`);
      const auth = await authenticate(req);
      if (!auth) return Response.json({ error: "unauthorized" }, { status: 401 });
      return Response.json({ email: auth.email, orgId: auth.orgId, role: auth.role });
    }

    // /admin/kv-export, /admin/kv-inventory, /admin/kv-batch-list — direct
    // dispatch (KV_EXPORT_SECRET-gated, used by fixtures/scripts/migrate-fill.ts).
    // Same @Req-broken-via-router.fetch workaround as /admin/api/me.
    if (path === "/admin/kv-export") {
      console.log(`[ROUTER] ${req.method} ${path} → direct kv-export handler`);
      return handleKvExport(req);
    }
    if (path === "/admin/kv-inventory") {
      console.log(`[ROUTER] ${req.method} ${path} → direct kv-inventory handler`);
      return handleKvInventory(req);
    }
    if (path === "/admin/kv-batch-list") {
      console.log(`[ROUTER] ${req.method} ${path} → direct kv-batch-list handler`);
      return handleKvBatchList(req);
    }

    // /canary/errors — secret-gated (CANARY_SECRET) daily previous-day error
    // report for the external canary monitor. Direct-dispatch: /canary/* isn't
    // in any frontend/backend prefix list.
    if (path === "/canary/errors") {
      console.log(`[ROUTER] ${req.method} ${path} → direct canary-errors handler`);
      return handleCanaryErrors(req);
    }

    // SSE streams — direct-dispatched because danet controllers can't return
    // a streaming Response. Both endpoints subscribe to the in-memory event
    // bus; polling fallback (/api/events) covers cross-isolate misses.
    if (path === "/api/events/stream") {
      return handleEventsStream(req);
    }
    if (path === "/api/chat/stream") {
      return handleChatStream(req);
    }

    // /audit/api/appeal/upload-recording — direct (multipart; @Req broken)
    if (path === "/audit/api/appeal/upload-recording") {
      console.log(`[ROUTER] ${req.method} ${path} → direct upload-reaudit handler`);
      return handleUploadReauditAppeal(req);
    }

    // Direct-dispatch BOTH the backend URL AND the Fresh-proxy URL — eliminates
    // the proxy entirely so we never round-trip through Fresh + lose JSON.
    // Was returning Fresh's _500.tsx HTML because something in the loopback +
    // Fresh middleware stack was throwing. Skipping it solves the symptom
    // regardless of root cause.
    if (path === "/audit/api/appeal/different-recording" || path === "/api/audit/appeal/different-recording") {
      console.log(`[ROUTER] ${req.method} ${path} → direct reaudit-different-recording handler`);
      return handleReauditDifferentRecording(req);
    }

    if (path === "/audit/api/appeal" || path === "/api/audit/appeal") {
      console.log(`[ROUTER] ${req.method} ${path} → direct file-appeal handler`);
      return handleFileAppeal(req);
    }

    // /audit/test-by-rid + /audit/package-by-rid — direct-dispatch so n8n
    // POSTs with no body don't crash danet's @Body decoder.
    if (path === "/audit/test-by-rid") {
      console.log(`[ROUTER] ${req.method} ${path} → direct date-leg-audit handler`);
      return handleCreateDateLegAudit(req);
    }
    if (path === "/audit/package-by-rid") {
      console.log(`[ROUTER] ${req.method} ${path} → direct package-audit handler`);
      return handleCreatePackageAudit(req);
    }

    // /gamification/api/upload-sound — direct (multipart; @Req broken)
    if (path === "/gamification/api/upload-sound") {
      console.log(`[ROUTER] ${req.method} ${path} → direct upload-sound handler`);
      return handleUploadSound(req);
    }

    // Audit-email engagement tracking — public, unauthenticated (mail clients
    // hit these). Sig-verified; both fail-safe (never error the mail client).
    // /track/open records a (prefetch-filtered) open + returns a GIF.
    if (path === "/track/open") {
      const sp = new URL(req.url).searchParams;
      const fid = sp.get("fid") ?? "";
      if (fid && await verifyFinding(fid, sp.get("sig") ?? "")) {
        await recordOpen(defaultOrgId() as OrgId, fid, req);
      }
      return new Response(TRANSPARENT_GIF, {
        headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, no-cache, must-revalidate" },
      });
    }
    // /track/click records a click (binary) then 302-redirects to the real page.
    if (path === "/track/click") {
      const sp = new URL(req.url).searchParams;
      const fid = sp.get("fid") ?? "";
      if (fid && await verifyFinding(fid, sp.get("sig") ?? "")) {
        await recordClick(defaultOrgId() as OrgId, fid, req);
      }
      // Whitelist the destination; default to the report page. Always redirect.
      const to = sp.get("to") ?? "report";
      const rel = to === "recording"
        ? `audit/recording?id=${encodeURIComponent(fid)}`
        : to === "appeal"
        ? `audit/appeal?findingId=${encodeURIComponent(fid)}`
        : `audit/report?id=${encodeURIComponent(fid)}`;
      return Response.redirect(`${getSelfUrl()}/${rel}`, 302);
    }

    // Role-scoped "me"/game-state/dashboard — same @Req-broken-via-router.fetch
    // workaround as /admin/api/me. See AUTH_CONTEXT_HANDLERS map above.
    const authCtxHandler = AUTH_CONTEXT_HANDLERS[path];
    if (authCtxHandler) {
      console.log(`[ROUTER] ${req.method} ${path} → direct auth-context handler`);
      try {
        return await authCtxHandler(req);
      } catch (err) {
        console.error(`❌ [AUTH-CTX] ${path} threw:`, err);
        return Response.json({ error: (err as Error).message }, { status: 500 });
      }
    }

    // /audit/step/* — pipeline step callbacks from QStash. Handled directly
    // because @Req returns undefined via router.fetch() (same reason /admin/api/me
    // is direct). Without this bypass, QStash callbacks crash on req.json() and
    // audits hang at findingStatus=pending forever.
    if (path.startsWith("/audit/step/")) {
      const stepName = path.slice("/audit/step/".length);
      const stepHandler = STEP_HANDLERS[stepName];
      if (!stepHandler) {
        console.warn(`⚠️ [STEP] unknown step "${stepName}"`);
        return new Response(`Unknown step: ${stepName}`, { status: 404 });
      }
      // Peek findingId/orgId for tracking + log traceability — clone so the
      // real handler still reads the body. The dispatcher untracks the
      // active-tracking row in finally{} so the dashboard's "Active" panel
      // reflects only currently-running handlers (capped by QStash
      // parallelism), not "audits anywhere in the pipeline" (which is what
      // step-internal trackActive calls would otherwise leave behind for
      // every audit that's between steps).
      let findingId = "<unknown>";
      let orgId = "";
      let rid: string | undefined;
      try {
        const peek = await req.clone().json().catch(() => null);
        if (peek && typeof peek.findingId === "string") findingId = peek.findingId;
        if (peek && typeof peek.orgId === "string") orgId = peek.orgId;
        if (peek && typeof peek.rid === "string") rid = peek.rid;
      } catch { /* logging only — never break dispatch */ }

      console.log(`🔧 [STEP] ${stepName} finding=${findingId} invoked via direct dispatch`);
      // Run the ENTIRE pipeline dispatch (pre-track, stepHandler,
      // untrackHandler) inside the background lane. Without this, the
      // tracking writes ran in the foreground (default) lane and used
      // the foreground HTTP/2 client — so a transient foreground wedge
      // would abort pre-track / untrackHandler at 60s even though the
      // step handler itself ran cleanly in the background lane. Tracking
      // is an audit-pipeline concern; it belongs in the same lane as
      // the rest of the pipeline so it shares the background HTTP/2
      // pool. Pipeline + tracking now fully isolated from user requests.
      return await runInBackgroundLane(async () => {
        // Pre-track. We intentionally do NOT do a getFinding lookup here
        // for rid — that adds an extra Firestore read PER handler
        // invocation, and under load (e.g. 73 simultaneous bulk audits)
        // the cumulative FS load saturates the connection pool and
        // cascades into 60s aborts on every other FS call. If rid isn't
        // in the QStash body, step-init's own metadata trackActive call
        // (step-init/mod.ts:56) writes rid for init handlers; other
        // steps fall back to "—" in the dashboard's QB Record column.
        if (orgId && findingId !== "<unknown>") {
          try {
            const { trackActive } = await import("@audit/domain/data/stats-repository/mod.ts");
            await trackActive(orgId as OrgId, findingId, stepName, rid ? { rid } : undefined);
          } catch (preErr) {
            console.warn(`⚠️ [STEP] pre-track failed for ${stepName}/${findingId}:`, preErr);
          }
        }

        try {
          const res = await stepHandler(req);
          // Persist 5xx step responses as errors (handled failures that didn't
          // throw) so the daily canary endpoint + dashboard see them.
          if (res.status >= 500 && orgId && findingId !== "<unknown>") {
            const { trackError } = await import("@audit/domain/data/stats-repository/mod.ts");
            await trackError(orgId as OrgId, findingId, stepName, `${stepName} returned HTTP ${res.status}`).catch(() => {});
          }
          return res;
        } catch (err) {
          console.error(`❌ [STEP] ${stepName} finding=${findingId} threw:`, err);
          // Persist the thrown step error for the canary endpoint + dashboard.
          if (orgId && findingId !== "<unknown>") {
            const { trackError } = await import("@audit/domain/data/stats-repository/mod.ts");
            await trackError(orgId as OrgId, findingId, stepName, (err as Error).message ?? String(err)).catch(() => {});
          }
          return Response.json(
            { error: (err as Error).message, step: stepName, findingId },
            { status: 500 },
          );
        } finally {
          // Best-effort untrack — never break dispatch on a tracking failure.
          // Skip when we couldn't peek findingId/orgId (e.g. malformed body) —
          // there's nothing to untrack in that case anyway.
          if (orgId && findingId !== "<unknown>") {
            try {
              const { untrackHandler } = await import("@audit/domain/data/stats-repository/mod.ts");
              await untrackHandler(orgId as OrgId, findingId);
            } catch (untrackErr) {
              console.warn(`⚠️ [STEP] untrackHandler failed for ${stepName}/${findingId}:`, untrackErr);
            }
          }
        }
      });
    }

    // Fall-through dispatch — no log here; only the direct-dispatch branches
    // above log. Logging every request flooded the deploy logs (especially
    // when /admin/users self-recursed before the Accept-based dispatch landed).
    if (isBackendRequest(req)) return backendFetch(req);
    return frontendHandler(req, info);

    } catch (err) {
      // Backend-style requests (`/audit/*`, `/admin/*`, etc.) should never
      // return HTML — keep responses JSON so the modal can show the real
      // error instead of Fresh's _500.tsx page.
      //
      // FOOLPROOF SAFETY NET: buildDispatchErrorResponse() detects FS abort
      // errors and converts them to a structured retry response instead of a
      // raw 500. Reviewers were seeing `500 {"message":"signal aborted"}`
      // bubble up from endpoints we hadn't explicitly wrapped (e.g.
      // /admin/audits-by-record, /manager/api/*). Per-endpoint try/catch with
      // shape-correct fallback is still preferred for user-blocking GETs,
      // but this branch guarantees no raw abort reaches the client
      // regardless of which controller throws. Contract is unit-tested in
      // tests/dispatch-catch.test.ts.
      console.error(`❌ [DISPATCH-CATCH] ${req.method} ${path} threw:`, err);
      return buildDispatchErrorResponse(err, { method: req.method, path });
    }
  });
});

console.log(`🚀 Autobottom running on port ${port} (API + Frontend)`);
