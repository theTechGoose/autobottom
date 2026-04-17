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
  const audits: Array<Record<string, unknown>> = [];
  for (const findingId of findingIds) {
    const finding = await getFinding(auth.orgId, findingId);
    if (!finding || finding.findingStatus !== "finished") continue;
    if (finding.owner !== auth.email) continue;
    const qs: Array<{ answer: string }> = finding.answeredQuestions ?? [];
    const passed = qs.filter((q) => q.answer === "Yes").length;
    const failed = qs.filter((q) => q.answer === "No").length;
    totalYes += passed;
    totalQuestions += qs.length;
    audits.push({
      findingId,
      recordId: (finding.record as Record<string, unknown> | undefined)?.RecordId ?? "",
      recordingId: finding.recordingId ?? "",
      totalQuestions: qs.length,
      passedCount: passed,
      failedCount: failed,
      completedAt: finding.completedAt ?? Date.now(),
      score: qs.length > 0 ? Math.round((passed / qs.length) * 100) : 0,
    });
  }
  audits.sort((a, b) => Number(b.completedAt) - Number(a.completedAt));
  const avgScore = totalQuestions > 0 ? Math.round((totalYes / totalQuestions) * 100) : 0;
  return Response.json({
    email: auth.email,
    totalAudits: audits.length,
    avgScore,
    recentAudits: audits.slice(0, 20),
    weeklyTrend: [],
  });
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
]);

// Frontend PREFIX paths — anything starting with these goes to Fresh
const FRONTEND_PREFIX_PATHS = [
  "/api/login", "/api/register", "/api/logout",
  "/api/admin/", "/api/review/", "/api/judge/",
  "/api/manager/", "/api/agent/", "/api/chat/",
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

Deno.serve({ port }, (req, info) => {
  // Wrap the entire request lifecycle in AsyncLocalStorage so QStash callbacks
  // use this deployment's origin (not the inherited SELF_URL from .env).
  // Critical for branch preview deployments where the hostname is dynamic.
  const origin = new URL(req.url).origin;
  return runWithOrigin(origin, async () => {
    const path = new URL(req.url).pathname;

    // /admin/api/me — handled directly (danet's @Req doesn't work via router.fetch)
    if (path === "/admin/api/me") {
      console.log(`[ROUTER] ${req.method} ${path} → direct auth handler`);
      const auth = await authenticate(req);
      if (!auth) return Response.json({ error: "unauthorized" }, { status: 401 });
      return Response.json({ email: auth.email, orgId: auth.orgId, role: auth.role });
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
  });
});

console.log(`🚀 Autobottom running on port ${port} (API + Frontend)`);
