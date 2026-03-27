import { stepInit } from "./src/domain/coordinators/pipeline/init/mod.ts";
import { stepTranscribe } from "./src/domain/coordinators/pipeline/transcribe/mod.ts";
import { stepTranscribeCb } from "./src/domain/coordinators/pipeline/diarize/mod.ts";
import { stepPrepare } from "./src/domain/coordinators/pipeline/prepare/mod.ts";
import { stepAskBatch } from "./src/domain/coordinators/pipeline/ask-batch/mod.ts";
import { stepFinalize } from "./src/domain/coordinators/pipeline/finalize/mod.ts";
import { stepCleanup } from "./src/domain/coordinators/pipeline/cleanup/mod.ts";
import {
  handleAuditByRid, handlePackageByRid, handleGetFinding,
  handleGetStats, handleGetRecording, handleFileAppeal, handleAppealStatus,
  handleAppealDifferentRecording, handleAppealUploadRecording,
} from "./src/entrypoints/api.ts";
import { getTokenUsage } from "./src/domain/data/groq/mod.ts";
import { getOpenApiSpec, getSwaggerHtml, getDocsIndexHtml } from "./src/entrypoints/swagger.ts";
import { enqueueStep } from "./src/domain/data/queue/mod.ts";
import {
  trackError, trackRetry, trackCompleted, getStats, getPipelineConfig, setPipelineConfig,
  saveFinding, saveTranscript, saveBatchAnswers,
  getWebhookConfig, saveWebhookConfig, listEmailReportConfigs, saveEmailReportConfig, deleteEmailReportConfig,
  getAllAnswersForFinding,
  getGamificationSettings, saveGamificationSettings,
  getJudgeGamificationOverride, saveJudgeGamificationOverride,
  getReviewerGamificationOverride, saveReviewerGamificationOverride,
  resolveGamificationSettings,
  listSoundPacks, getSoundPack, saveSoundPack, deleteSoundPack,
  getEarnedBadges,
  getEvents, deleteEvents,
  sendMessage, getConversation, getUnreadCount, markConversationRead, getConversationList,
  getGameState, saveGameState,
  getPrefabSubscriptions, savePrefabSubscriptions, getBroadcastEvents,
  listCustomStoreItems, saveCustomStoreItem, deleteCustomStoreItem,
} from "./src/domain/data/kv/mod.ts";
import type { WebhookConfig, WebhookKind, GamificationSettings, SoundPackMeta, SoundSlot } from "./src/domain/data/kv/mod.ts";
import { S3Ref } from "./src/domain/data/s3/mod.ts";
import { sendEmail } from "./src/domain/data/postmark/mod.ts";
import { env } from "./src/env.ts";
import { orgKey } from "./src/domain/data/kv/org.ts";
import type { OrgId } from "./src/domain/data/kv/org.ts";

// Auth handlers
import { handleRegisterPost, handleLoginPost, handleLogoutPost } from "./src/entrypoints/auth.ts";
// Chat handlers
import { handleChatMe, handleChatCosmetics, handleEquip } from "./src/entrypoints/chat.ts";
// Store handlers
import { handleGetPrefabSubscriptions, handleSavePrefabSubscriptions } from "./src/entrypoints/store.ts";
// Gamification handlers
import {
  handleJudgeGetGamification, handleJudgeSaveGamification,
  handleReviewerGetGamification, handleReviewerSaveGamification,
  handleBadgesApi,
  handleListPacks, handleSavePack, handleDeletePack,
  handleUploadSound, handleSeedSoundPacks,
  handleGamificationPageGetSettings, handleGamificationPageSaveSettings,
  BUILTIN_PACKS, BUILTIN_PACK_NAMES,
} from "./src/entrypoints/gamification.ts";
// Messaging handlers
import {
  handleSSE, handleSendMessage, handleGetConversation,
  handleGetUnread, handleGetConversations, handleGetOrgUsers,
} from "./src/entrypoints/messaging.ts";
// Admin handlers
import {
  handleDashboardData, handleAdminMe,
  handleBadgeEditorItems, handleBadgeEditorSave, handleBadgeEditorDelete,
  handleAdminGetSettings, handleAdminSaveSettings,
  handleAdminListUsers, handleAdminAddUser,
  handleGetPipelineConfig, handleSetPipelineConfig,
  handleAdminGetGamification, handleAdminSaveGamification,
  handleGetQueues, handleSetQueue, handleGetParallelism, handleSetParallelism,
  handleListEmailReports, handleSaveEmailReport, handleDeleteEmailReport,
  handleTokenUsage, handleForceNos,
  handleSeedDryRun, handleSeed,
  handleResetFinding, handleWipeKv,
} from "./src/entrypoints/admin.ts";
// Super-admin handlers
import { routeSuperAdmin } from "./src/entrypoints/super-admin.ts";

