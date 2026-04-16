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

const danetApp = new DanetApplication();
await danetApp.init(AppModule);

// Register in-process webhook email handlers. fireWebhook("terminate", ...) in
// stepFinalize routes through here to actually send the audit-complete email.
// Without this, fireWebhook silently no-ops because no handler is registered.
registerAllWebhookEmailHandlers();

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
