/**
 * Application bootstrap — server entry point.
 * All route tables and server wiring live here.
 */

import { stepInit } from "./domain/coordinators/pipeline/init/mod.ts";
import { stepTranscribe } from "./domain/coordinators/pipeline/transcribe/mod.ts";
import { stepTranscribeCb } from "./domain/coordinators/pipeline/diarize/mod.ts";
import { stepPrepare } from "./domain/coordinators/pipeline/prepare/mod.ts";
import { stepAskBatch } from "./domain/coordinators/pipeline/ask-batch/mod.ts";
import { stepFinalize } from "./domain/coordinators/pipeline/finalize/mod.ts";
import { stepCleanup } from "./domain/coordinators/pipeline/cleanup/mod.ts";
import {
  handleAuditByRid, handlePackageByRid, handleGetFinding,
  handleGetStats, handleGetRecording, handleFileAppeal, handleAppealStatus,
  handleAppealDifferentRecording, handleAppealUploadRecording,
} from "./entrypoints/api.ts";
import { getOpenApiSpec, getSwaggerHtml, getDocsIndexHtml } from "./entrypoints/swagger.ts";
import { authenticate } from "./domain/coordinators/auth/mod.ts";

// Routing helpers
import { json, html, withOrgId, withBodyOrg } from "./entrypoints/helpers.ts";
import type { Handler } from "./entrypoints/helpers.ts";

// Pipeline retry middleware
import { withPipelineRetry } from "./entrypoints/pipeline-retry.ts";

// Sound file handler
import { handleSoundFile } from "./entrypoints/sounds.ts";

// Auth handlers
import { handleRegisterPost, handleLoginPost, handleLogoutPost } from "./entrypoints/auth.ts";
// Chat handlers
import { handleChatMe, handleChatCosmetics, handleEquip } from "./entrypoints/chat.ts";
// Store handlers
import { handleGetPrefabSubscriptions, handleSavePrefabSubscriptions } from "./entrypoints/store.ts";
// Gamification handlers
import {
  handleJudgeGetGamification, handleJudgeSaveGamification,
  handleReviewerGetGamification, handleReviewerSaveGamification,
  handleBadgesApi,
  handleListPacks, handleSavePack, handleDeletePack,
  handleUploadSound, handleSeedSoundPacks,
  handleGamificationPageGetSettings, handleGamificationPageSaveSettings,
} from "./entrypoints/gamification.ts";
// Messaging handlers
import {
  handleSSE, handleSendMessage, handleGetConversation,
  handleGetUnread, handleGetConversations, handleGetOrgUsers,
} from "./entrypoints/messaging.ts";
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
} from "./entrypoints/admin.ts";
// Super-admin handlers
import { routeSuperAdmin } from "./entrypoints/super-admin.ts";
// Review handlers
import {
  handleNext, handleDecide, handleBack,
  handleGetSettings, handleSaveSettings, handleStats, handleBackfill,
  handleReviewDashboardData, handleReviewMe,
} from "./entrypoints/review.ts";
// Judge handlers
import {
  handleNext as handleJudgeNext,
  handleDecide as handleJudgeDecide,
  handleBack as handleJudgeBack,
  handleStats as handleJudgeStats,
  handleDashboardData as handleJudgeDashboardData,
  handleJudgeMe,
  handleJudgeListReviewers, handleJudgeCreateReviewer, handleJudgeDeleteReviewer,
} from "./entrypoints/judge.ts";
// Manager handlers
import {
  handleManagerMe, handleManagerQueueList, handleManagerFinding,
  handleManagerRemediate, handleManagerStatsFetch, handleManagerBackfill,
  handleManagerListAgents, handleManagerCreateAgent, handleManagerDeleteAgent,
  handleManagerGameState,
} from "./entrypoints/manager.ts";
// Agent handlers
import { handleAgentDashboardData, handleAgentMe, handleAgentGameState, handleAgentStore, handleAgentStoreBuy } from "./entrypoints/agent.ts";
// Question Lab handlers
import { routeQuestionLab } from "./entrypoints/question-lab.ts";

// -- Route Tables --

const postRoutes: Record<string, Handler> = {
  // Pipeline steps (called by QStash, orgId in body) — wrapped with retry middleware
  "/audit/step/init": withPipelineRetry(stepInit),
  "/audit/step/transcribe": withPipelineRetry(stepTranscribe),
  "/audit/step/transcribe-complete": withPipelineRetry(stepTranscribeCb),
  "/audit/step/prepare": withPipelineRetry(stepPrepare),
  "/audit/step/ask-batch": withPipelineRetry(stepAskBatch),
  "/audit/step/finalize": withPipelineRetry(stepFinalize),
  "/audit/step/cleanup": withPipelineRetry(stepCleanup),

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

// -- Server --

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Health check
  if (url.pathname === "/health") {
    return json({ ok: true, ts: Date.now() });
  }

  // Serve sound files
  if (req.method === "GET" && url.pathname.startsWith("/sounds/")) {
    const soundRes = await handleSoundFile(req);
    if (soundRes) return soundRes;
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

  // POST routes — pipeline retry is handled by the withPipelineRetry middleware
  if (req.method === "POST") {
    const handler = postRoutes[url.pathname];
    if (handler) {
      try {
        return await handler(req);
      } catch (e) {
        console.error(`[${url.pathname}] error:`, e);
        return json({ error: e instanceof Error ? e.message : String(e) }, 500);
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