// Unified auth
import {
  authenticate, resolveEffectiveAuth, createOrg, createUser, deleteUser, getUser, verifyUser,
  createSession, deleteSession, listUsers, listOrgs, getOrg, deleteOrg,
  parseCookie, sessionCookie, clearSessionCookie,
} from "./src/domain/coordinators/auth/mod.ts";
import type { AuthContext } from "./src/domain/coordinators/auth/mod.ts";

// Review (unified auth)
import {
  handleNext, handleDecide, handleBack,
  handleGetSettings, handleSaveSettings, handleStats, handleBackfill,
  handleReviewDashboardData, handleReviewMe,
} from "./src/domain/coordinators/review/handlers.ts";
import { getReviewStats, populateReviewQueue } from "./src/domain/coordinators/review/mod.ts";

// Judge (unified auth)
import {
  handleNext as handleJudgeNext,
  handleDecide as handleJudgeDecide,
  handleBack as handleJudgeBack,
  handleStats as handleJudgeStats,
  handleDashboardData as handleJudgeDashboardData,
  handleJudgeMe,
  handleJudgeListReviewers, handleJudgeCreateReviewer, handleJudgeDeleteReviewer,
} from "./src/domain/coordinators/judge/handlers.ts";
import { getAppealStats, populateJudgeQueue, saveAppeal, recordDecision as recordJudgeDecision } from "./src/domain/coordinators/judge/mod.ts";

// Manager (unified auth)
import {
  handleManagerMe, handleManagerQueueList, handleManagerFinding,
  handleManagerRemediate, handleManagerStatsFetch, handleManagerBackfill,
  handleManagerListAgents, handleManagerCreateAgent, handleManagerDeleteAgent,
  handleManagerGameState,
} from "./src/domain/coordinators/manager/handlers.ts";

// Agent (unified auth)
import { handleAgentDashboardData, handleAgentMe, handleAgentGameState, handleAgentStore, handleAgentStoreBuy } from "./src/domain/coordinators/agent/handlers.ts";

// Dashboard + Question Lab
import { routeQuestionLab } from "./src/domain/coordinators/question-lab/handlers.ts";

// Gamification + Store + Badges
import { STORE_CATALOG, PREFAB_EVENTS, rarityFromPrice } from "./src/domain/business/gamification/badges/mod.ts";
import type { StoreItem } from "./src/domain/business/gamification/badges/mod.ts";

// KV factory
import { kvFactory } from "./src/domain/data/kv/factory.ts";

// -- Helpers --

