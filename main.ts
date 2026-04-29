/** Unified entrypoint — serves both backend API (danet) and frontend (Fresh) from one process. */
import "npm:reflect-metadata@0.1.13";

// Initialize Datadog OTel before anything loads
import { initOtel } from "@core/data/datadog-otel/mod.ts";
initOtel();

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
import { bucketWeeklyTrend } from "@audit/domain/business/agent-trend/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

// --- Pipeline step functions: dispatched DIRECTLY by this handler (bypassing
// danet) because danet's @Req decorator returns undefined when reached via
// router.fetch(), which crashes the step handlers. See plan notes (repo root
// plan file) for the investigation. Same pattern as /admin/api/me above. ---
import {
  stepInit, stepTranscribe, stepTranscribeCb, stepPollTranscript,
  stepDiarizeAsync, stepPineconeAsync, stepPrepare,
  stepAskBatch, stepAskAll, stepFinalize, stepCleanup, stepBadWordCheck,
} from "@audit/mod-root.ts";

const STEP_HANDLERS: Record<string, (req: Request) => Promise<Response>> = {
  "init": stepInit,
  "transcribe": stepTranscribe,
  "poll-transcript": stepPollTranscript,
  "transcribe-complete": stepTranscribeCb,
  "diarize-async": stepDiarizeAsync,
  "pinecone-async": stepPineconeAsync,
  "prepare": stepPrepare,
  "ask-batch": stepAskBatch,
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
  const [gs, badges] = await Promise.all([
    getGameState(auth.orgId, auth.email),
    getEarnedBadges(auth.orgId, auth.email),
  ]);
  return Response.json({ ...gs, badges: badges.map((b) => b.badgeId) });
}

async function handleGetBadges(req: Request): Promise<Response> {
  const auth = await authenticate(req);
  if (!auth) return Response.json({ error: "unauthorized" }, { status: 401 });
  const badges = await getEarnedBadges(auth.orgId, auth.email);
  return Response.json({ badges });
}

async function handleAgentDashboard(req: Request): Promise<Response> {
  const auth = await authenticate(req);
  if (!auth) return Response.json({ error: "unauthorized" }, { status: 401 });
  const db = await getKv();
  const findingIds = new Set<string>();
  for await (const entry of db.list({ prefix: orgKey(auth.orgId, "audit-finding") })) {
    const key = entry.key as Deno.KvKey;
    if (key.length >= 3 && typeof key[2] === "string") findingIds.add(key[2] as string);
  }
  let totalYes = 0, totalQuestions = 0;
  let perfectCount = 0;
  const audits: Array<Record<string, unknown>> = [];
  const scorePoints: Array<{ completedAt: number; score: number }> = [];

  for (const findingId of findingIds) {
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
  "/agent/api/game-state": handleGameState,
  "/agent/api/dashboard": handleAgentDashboard,
  "/api/badges": handleGetBadges,
};

const danetApp = new DanetApplication();
await danetApp.init(AppModule);

// Register in-process webhook email handlers. fireWebhook("terminate", ...) in
// stepFinalize routes through here to actually send the audit-complete email.
// Without this, fireWebhook silently no-ops because no handler is registered.
console.log("📧 [WEBHOOK] about to register email handlers...");
registerAllWebhookEmailHandlers();
console.log("📧 [WEBHOOK] registration complete, continuing boot");

// @ts-ignore — router is Hono app with .fetch()
const backendFetch: (req: Request) => Promise<Response> = danetApp.router.fetch.bind(danetApp.router);

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
  "/review", "/review/dashboard",
  "/judge", "/judge/dashboard",
  "/manager", "/agent", "/chat", "/store", "/question-lab",
  "/audit/report",
  "/super-admin",
  "/gamification",
]);

// Frontend PREFIX paths — anything starting with these goes to Fresh
const FRONTEND_PREFIX_PATHS = [
  "/api/login", "/api/register", "/api/logout",
  "/api/admin/", "/api/review/", "/api/judge/",
  "/api/manager/", "/api/agent/", "/api/chat/",
  "/api/super-admin/",
  "/api/gamification/",
  "/api/store/buy",
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

  // Exact frontend page matches
  if (FRONTEND_EXACT_PAGES.has(path)) return false;

  // Frontend prefix matches (HTMX fragments, static assets)
  if (FRONTEND_PREFIX_PATHS.some(p => path.startsWith(p))) return false;

  // Auth page paths: POST → backend (JSON API), GET → frontend (HTML page)
  if (AUTH_PATHS.some(p => path === p)) return req.method === "POST";

  // Root: GET from browser → Fresh (redirect to dashboard), JSON accept → backend health check
  if (path === "/") return req.headers.get("accept")?.includes("application/json") === true;

  // Everything else with a known backend prefix → danet
  return BACKEND_PREFIXES.some(p => path.startsWith(p));
}

// Build banner — proves the deployment is running this commit.
console.log(`🚀 [BOOT] autobottom deployed at ${new Date().toISOString()} — direct-dispatch v3 (appeal+reaudit)`);

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

    // /gamification/api/upload-sound — direct (multipart; @Req broken)
    if (path === "/gamification/api/upload-sound") {
      console.log(`[ROUTER] ${req.method} ${path} → direct upload-sound handler`);
      return handleUploadSound(req);
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
      // Peek findingId for log traceability — clone so the real handler still reads the body.
      let findingId = "<unknown>";
      try {
        const peek = await req.clone().json().catch(() => null);
        if (peek && typeof peek.findingId === "string") findingId = peek.findingId;
      } catch { /* logging only — never break dispatch */ }
      console.log(`🔧 [STEP] ${stepName} finding=${findingId} invoked via direct dispatch`);
      try {
        return await stepHandler(req);
      } catch (err) {
        console.error(`❌ [STEP] ${stepName} finding=${findingId} threw:`, err);
        return Response.json(
          { error: (err as Error).message, step: stepName, findingId },
          { status: 500 },
        );
      }
    }

    if (isBackendRequest(req)) {
      console.log(`[ROUTER] ${req.method} ${path} → backend (danet)`);
      return backendFetch(req);
    }
    console.log(`[ROUTER] ${req.method} ${path} → frontend (Fresh)`);
    return frontendHandler(req, info);

    } catch (err) {
      // Backend-style requests (`/audit/*`, `/admin/*`, etc.) should never
      // return HTML — keep responses JSON so the modal can show the real
      // error instead of Fresh's _500.tsx page.
      console.error(`❌ [DISPATCH-CATCH] ${req.method} ${path} threw:`, err);
      return Response.json(
        { ok: false, error: (err as Error).message ?? String(err), path, method: req.method },
        { status: 500 },
      );
    }
  });
});

console.log(`🚀 Autobottom running on port ${port} (API + Frontend)`);