type Handler = (req: Request) => Promise<Response>;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function html(body: string): Response {
  return new Response(body, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

async function requireAuth(req: Request): Promise<AuthContext | Response> {
  const auth = await resolveEffectiveAuth(req);
  if (!auth) return json({ error: "unauthorized" }, 401);
  return auth;
}

const ROLE_HOME: Record<string, string> = {
  admin: "/admin/dashboard",
  judge: "/judge/dashboard",
  manager: "/manager",
  reviewer: "/review/dashboard",
  user: "/agent",
};

function requireRolePageAuth(allowedRoles: string[], handler: Handler): Handler {
  return async (req) => {
    const auth = await authenticate(req);
    if (!auth) return Response.redirect(new URL("/login", req.url).href, 302);
    if (auth.role !== "admin" && !allowedRoles.includes(auth.role))
      return Response.redirect(new URL(ROLE_HOME[auth.role] ?? "/", req.url).href, 302);
    return handler(req);
  };
}

async function requireAdminAuth(req: Request): Promise<AuthContext | Response> {
  const auth = await authenticate(req);
  if (!auth) return json({ error: "unauthorized" }, 401);
  if (auth.role !== "admin") return json({ error: "forbidden" }, 403);
  return auth;
}

/** Resolve orgId: try auth, then ?org query param, then default org. */
async function resolveOrgId(req: Request): Promise<OrgId | null> {
  const auth = await authenticate(req);
  if (auth) return auth.orgId;
  const url = new URL(req.url);
  const org = url.searchParams.get("org");
  if (org) return org;
  const db = await kvFactory();
  const def = await db.get<string>(["default-org"]);
  return def.value ?? null;
}

/** Wrap a controller function that needs orgId (resolved from auth/query/default). */
function withOrgId(fn: (orgId: OrgId, req: Request) => Promise<Response>): Handler {
  return async (req) => {
    const orgId = await resolveOrgId(req);
    if (!orgId) return json({ error: "org required (authenticate or provide ?org=)" }, 400);
    return fn(orgId, req);
  };
}

/** Wrap a POST controller function that reads orgId from the request body. */
function withBodyOrg(fn: (orgId: OrgId, req: Request) => Promise<Response>): Handler {
  return async (req) => {
    const cloned = req.clone();
    try {
      const body = await cloned.json();
      if (!body.orgId) return json({ error: "orgId required in body" }, 400);
      return fn(body.orgId, req);
    } catch {
      return json({ error: "invalid JSON body" }, 400);
    }
  };
}

// -- Route Tables --

const postRoutes: Record<string, Handler> = {
  // Pipeline steps (called by QStash, orgId in body)
  "/audit/step/init": stepInit,
  "/audit/step/transcribe": stepTranscribe,
  "/audit/step/transcribe-complete": stepTranscribeCb,
  "/audit/step/prepare": stepPrepare,
  "/audit/step/ask-batch": stepAskBatch,
  "/audit/step/finalize": stepFinalize,
  "/audit/step/cleanup": stepCleanup,

  // API endpoints (orgId in body)
  "/audit/test-by-rid": withBodyOrg(handleAuditByRid),
  "/audit/package-by-rid": withBodyOrg(handlePackageByRid),

  // Auth
  "/register": handleRegisterPost,
  "/login": handleLoginPost,
  "/logout": handleLogoutPost,

  // Admin (auth required)
  "/admin/wipe-kv": handleWipeKv,
  "/admin/force-nos": handleForceNos,
  "/admin/seed": handleSeed,
  "/admin/queues": handleSetQueue,
  "/admin/pipeline-config": handleSetPipelineConfig,
  "/admin/settings/terminate": handleAdminSaveSettings,
  "/admin/settings/appeal": handleAdminSaveSettings,
  "/admin/settings/manager": handleAdminSaveSettings,
  "/admin/settings/review": handleAdminSaveSettings,
  "/admin/settings/judge": handleAdminSaveSettings,
  "/admin/settings/judge-finish": handleAdminSaveSettings,
  "/admin/users": handleAdminAddUser,
  "/admin/parallelism": handleSetParallelism,
  "/admin/email-reports": handleSaveEmailReport,
  "/admin/email-reports/delete": handleDeleteEmailReport,
  "/admin/reset-finding": handleResetFinding,

  // Appeal (orgId in body)
  "/audit/appeal": withBodyOrg(handleFileAppeal),
  "/audit/appeal/different-recording": withBodyOrg(handleAppealDifferentRecording),
  "/audit/appeal/upload-recording": withBodyOrg(handleAppealUploadRecording),

  // Review API (auth handled internally)
  "/review/api/decide": handleDecide,
  "/review/api/back": handleBack,
  "/review/api/settings": handleSaveSettings,
  "/review/api/backfill": handleBackfill,
  "/review/api/gamification": handleReviewerSaveGamification,

  // Judge API (auth handled internally)
  "/judge/api/decide": handleJudgeDecide,
  "/judge/api/back": handleJudgeBack,
  "/judge/api/reviewers": handleJudgeCreateReviewer,
  "/judge/api/reviewers/delete": handleJudgeDeleteReviewer,
  "/judge/api/gamification": handleJudgeSaveGamification,

  // Admin gamification
  "/admin/settings/gamification": handleAdminSaveGamification,

  // Badge editor (admin)
  "/admin/badge-editor/item": handleBadgeEditorSave,
  "/admin/badge-editor/item/delete": handleBadgeEditorDelete,

  // Gamification page API
  "/gamification/api/pack": handleSavePack,
  "/gamification/api/pack/delete": handleDeletePack,
  "/gamification/api/upload-sound": handleUploadSound,
  "/gamification/api/seed": handleSeedSoundPacks,
  "/gamification/api/settings": handleGamificationPageSaveSettings,

  // Store (unified, all roles)
  "/api/store/buy": handleAgentStoreBuy,
  "/api/equip": handleEquip,

  // Agent API (auth handled internally)
  "/agent/api/store/buy": handleAgentStoreBuy,

  // Manager API (auth handled internally)
  "/manager/api/remediate": handleManagerRemediate,
  "/manager/api/backfill": handleManagerBackfill,
  "/manager/api/agents": handleManagerCreateAgent,
  "/manager/api/agents/delete": handleManagerDeleteAgent,
  "/manager/api/prefab-subscriptions": handleSavePrefabSubscriptions,

  // Messaging API
  "/api/messages": handleSendMessage,
};

const getRoutes: Record<string, Handler> = {
  "/api/badges": handleBadgesApi,
  "/api/store": handleAgentStore,
  "/api/events": handleSSE,
  "/api/messages/unread": handleGetUnread,
  "/api/messages/conversations": handleGetConversations,
  "/api/users": handleGetOrgUsers,
  "/chat/api/me": handleChatMe,
  "/chat/api/cosmetics": handleChatCosmetics,

  // Public-ish (orgId from auth/query/default)
  "/audit/finding": withOrgId(handleGetFinding),
  "/audit/stats": withOrgId(handleGetStats),
  "/audit/recording": withOrgId(handleGetRecording),
  "/audit/appeal/status": withOrgId(handleAppealStatus),

  // Admin
  "/admin/seed": handleSeedDryRun,
  "/admin/token-usage": handleTokenUsage,
  "/admin/queues": handleGetQueues,
  "/admin/pipeline-config": handleGetPipelineConfig,
  "/admin/settings/terminate": handleAdminGetSettings,
  "/admin/settings/appeal": handleAdminGetSettings,
  "/admin/settings/manager": handleAdminGetSettings,
  "/admin/settings/review": handleAdminGetSettings,
  "/admin/settings/judge": handleAdminGetSettings,
  "/admin/settings/judge-finish": handleAdminGetSettings,
  "/admin/parallelism": handleGetParallelism,
  "/admin/users": handleAdminListUsers,
  "/admin/email-reports": handleListEmailReports,
  "/docs/index": () => Promise.resolve(html(getDocsIndexHtml())),
  "/docs/datamodule": () => Promise.resolve(html(getSwaggerHtml())),
  "/api/openapi.json": () => Promise.resolve(json(getOpenApiSpec())),

  // Review API
  "/review/api/next": handleNext,
  "/review/api/settings": handleGetSettings,
  "/review/api/stats": handleStats,
  "/review/api/me": handleReviewMe,
  "/review/api/dashboard": handleReviewDashboardData,
  "/review/api/gamification": handleReviewerGetGamification,

  // Judge API
  "/judge/api/next": handleJudgeNext,
  "/judge/api/stats": handleJudgeStats,
  "/judge/api/me": handleJudgeMe,
  "/judge/api/reviewers": handleJudgeListReviewers,
  "/judge/api/dashboard": handleJudgeDashboardData,
  "/judge/api/gamification": handleJudgeGetGamification,

  // Admin gamification
  "/admin/settings/gamification": handleAdminGetGamification,

  // Gamification page API
  "/gamification/api/packs": handleListPacks,
  "/gamification/api/settings": handleGamificationPageGetSettings,

  // Badge editor API (admin only)
  "/admin/badge-editor/items": handleBadgeEditorItems,

  // Dashboard (admin only)
  "/admin/dashboard/data": handleDashboardData,
  "/admin/api/me": handleAdminMe,

  // Agent API
  "/agent/api/dashboard": handleAgentDashboardData,
  "/agent/api/me": handleAgentMe,
  "/agent/api/game-state": handleAgentGameState,
  "/agent/api/store": handleAgentStore,

  // Manager API
  "/manager/api/queue": handleManagerQueueList,
  "/manager/api/finding": handleManagerFinding,
  "/manager/api/stats": handleManagerStatsFetch,
  "/manager/api/me": handleManagerMe,
  "/manager/api/game-state": handleManagerGameState,
  "/manager/api/agents": handleManagerListAgents,
  "/manager/api/prefab-subscriptions": handleGetPrefabSubscriptions,
};

// Auth handlers extracted to ./src/entrypoints/auth.ts
// Admin handlers extracted to ./src/entrypoints/admin.ts
// Super-admin handlers extracted to ./src/entrypoints/super-admin.ts
// Gamification handlers extracted to ./src/entrypoints/gamification.ts

// Messaging handlers extracted to ./src/entrypoints/messaging.ts

// -- Server --

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Health check
  if (url.pathname === "/health") {
    return json({ ok: true, ts: Date.now() });
  }

  // Serve sound files from S3: /sounds/{orgId}/{packId}/{slot}.mp3
  if (req.method === "GET" && url.pathname.startsWith("/sounds/")) {
    const parts = url.pathname.replace("/sounds/", "").split("/");
    if (parts.length === 3 && parts[2].endsWith(".mp3")) {
      const [orgId, packId, slotFile] = parts;
      const s3Key = `sounds/${orgId}/${packId}/${slotFile}`;
      try {
        const ref = new S3Ref(env.s3Bucket, s3Key);
        const bytes = await ref.get();
        if (!bytes) return json({ error: "not found" }, 404);
        return new Response(bytes, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=86400" } });
      } catch { return json({ error: "not found" }, 404); }
    }
    // Legacy: serve local files by name (fallback during migration)
    const name = url.pathname.replace("/sounds/", "");
    if (/^[\w\-.]+\.mp3$/.test(name)) {
      try {
        const bytes = await Deno.readFile(new URL("./sounds/" + name, import.meta.url));
        return new Response(bytes, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=86400" } });
      } catch { return json({ error: "not found" }, 404); }
    }
    return json({ error: "bad path" }, 400);
  }

  // Dynamic message conversation route: GET /api/messages/{email}
  if (req.method === "GET" && url.pathname.startsWith("/api/messages/") &&
      url.pathname !== "/api/messages/unread" && url.pathname !== "/api/messages/conversations") {
    try {
      return await handleGetConversation(req);
    } catch (e) {
      console.error(`[${url.pathname}] error:`, e);
      return json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  }

  // GET routes
  if (req.method === "GET") {
    const handler = getRoutes[url.pathname];
    if (handler) {
      try {
        return await handler(req);
      } catch (e) {
        console.error(`[${url.pathname}] error:`, e);
        return json({ error: e instanceof Error ? e.message : String(e) }, 500);
      }
    }
  }

  // POST routes
  if (req.method === "POST") {
    const handler = postRoutes[url.pathname];
    if (handler) {
      // Pipeline steps: app-level retry on error (return 200 to free queue slot)
      const isPipelineStep = url.pathname.startsWith("/audit/step/");
      let bodyForRetry: Record<string, any> = {};
      if (isPipelineStep) {
        try { bodyForRetry = await req.clone().json(); } catch { /* no body */ }
      }
      try {
        return await handler(req);
      } catch (e) {
        console.error(`[${url.pathname}] error:`, e);
        const msg = e instanceof Error ? e.message : String(e);

        if (isPipelineStep) {
          const retryOrgId = bodyForRetry.orgId ?? "";
          const pipelineCfg = retryOrgId ? await getPipelineConfig(retryOrgId) : { maxRetries: 3, retryDelaySeconds: 30 };
          const attempt = (bodyForRetry._retry ?? 0) + 1;
          const stepName = url.pathname.replace("/audit/step/", "");
          const fid = bodyForRetry.findingId ?? "unknown";

          if (retryOrgId) {
            trackError(retryOrgId, fid, stepName, msg).catch(() => {});
          }

          if (attempt <= pipelineCfg.maxRetries) {
            const is429 = msg.includes("429") || msg.toLowerCase().includes("rate limit");
            const delay = is429 ? pipelineCfg.retryDelaySeconds : undefined;
            console.warn(`[${url.pathname}] Re-enqueuing (attempt ${attempt}/${pipelineCfg.maxRetries})${is429 ? ` [429 delay ${pipelineCfg.retryDelaySeconds}s]` : ""}`);
            if (retryOrgId) {
              trackRetry(retryOrgId, fid, stepName, attempt).catch(() => {});
            }
            try {
              const retryBody = { ...bodyForRetry, _retry: attempt };
              await enqueueStep(stepName, retryBody, delay);
            } catch (requeueErr) {
              console.error(`[${url.pathname}] Failed to re-enqueue:`, requeueErr);
            }
          } else {
            console.error(`[${url.pathname}] Max retries (${pipelineCfg.maxRetries}) exhausted for findingId=${fid}`);
            if (retryOrgId) {
              trackCompleted(retryOrgId, fid).catch(() => {});
            }
            sendEmail({
              to: env.alertEmail,
              subject: `[Auto-Bot] Pipeline retries exhausted: ${stepName}`,
              htmlBody: `<h3>Pipeline Step Failed</h3>
<p><b>Finding ID:</b> ${fid}</p>
<p><b>Step:</b> ${stepName}</p>
<p><b>Retries:</b> ${attempt - 1}/${pipelineCfg.maxRetries}</p>
<p><b>Error:</b></p><pre>${msg}</pre>
<p><a href="${env.selfUrl}/audit/report?id=${fid}">View Report</a></p>`,
            }).catch((emailErr) => console.error(`[${url.pathname}] Failed to send alert email:`, emailErr));
          }
          return json({ error: msg, retried: attempt <= pipelineCfg.maxRetries, attempt }, 200);
        }

        return json({ error: msg }, 500);
      }
    }
  }

  // Super Admin API (session-gated: must be logged in as ai@monsterrg.com)
  if (url.pathname.startsWith("/super-admin/api")) {
    const sa = await authenticate(req);
    if (!sa || sa.email !== "ai@monsterrg.com") {
      return json({ error: "unauthorized" }, 401);
    }
    try {
      return await routeSuperAdmin(req);
    } catch (e) {
      console.error(`[${url.pathname}] error:`, e);
      return json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  }

  // Question Lab (prefix-based routing for dynamic paths)
  if (url.pathname.startsWith("/question-lab")) {
    try {
      return await routeQuestionLab(req);
    } catch (e) {
      console.error(`[${url.pathname}] error:`, e);
      return json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  }

  return json({ error: "not found" }, 404);
});
