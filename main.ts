import * as icons from "./shared/icons.ts";
import { stepInit } from "./steps/init.ts";
import { stepTranscribe } from "./steps/transcribe.ts";
import { stepTranscribeCb } from "./steps/transcribe-cb.ts";
import { stepPollTranscript } from "./steps/poll-transcript.ts";
import { stepDiarizeAsync } from "./steps/diarize-async.ts";
import { stepPineconeAsync } from "./steps/pinecone-async.ts";
import { stepPrepare } from "./steps/prepare.ts";
import { stepAskBatch } from "./steps/ask-batch.ts";
import { stepAskAll } from "./steps/ask-all.ts";
import { stepFinalize } from "./steps/finalize.ts";
import { stepCleanup } from "./steps/cleanup.ts";
import { stepBadWordCheck } from "./steps/bad-word-check.ts";
import {
  handleAuditByRid, handlePackageByRid, handleGetFinding, handleGetReport,
  handleGetStats, handleGetRecording, handleFileAppeal, handleAppealStatus,
  handleAppealDifferentRecording, handleAppealUploadRecording,
} from "./controller.ts";
import { getTokenUsage } from "./providers/groq.ts";
import { getOpenApiSpec, getSwaggerHtml, getDocsIndexHtml } from "./swagger.ts";
import { enqueueStep, publishStep, ALL_QUEUES, pauseAllQueues, resumeAllQueues, purgeAllQueues, getQueueCounts } from "./lib/queue.ts";
import {
  trackActive, trackError, trackRetry, trackCompleted, terminateAllActive, terminateFinding, getStats, getRecentCompleted, getAllCompleted, getPipelineConfig, setPipelineConfig, getStuckFindings, clearErrors,
  getFinding, saveFinding, saveTranscript, saveBatchAnswers,
  getWebhookConfig, saveWebhookConfig, listEmailReportConfigs, getEmailReportConfig, saveEmailReportConfig, deleteEmailReportConfig,
  getEmailReportPreview, saveEmailReportPreview, deleteEmailReportPreview,
  listEmailTemplates, getEmailTemplate, saveEmailTemplate, deleteEmailTemplate,
  getChargebackEntries, getWireDeductionEntries, purgeOldEntries, purgeBypassedWireDeductions, backfillReviewScores,
  getBadWordConfig, saveBadWordConfig,
  getOfficeBypassConfig, saveOfficeBypassConfig,
  getManagerScope, saveManagerScope, listManagerScopes,
  getAuditDimensions, saveAuditDimensions,
  getAllAnswersForFinding,
  findAuditsByRecordId,
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
  registerWebhookEmailHandler,
} from "./lib/kv.ts";
import type { WebhookConfig, WebhookKind, GamificationSettings, SoundPackMeta, SoundSlot, WireDeductionEntry } from "./lib/kv.ts";
import { S3Ref } from "./lib/s3.ts";
import { sendEmail } from "./providers/postmark.ts";
import { appendSheetRows, parseSheetsServiceAccount } from "./providers/sheets.ts";
import { env } from "./env.ts";
import { orgKey } from "./lib/org.ts";
import type { OrgId } from "./lib/org.ts";

// Unified auth
import {
  authenticate, resolveEffectiveAuth, createOrg, createUser, deleteUser, getUser, verifyUser,
  createSession, deleteSession, listUsers, listOrgs, getOrg, deleteOrg,
  parseCookie, sessionCookie, clearSessionCookie,
} from "./auth/kv.ts";
import type { AuthContext } from "./auth/kv.ts";
import { getRegisterPage, getLoginPage } from "./auth/page.ts";

// Super Admin
import { getSuperAdminPage } from "./shared/super-admin-page.ts";

// Review (unified auth)
import {
  handleReviewPage, handleNext, handleDecide, handleBack,
  handleGetSettings, handleSaveSettings, handleStats, handleBackfill,
  handleReviewDashboardPage, handleReviewDashboardData, handleReviewMe, handlePreviewFinding,
} from "./review/handlers.ts";
import { getReviewStats, populateReviewQueue, clearReviewQueue, getReviewedFindingIds, listReviewQueueFindings } from "./review/kv.ts";

// Judge (unified auth)
import {
  handleJudgePage,
  handleNext as handleJudgeNext,
  handleDecide as handleJudgeDecide,
  handleBack as handleJudgeBack,
  handleStats as handleJudgeStats,
  handleDashboardPage as handleJudgeDashboardPage,
  handleDashboardData as handleJudgeDashboardData,
  handleJudgeMe,
  handleJudgeListReviewers, handleJudgeCreateReviewer, handleJudgeDeleteReviewer,
  handleJudgeGetReviewerConfig, handleJudgeSaveReviewerConfig,
  handleJudgeDismissFinding,
} from "./judge/handlers.ts";
import { getAppealStats, populateJudgeQueue, saveAppeal, recordDecision as recordJudgeDecision, clearJudgeQueue, backfillChargebackEntries, pruneBypassedFromQueues, findDuplicates, deleteDuplicates, adminDeleteFinding } from "./judge/kv.ts";

// Manager (unified auth)
import {
  handleManagerPage, handleManagerMe, handleManagerQueueList, handleManagerFinding,
  handleManagerRemediate, handleManagerStatsFetch, handleManagerBackfill,
  handleManagerListAgents, handleManagerCreateAgent, handleManagerDeleteAgent,
  handleManagerGameState, handleManagerAuditsPage, handleManagerAuditsData,
} from "./manager/handlers.ts";

// Agent (unified auth)
import { handleAgentPage, handleAgentDashboardData, handleAgentMe, handleAgentGameState, handleAgentStore, handleAgentStoreBuy } from "./agent/handlers.ts";

// Chat
import { getChatPage } from "./chat/page.ts";

// Dashboard + Question Lab
import { getDashboardPage } from "./dashboard/page.ts";
import { routeQuestionLab } from "./question-lab/handlers.ts";

// Sound
import { getSoundEngineJs } from "./shared/sound-engine.ts";
import { getGamificationPage } from "./shared/gamification-page.ts";
import { getStorePage } from "./shared/store-page.ts";
import { getBadgeEditorPage } from "./shared/badge-editor-page.ts";
import { STORE_CATALOG, PREFAB_EVENTS, rarityFromPrice } from "./shared/badges.ts";
import type { StoreItem } from "./shared/badges.ts";

// Impersonation
import { getImpersonateSnippet } from "./shared/impersonate-bar.ts";

// -- Logo PNG (rasterized on demand via resvg-wasm) --

let _logoPng: Uint8Array | null = null;
async function getLogoPng(): Promise<Uint8Array | null> {
  if (_logoPng) return _logoPng;
  try {
    const { initWasm, Resvg } = await import("npm:@resvg/resvg-wasm");
    // Load WASM from the package — Deno resolves this from the npm cache
    await initWasm(fetch("https://unpkg.com/@resvg/resvg-wasm@2.6.2/index_bg.wasm"));
    const svg = await Deno.readTextFile(new URL("./favicon.svg", import.meta.url));
    const resvg = new Resvg(svg, { fitTo: { mode: "width", value: 64 } });
    _logoPng = resvg.render().asPng();
  } catch (err) {
    console.warn("[LOGO] PNG generation failed:", err);
  }
  return _logoPng;
}

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
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function requireAuth(req: Request): Promise<AuthContext | Response> {
  const auth = await resolveEffectiveAuth(req);
  if (!auth) return json({ error: "unauthorized" }, 401);
  return auth;
}

function requirePageAuth(handler: (req: Request) => Promise<Response>, role?: string): (req: Request) => Promise<Response> {
  return async (req) => {
    const auth = await authenticate(req);
    if (!auth) return Response.redirect(new URL("/login", req.url).href, 302);
    if (role && auth.role !== role) return Response.redirect(new URL("/login", req.url).href, 302);
    return handler(req);
  };
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
  const db = await Deno.openKv(Deno.env.get("KV_URL") ?? undefined);
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
  "/audit/step/poll-transcript": stepPollTranscript,
  "/audit/step/transcribe-complete": stepTranscribeCb,
  "/audit/step/diarize-async": stepDiarizeAsync,
  "/audit/step/pinecone-async": stepPineconeAsync,
  "/audit/step/prepare": stepPrepare,
  "/audit/step/ask-batch": stepAskBatch,
  "/audit/step/ask-all": stepAskAll,
  "/audit/step/finalize": stepFinalize,
  "/audit/step/cleanup": stepCleanup,
  "/audit/step/bad-word-check": stepBadWordCheck,

  // API endpoints (orgId from auth/query/default-org)
  "/audit/test-by-rid": withOrgId(handleAuditByRid),
  "/audit/package-by-rid": withOrgId(handlePackageByRid),

  // Auth
  "/register": handleRegisterPost,
  "/login": handleLoginPost,
  "/logout": handleLogoutPost,

  // Admin (auth required)
  "/admin/wipe-kv": handleWipeKv,
  "/admin/force-nos": handleForceNos,
  "/admin/seed": handleSeed,
  "/admin/init-org": handleInitOrg,
  "/admin/retry-finding": handleRetryFinding,
  "/admin/terminate-finding": handleTerminateFinding,
  "/admin/terminate-all": handleTerminateAll,
  "/admin/clear-queue": handleClearQueue,
  "/admin/clear-errors": handleClearErrors,
  "/admin/pause-queues": handlePauseQueues,
  "/admin/resume-queues": handleResumeQueues,
  "/admin/clear-review-queue": handleClearReviewQueue,
  "/admin/dump-state": handleDumpState,
  "/admin/import-state": handleImportState,
  "/admin/pull-state": handlePullState,
  "/admin/queues": handleSetQueue,
  "/admin/pipeline-config": handleSetPipelineConfig,
  "/admin/settings/terminate": handleAdminSaveSettings,
  "/admin/settings/appeal": handleAdminSaveSettings,
  "/admin/settings/manager": handleAdminSaveSettings,
  "/admin/settings/review": handleAdminSaveSettings,
  "/admin/settings/judge": handleAdminSaveSettings,
  "/admin/settings/judge-finish": handleAdminSaveSettings,
  "/admin/settings/re-audit-receipt": handleAdminSaveSettings,
  "/admin/users": handleAdminAddUser,
  "/admin/users/delete": handleAdminDeleteUser,
  "/admin/parallelism": handleSetParallelism,
  "/admin/email-reports": handleSaveEmailReport,
  "/admin/email-reports/delete": handleDeleteEmailReport,
  "/admin/email-reports/preview": handlePreviewEmailReport,
  "/admin/email-reports/preview-inline": handlePreviewInlineEmailReport,
  "/admin/email-reports/send-now": handleSendNowEmailReport,
  "/admin/email-templates": handleSaveEmailTemplate,
  "/admin/email-templates/delete": handleDeleteEmailTemplate,
  "/admin/bad-word-config": handleSaveBadWordConfig,
  "/admin/office-bypass": handleSaveOfficeBypass,
  "/admin/manager-scopes": handleSaveManagerScope,
  "/admin/audit-dimensions": handleSaveAuditDimensions,
  "/admin/post-to-sheet": handlePostToSheet,
  "/admin/purge-old-audits": handlePurgeOldAudits,
  "/admin/purge-bypassed-wire-deductions": handlePurgeBypassedWireDeductions,
  "/admin/backfill-review-scores": handleBackfillReviewScores,
  "/admin/backfill-chargeback-entries": handleBackfillChargebackEntries,
  "/admin/deduplicate-findings": handleDeduplicateFindings,
  "/webhooks/audit-complete": handleAuditCompleteWebhook,
  "/webhooks/appeal-filed": handleAppealFiledWebhook,
  "/webhooks/appeal-decided": handleAppealDecidedWebhook,
  "/webhooks/manager-review": handleManagerReviewWebhook,
  "/admin/reset-finding": handleResetFinding,
  "/admin/flip-answer": handleAdminFlipAnswer,

  // Appeal (orgId from auth/query/default)
  "/audit/appeal": withOrgId(handleFileAppeal),
  "/audit/appeal/different-recording": withOrgId(handleAppealDifferentRecording),
  "/audit/appeal/upload-recording": withOrgId(handleAppealUploadRecording),
  "/audit/send-reaudit-receipt": withOrgId(handleSendReauditReceipt),

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
  "/judge/api/reviewer-config": handleJudgeSaveReviewerConfig,
  "/judge/api/dismiss-finding": handleJudgeDismissFinding,
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
  "/gamification": requireRolePageAuth(["judge"], handleGamificationPageGet),
  "/store": handleStorePage,
  "/chat": handleChatPage,
  "/chat/api/me": handleChatMe,
  "/chat/api/cosmetics": handleChatCosmetics,
  "/js/sound-engine.js": async () => new Response(getSoundEngineJs(), { headers: { "Content-Type": "application/javascript", "Cache-Control": "public, max-age=3600" } }),
  "/": handleDemoPage,

  // Auth
  "/register": async () => html(getRegisterPage()),
  "/login": async () => html(getLoginPage()),

  // Public-ish (orgId from auth/query/default)
  "/audit/finding": withOrgId(handleGetFinding),
  "/audit/report": withOrgId(handleGetReport),
  "/audit/stats": withOrgId(handleGetStats),
  "/audit/recording": withOrgId(handleGetRecording),
  "/audit/appeal/status": withOrgId(handleAppealStatus),
  "/audit/report-sse": withOrgId(handleReportSSE),

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
  "/admin/settings/re-audit-receipt": handleAdminGetSettings,
  "/admin/parallelism": handleGetParallelism,
  "/admin/users": handleAdminListUsers,
  "/admin/email-reports": handleListEmailReports,
  "/admin/email-reports/preview-view": handlePreviewViewEmailReport,
  "/admin/email-templates": handleListEmailTemplates,
  "/admin/email-templates/get": handleGetEmailTemplate,
  "/admin/bad-word-config": handleGetBadWordConfig,
  "/admin/office-bypass": handleGetOfficeBypass,
  "/admin/manager-scopes": handleGetManagerScopes,
  "/admin/audit-dimensions": handleGetAuditDimensions,
  "/admin/chargebacks": handleGetChargebacks,
  "/admin/wire-deductions": handleGetWireDeductions,
  "/admin/trigger-weekly-sheets": handleTriggerWeeklySheets,
  "/docs/index": () => Promise.resolve(html(getDocsIndexHtml())),
  "/docs/datamodule": () => Promise.resolve(html(getSwaggerHtml())),
  "/api/openapi.json": () => Promise.resolve(json(getOpenApiSpec())),

  // Review (role-guarded)
  "/review": requireRolePageAuth(["reviewer"], handleReviewPage),
  "/review/dashboard": requireRolePageAuth(["reviewer"], handleReviewDashboardPage),
  "/review/api/next": handleNext,
  "/review/api/settings": handleGetSettings,
  "/review/api/stats": handleStats,
  "/review/api/me": handleReviewMe,
  "/review/api/preview": handlePreviewFinding,
  "/review/api/dashboard": handleReviewDashboardData,
  "/review/api/gamification": handleReviewerGetGamification,

  // Judge (role-guarded)
  "/judge": requireRolePageAuth(["judge"], handleJudgePage),
  "/judge/api/next": handleJudgeNext,
  "/judge/api/stats": handleJudgeStats,
  "/judge/api/me": handleJudgeMe,
  "/judge/api/reviewers": handleJudgeListReviewers,
  "/judge/api/reviewer-config": handleJudgeGetReviewerConfig,
  "/judge/dashboard": requireRolePageAuth(["judge"], handleJudgeDashboardPage),
  "/judge/api/dashboard": handleJudgeDashboardData,
  "/judge/api/gamification": handleJudgeGetGamification,

  // Admin gamification
  "/admin/settings/gamification": handleAdminGetGamification,

  // Gamification page API
  "/gamification/api/packs": handleListPacks,
  "/gamification/api/settings": handleGamificationPageGetSettings,

  // Badge editor (admin only)
  "/admin/badge-editor": requireRolePageAuth(["admin"], handleBadgeEditorPage),
  "/admin/badge-editor/items": handleBadgeEditorItems,

  // Dashboard (admin only)
  "/admin/dashboard": requireRolePageAuth(["admin"], handleDashboardPage),
  "/admin/dashboard/data": handleDashboardData,
  "/admin/dashboard/section": handleDashboardSection,
  "/admin/audits": requireRolePageAuth(["admin"], handleAuditsPage),
  "/admin/audits/data": handleAuditsData,
  "/admin/review-queue/data": handleReviewQueueData,
  "/admin/delete-finding": handleDeleteFinding,
  "/admin/audits-by-record": handleAuditsByRecord,
  "/admin/api/me": handleAdminMe,
  "/admin/retry-finding": handleRetryFinding,

  // Agent (role-guarded)
  "/agent": requireRolePageAuth(["user"], handleAgentPage),
  "/agent/api/dashboard": handleAgentDashboardData,
  "/agent/api/me": handleAgentMe,
  "/agent/api/game-state": handleAgentGameState,
  "/agent/api/store": handleAgentStore,

  // Manager (role-guarded)
  "/manager": requireRolePageAuth(["manager"], handleManagerPage),
  "/manager/audits": requireRolePageAuth(["manager"], handleManagerAuditsPage),
  "/manager/api/queue": handleManagerQueueList,
  "/manager/api/finding": handleManagerFinding,
  "/manager/api/stats": handleManagerStatsFetch,
  "/manager/api/me": handleManagerMe,
  "/manager/api/game-state": handleManagerGameState,
  "/manager/api/agents": handleManagerListAgents,
  "/manager/audits/data": handleManagerAuditsData,
  "/manager/api/prefab-subscriptions": handleGetPrefabSubscriptions,
};

// -- Auth Handlers --

async function handleRegisterPost(req: Request): Promise<Response> {
  const body = await req.json();
  const { orgName, email, password } = body;
  if (!orgName || !email || !password) {
    return json({ error: "orgName, email, and password required" }, 400);
  }

  const orgId = await createOrg(orgName, email);
  await createUser(orgId, email, password, "admin");
  const token = await createSession({ email, orgId, role: "admin" });

  return new Response(JSON.stringify({ ok: true, orgId }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": sessionCookie(token),
    },
  });
}

async function handleLoginPost(req: Request): Promise<Response> {
  const body = await req.json();
  const { email, password } = body;
  if (!email || !password) return json({ error: "email and password required" }, 400);

  const auth = await verifyUser(email, password);
  if (!auth) return json({ error: "invalid credentials" }, 401);

  const token = await createSession(auth);

  // Determine redirect based on role
  const redirectMap: Record<string, string> = {
    admin: "/admin/dashboard",
    judge: "/judge/dashboard",
    manager: "/manager",
    reviewer: "/review/dashboard",
    user: "/agent",
  };
  const redirect = auth.email === "ai@monsterrg.com" ? "/super-admin" : (redirectMap[auth.role] ?? "/");

  return new Response(JSON.stringify({ ok: true, role: auth.role, redirect }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": sessionCookie(token),
    },
  });
}

async function handleLogoutPost(req: Request): Promise<Response> {
  const token = parseCookie(req, "session");
  if (token) await deleteSession(token);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": clearSessionCookie(),
    },
  });
}

// -- Demo Page --

async function handleDemoPage(_req: Request): Promise<Response> {
  const db = await Deno.openKv(Deno.env.get("KV_URL") ?? undefined);
  const defaultOrg = await db.get<string>(["default-org"]);
  const orgId = defaultOrg.value;

  let reportId = "";
  if (orgId) {
    const iter = db.list({ prefix: orgKey(orgId, "audit-finding") });
    for await (const entry of iter) {
      if (entry.key.length >= 3 && typeof entry.key[2] === "string") {
        reportId = entry.key[2] as string;
        break;
      }
    }
  }
  const reportHref = reportId
    ? `/audit/report?id=${reportId}${orgId ? `&org=${orgId}` : ""}`
    : `/audit/report?id=demo`;

  return html(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Auto-Bot</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#0a0e14;color:#c9d1d9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center}
  .wrap{width:100%;max-width:520px;padding:0 24px}
  h1{font-size:28px;font-weight:700;color:#e6edf3;margin-bottom:6px;letter-spacing:-0.5px}
  .sub{font-size:14px;color:#484f58;margin-bottom:36px}
  .grid{display:flex;flex-direction:column;gap:8px}
  a{text-decoration:none;display:flex;align-items:center;gap:14px;padding:16px 20px;background:#12161e;border:1px solid #1e2736;border-radius:12px;transition:border-color .15s,transform .1s}
  a:hover{border-color:#2d333b;transform:translateX(4px)}
  .icon{width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0}
  .i-auth{background:rgba(63,185,80,0.12);color:#3fb950}
  .i-admin{background:rgba(31,111,235,0.12);color:#58a6ff}
  .i-review{background:rgba(139,92,246,0.12);color:#bc8cff}
  .i-judge{background:rgba(210,153,34,0.12);color:#d29922}
  .i-manager{background:rgba(121,192,255,0.12);color:#79c0ff}
  .i-agent{background:rgba(249,115,22,0.12);color:#f97316}
  .i-qlab{background:rgba(63,185,80,0.12);color:#3fb950}
  .i-report{background:rgba(139,148,158,0.12);color:#8b949e}
  .label{font-size:15px;font-weight:600;color:#e6edf3}
  .desc{font-size:12px;color:#484f58;margin-top:2px}
  .arrow{margin-left:auto;color:#2d333b;font-size:18px;transition:color .15s}
  a:hover .arrow{color:#484f58}
</style>
</head>
<body>
<div class="wrap">
  <h1>Auto-Bot</h1>
  <p class="sub">AI-powered call recording audit pipeline</p>
  <div class="grid">
    <a href="/login">
      <div class="icon i-auth">${icons.logIn}</div>
      <div><div class="label">Login</div><div class="desc">Sign in to your account</div></div>
      <span class="arrow">&rsaquo;</span>
    </a>
    <a href="/register">
      <div class="icon i-auth">${icons.userPlus}</div>
      <div><div class="label">Register</div><div class="desc">Create a new organization</div></div>
      <span class="arrow">&rsaquo;</span>
    </a>
    <a href="/admin/dashboard">
      <div class="icon i-admin">${icons.layoutDashboard}</div>
      <div><div class="label">Admin Dashboard</div><div class="desc">Pipeline stats, config, user management</div></div>
      <span class="arrow">&rsaquo;</span>
    </a>
    <a href="/review">
      <div class="icon i-review">${icons.playCircle}</div>
      <div><div class="label">Review Queue</div><div class="desc">Human-in-the-loop audit verification</div></div>
      <span class="arrow">&rsaquo;</span>
    </a>
    <a href="/judge">
      <div class="icon i-judge">${icons.scale}</div>
      <div><div class="label">Judge Panel</div><div class="desc">Appeal decisions and dispute resolution</div></div>
      <span class="arrow">&rsaquo;</span>
    </a>
    <a href="/manager">
      <div class="icon i-manager">${icons.clipboardList}</div>
      <div><div class="label">Manager Portal</div><div class="desc">Failure remediation and tracking</div></div>
      <span class="arrow">&rsaquo;</span>
    </a>
    <a href="/agent">
      <div class="icon i-agent">${icons.barChart}</div>
      <div><div class="label">Agent Dashboard</div><div class="desc">Your audit results and performance trends</div></div>
      <span class="arrow">&rsaquo;</span>
    </a>
    <a href="/question-lab">
      <div class="icon i-qlab">${icons.flask}</div>
      <div><div class="label">Question Lab</div><div class="desc">Build and test audit question configs</div></div>
      <span class="arrow">&rsaquo;</span>
    </a>
    <a href="${reportHref}">
      <div class="icon i-report">${icons.fileText}</div>
      <div><div class="label">Audit Report</div><div class="desc">View a finding report by ID</div></div>
      <span class="arrow">&rsaquo;</span>
    </a>
    <a href="/gamification">
      <div class="icon" style="background:rgba(236,72,153,0.12);color:#ec4899">${icons.music}</div>
      <div><div class="label">Gamification</div><div class="desc">Sound packs, streaks, and combo settings</div></div>
      <span class="arrow">&rsaquo;</span>
    </a>
  </div>
</div>
</body>
</html>`);
}

// -- Admin: Dashboard --

async function handleDashboardPage(_req: Request): Promise<Response> {
  return html(getDashboardPage());
}

async function handleDashboardData(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  const [pipelineStats, tokens, review, appeals, recentCompleted, queueCounts, reviewedIds] = await Promise.all([
    getStats(auth.orgId),
    getTokenUsage(1),
    getReviewStats(auth.orgId),
    getAppealStats(auth.orgId),
    getRecentCompleted(auth.orgId, 25),
    getQueueCounts(),
    getReviewedFindingIds(auth.orgId),
  ]);
  const recentCompletedAnnotated = recentCompleted.map((c) => ({ ...c, reviewed: reviewedIds.has(c.findingId) }));

  const queued = Object.values(queueCounts).reduce((a, b) => a + b, 0);

  return json({
    pipeline: {
      inPipe: pipelineStats.active.length + queued,
      activeCount: pipelineStats.active.length,
      queued,
      queueBreakdown: queueCounts,
      active: pipelineStats.active,
      completed24h: pipelineStats.completedCount,
      completedTs: pipelineStats.completed.map((c: any) => c.ts),
      errors24h: pipelineStats.errors.length,
      errors: pipelineStats.errors,
      errorsTs: pipelineStats.errors.map((e: any) => e.ts),
      retries24h: pipelineStats.retries.length,
      retriesTs: pipelineStats.retries.map((r: any) => r.ts),
    },
    review,
    tokens,
    appeals,
    recentCompleted: recentCompletedAnnotated,
  });
}

async function handleAuditsData(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  const url = new URL(req.url);
  const type = url.searchParams.get("type") || "all";
  const owner = url.searchParams.get("owner") || "";
  const department = url.searchParams.get("department") || "";
  const shift = url.searchParams.get("shift") || "";
  const reviewed = url.searchParams.get("reviewed") || ""; // "yes" | "no" | "auto" | ""
  const scoreMin = parseInt(url.searchParams.get("scoreMin") || "0", 10);
  const scoreMax = parseInt(url.searchParams.get("scoreMax") || "100", 10);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(10, parseInt(url.searchParams.get("limit") || "50", 10)));
  // since/until: unix ms timestamps. Default: today at midnight.
  const sinceParam = url.searchParams.get("since");
  const untilParam = url.searchParams.get("until");
  const since = sinceParam ? parseInt(sinceParam, 10) : (() => { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); })();
  const until = untilParam ? parseInt(untilParam, 10) : undefined;

  // getAllCompleted does an efficient reverse KV scan with early-break at `since`
  const [windowEntries, reviewedIds] = await Promise.all([
    getAllCompleted(auth.orgId, since),
    getReviewedFindingIds(auth.orgId),
  ]);

  const filtered = windowEntries.filter((c) => {
    if (until && c.ts > until) return false;
    if (type === "date-leg" && c.isPackage) return false;
    if (type === "package" && !c.isPackage) return false;
    if (owner && (c.voName || c.owner) !== owner) return false;
    if (department && c.department !== department) return false;
    if (shift && c.shift !== shift) return false;
    if (reviewed === "yes" && !reviewedIds.has(c.findingId)) return false;
    if (reviewed === "no" && (reviewedIds.has(c.findingId) || c.reason === "perfect_score" || c.reason === "invalid_genie")) return false;
    if (reviewed === "auto" && c.reason !== "perfect_score" && c.reason !== "invalid_genie") return false;
    if (reviewed === "invalid_genie" && c.reason !== "invalid_genie") return false;
    if (c.score != null && (c.score < scoreMin || c.score > scoreMax)) return false;
    return true;
  });

  // Cross-filtered dropdown options: each list filtered by the other active filters (not its own)
  const matchesBase = (c: typeof windowEntries[0]) => {
    if (until && c.ts > until) return false;
    if (type === "date-leg" && c.isPackage) return false;
    if (type === "package" && !c.isPackage) return false;
    if (c.score != null && (c.score < scoreMin || c.score > scoreMax)) return false;
    return true;
  };
  const owners = [...new Set(
    windowEntries.filter((c) => matchesBase(c) && (!department || c.department === department) && (!shift || c.shift === shift))
      .map((c) => c.voName || c.owner).filter(Boolean)
  )].sort() as string[];
  const departments = [...new Set(
    windowEntries.filter((c) => matchesBase(c) && (!owner || (c.voName || c.owner) === owner) && (!shift || c.shift === shift))
      .map((c) => c.department).filter(Boolean)
  )].sort() as string[];
  const shifts = [...new Set(
    windowEntries.filter((c) => matchesBase(c) && (!owner || (c.voName || c.owner) === owner) && (!department || c.department === department))
      .map((c) => c.shift).filter(Boolean)
  )].sort() as string[];
  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  const pageItems = filtered.slice((page - 1) * limit, page * limit);

  const items = pageItems.map((c) => ({ ...c, reviewed: reviewedIds.has(c.findingId) }));

  console.log(`[AUDITS] 🔍 ${auth.email}: ${total}/${windowEntries.length} in window, page=${page}/${pages}, type=${type}, owner=${owner || "all"}, dept=${department || "all"}, shift=${shift || "all"}`);
  return json({ items, total, pages, page, owners, departments, shifts });
}

async function handleAuditsByRecord(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;
  const recordId = new URL(req.url).searchParams.get("recordId")?.trim();
  if (!recordId) return json({ error: "recordId required" }, 400);
  const entries = await findAuditsByRecordId(auth.orgId, recordId);
  return json({ items: entries, total: entries.length });
}

async function handleDeleteFinding(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  const { findingId } = await req.json();
  if (!findingId || typeof findingId !== "string") return json({ error: "findingId required" }, 400);
  console.log(`[ADMIN] 🗑️ ${auth.email} deleting finding ${findingId}`);
  await adminDeleteFinding(auth.orgId, findingId);
  console.log(`[ADMIN] ✅ finding ${findingId} deleted by ${auth.email}`);
  return json({ ok: true });
}

async function handleReviewQueueData(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;
  const url = new URL(req.url);
  const typeParam = url.searchParams.get("type") ?? "";
  const type = typeParam === "date-leg" ? "date-leg" : typeParam === "package" ? "package" : undefined;
  const { items, total } = await listReviewQueueFindings(auth.orgId, type, 200);
  return json({ items, total });
}

async function handleAuditsPage(req: Request): Promise<Response> {
  const html = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Audit History</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0b0f15;--bg-raised:#111620;--bg-surface:#161c28;--border:#1c2333;--text:#c9d1d9;--text-muted:#6e7681;--text-dim:#484f58;--text-bright:#e6edf3;--blue:#58a6ff;--green:#3fb950;--red:#f85149;--yellow:#d29922;--cyan:#39d0d8;--mono:'SF Mono','Fira Code',monospace}
body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;display:flex;flex-direction:column}
.topbar{display:flex;align-items:center;gap:16px;padding:0 24px;height:52px;background:var(--bg-raised);border-bottom:1px solid var(--border);flex-shrink:0}
.topbar h1{font-size:14px;font-weight:700;color:var(--text-bright)}
.topbar .back{font-size:11px;color:var(--text-muted);text-decoration:none;padding:4px 10px;border:1px solid var(--border);border-radius:6px;transition:all 0.15s}
.topbar .back:hover{background:var(--bg-surface);color:var(--text)}
.topbar .sub{font-size:11px;color:var(--text-dim);margin-left:auto}
.filters{display:flex;align-items:center;gap:10px;padding:14px 24px;background:var(--bg-raised);border-bottom:1px solid var(--border);flex-wrap:wrap}
.filters label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--text-muted);display:flex;flex-direction:column;gap:3px}
.filters select,.filters input[type=number]{background:var(--bg);border:1px solid var(--border);border-radius:5px;color:var(--text);font-size:11px;padding:5px 8px;font-family:var(--mono)}
.window-btns{display:flex;gap:4px}.window-btn{padding:4px 10px;border-radius:5px;font-size:10px;font-weight:600;cursor:pointer;border:1px solid var(--border);background:var(--bg);color:var(--text-muted);transition:all 0.15s}.window-btn:hover{background:var(--bg-surface);color:var(--text)}.window-btn.active{background:rgba(88,166,255,0.15);border-color:rgba(88,166,255,0.5);color:var(--blue)}
.filters select:focus,.filters input:focus{outline:none;border-color:var(--blue)}
.btn{padding:5px 14px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;border:none;transition:all 0.15s}
.btn-primary{background:#1f6feb;color:#fff}.btn-primary:hover{background:#388bfd}
.btn-ghost{background:transparent;color:var(--text-muted);border:1px solid var(--border)}.btn-ghost:hover{background:var(--bg-surface);color:var(--text)}
.content{flex:1;overflow:auto;padding:20px 24px}
.stats-row{display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap}
.stat-card{background:var(--bg-raised);border:1px solid var(--border);border-radius:8px;padding:10px 16px;min-width:120px}
.stat-card .val{font-size:20px;font-weight:700;color:var(--text-bright);line-height:1}
.stat-card .lbl{font-size:10px;color:var(--text-muted);margin-top:3px}
table{width:100%;border-collapse:collapse;font-size:12px}
thead th{text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);padding:6px 12px;border-bottom:1px solid var(--border);white-space:nowrap}
tbody tr{border-bottom:1px solid rgba(28,35,51,0.6);transition:background 0.1s}
tbody tr:hover{background:var(--bg-raised)}
tbody td{padding:8px 12px;color:var(--text);vertical-align:middle}
.mono{font-family:var(--mono);font-size:11px}
.tbl-link{color:var(--blue);text-decoration:none;font-family:var(--mono);font-size:11px}.tbl-link:hover{text-decoration:underline}
.score-green{color:var(--green);font-weight:700}
.score-yellow{color:var(--yellow);font-weight:700}
.score-red{color:var(--red);font-weight:700}
.badge{display:inline-flex;align-items:center;padding:1px 7px;border-radius:10px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px}
.badge-pkg{background:rgba(251,191,36,0.12);color:#fbbf24;border:1px solid rgba(251,191,36,0.3)}
.badge-dl{background:rgba(88,166,255,0.12);color:var(--blue);border:1px solid rgba(88,166,255,0.25)}
.pagination{display:flex;align-items:center;gap:8px;padding:16px 0;justify-content:center}
.pagination button{padding:4px 12px;border-radius:5px;font-size:11px;cursor:pointer;border:1px solid var(--border);background:var(--bg-raised);color:var(--text);transition:all 0.15s}
.pagination button:hover:not(:disabled){background:var(--bg-surface)}
.pagination button:disabled{opacity:0.4;cursor:default}
.pagination .page-info{font-size:11px;color:var(--text-muted);padding:0 8px}
.empty{text-align:center;color:var(--text-dim);font-size:12px;padding:40px 0}
.loading{text-align:center;color:var(--text-muted);font-size:12px;padding:40px 0}
.tbl-wrap{background:var(--bg-raised);border:1px solid var(--border);border-radius:10px;overflow:hidden}
</style>
</head><body>
<div class="topbar">
  <a class="back" href="/admin/dashboard">← Dashboard</a>
  <h1>Audit History <span id="hdr-window" style="font-weight:400;color:var(--text-muted);">(24h)</span></h1>
  <span class="sub" id="hdr-count">Loading...</span>
</div>
<div class="filters">
  <label>Date Range
    <div class="window-btns">
      <button class="window-btn" data-hours="1">1h</button>
      <button class="window-btn" data-hours="4">4h</button>
      <button class="window-btn" data-hours="12">12h</button>
      <button class="window-btn active-default" data-hours="24">24h</button>
      <button class="window-btn" data-hours="72">3d</button>
      <button class="window-btn" data-hours="168">7d</button>
      <span style="color:var(--text-dim);font-size:10px;margin:0 4px;align-self:center;">or</span>
      <input type="date" id="f-date-start" style="background:var(--bg-raised);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:11px;padding:3px 8px;height:26px;">
      <span style="color:var(--text-dim);align-self:center;">–</span>
      <input type="date" id="f-date-end" style="background:var(--bg-raised);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:11px;padding:3px 8px;height:26px;">
      <button class="btn btn-primary" id="f-date-go" style="padding:3px 10px;font-size:11px;height:26px;">Go</button>
      <button class="btn btn-ghost" id="f-date-clear" style="padding:3px 8px;font-size:11px;height:26px;display:none;">✕ Clear</button>
    </div>
  </label>
  <label>Type
    <select id="f-type"><option value="all">All Types</option><option value="date-leg">Internal</option><option value="package">Partner</option></select>
  </label>
  <label>Team Member
    <select id="f-owner"><option value="">All Members</option></select>
  </label>
  <label>Department
    <select id="f-dept"><option value="">All Departments</option></select>
  </label>
  <label>Shift
    <select id="f-shift"><option value="">All Shifts</option></select>
  </label>
  <label>Reviewed
    <select id="f-reviewed"><option value="">All</option><option value="yes">Reviewed</option><option value="no">Not Reviewed</option><option value="auto">Auto</option><option value="invalid_genie">Invalid Genie</option></select>
  </label>
  <label>Min Score %
    <input type="number" id="f-score-min" value="0" min="0" max="100" style="width:70px">
  </label>
  <label>Max Score %
    <input type="number" id="f-score-max" value="100" min="0" max="100" style="width:70px">
  </label>
  <label style="align-self:flex-end">
    <button class="btn btn-primary" id="apply-btn">Apply Filters</button>
  </label>
  <label style="align-self:flex-end">
    <button class="btn btn-ghost" id="reset-btn">Reset</button>
  </label>
</div>
<div class="content">
  <div class="stats-row" id="stats-row"></div>
  <div class="tbl-wrap">
    <div id="tbl-body" class="loading">Loading...</div>
  </div>
  <div class="pagination" id="pagination" style="display:none"></div>
</div>
<script>
var WINDOW_HOURS = 24;
var state = { page: 1, type: 'all', owner: '', department: '', shift: '', reviewed: '', scoreMin: 0, scoreMax: 100, limit: 50, customStart: null, customEnd: null };
var logsBase = null;
var hm = window.location.hostname.match(/^([^.]+)\\.([^.]+)\\.deno\\.net$/);
if (hm) logsBase = 'https://console.deno.com/' + hm[2] + '/' + hm[1] + '/observability/logs?query=';
var qbDateUrl = 'https://monsterrg.quickbase.com/nav/app/bmhvhc7sk/table/bpb28qsnn/action/dr?rid=';
var qbPkgUrl  = 'https://monsterrg.quickbase.com/nav/app/bmhvhc7sk/table/bttffb64u/action/dr?rid=';

function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function timeAgo(ts){var d=(Date.now()-ts)/1000;if(d<60)return Math.round(d)+'s ago';if(d<3600)return Math.round(d/60)+'m ago';if(d<86400)return Math.round(d/3600)+'h ago';return Math.round(d/86400)+'d ago'}
function fmtDur(ms){var s=Math.round(ms/1000);if(s<60)return s+'s';var m=Math.floor(s/60),r=s%60;return m+'m'+(r?' '+r+'s':'')}
function fmtTime(ts){return new Date(ts).toLocaleString()}

function scoreHtml(s){
  if(s==null)return '--';
  var cls=s===100?'score-green':s>=80?'score-yellow':'score-red';
  return '<span class="'+cls+'">'+s+'%</span>';
}

function windowLabel(){return WINDOW_HOURS>=168?'7d':WINDOW_HOURS>=72?'3d':WINDOW_HOURS>=24?'24h':WINDOW_HOURS+'h'}

function setWindow(h){
  WINDOW_HOURS=h;
  state.customStart=null;state.customEnd=null;
  document.getElementById('f-date-start').value='';
  document.getElementById('f-date-end').value='';
  document.getElementById('f-date-clear').style.display='none';
  document.querySelectorAll('.window-btn').forEach(function(b){b.classList.toggle('active',+b.getAttribute('data-hours')===h)});
  document.getElementById('hdr-window').textContent='('+windowLabel()+')';
  // Reset dropdowns so they repopulate for new window
  var ow=document.getElementById('f-owner');while(ow.options.length>1)ow.remove(1);
  var dw=document.getElementById('f-dept');while(dw.options.length>1)dw.remove(1);
  var sw=document.getElementById('f-shift');while(sw.options.length>1)sw.remove(1);
  state.owner='';state.department='';state.shift='';state.page=1;
  ow.value='';dw.value='';sw.value='';
}

function load(){
  var since=state.customStart!==null?state.customStart:Date.now()-WINDOW_HOURS*3600000;
  var p={type:state.type,owner:state.owner,department:state.department,shift:state.shift,reviewed:state.reviewed,scoreMin:state.scoreMin,scoreMax:state.scoreMax,page:state.page,limit:state.limit,since:since};
  if(state.customEnd!==null)p.until=state.customEnd;
  var params=new URLSearchParams(p);
  document.getElementById('tbl-body').innerHTML='<div class="loading">Loading...</div>';
  fetch('/admin/audits/data?'+params)
    .then(function(r){return r.json()})
    .then(function(d){
      // Repopulate dropdowns with cross-filtered options; clear selection if no longer valid
      var ow=document.getElementById('f-owner');
      while(ow.options.length>1)ow.remove(1);
      d.owners.forEach(function(o){var opt=document.createElement('option');opt.value=o;opt.textContent=o;ow.appendChild(opt)});
      if(state.owner&&d.owners.indexOf(state.owner)===-1){state.owner='';} ow.value=state.owner;
      var dw=document.getElementById('f-dept');
      while(dw.options.length>1)dw.remove(1);
      d.departments.forEach(function(dep){var opt=document.createElement('option');opt.value=dep;opt.textContent=dep;dw.appendChild(opt)});
      if(state.department&&d.departments.indexOf(state.department)===-1){state.department='';}dw.value=state.department;
      var sw=document.getElementById('f-shift');
      while(sw.options.length>1)sw.remove(1);
      (d.shifts||[]).forEach(function(s){var opt=document.createElement('option');opt.value=s;opt.textContent=s;sw.appendChild(opt)});
      if(state.shift&&(d.shifts||[]).indexOf(state.shift)===-1){state.shift='';}sw.value=state.shift;
      renderStats(d);
      renderTable(d);
      renderPagination(d);
      document.getElementById('hdr-count').textContent=d.total+' audits in window';
    })
    .catch(function(e){document.getElementById('tbl-body').innerHTML='<div class="empty">Failed to load: '+e.message+'</div>'});
}

function renderStats(d){
  var items=d.items;
  var avgScore=items.length?Math.round(items.reduce(function(a,c){return a+(c.score??0)},0)/items.length):0;
  var passes=items.filter(function(c){return(c.score??0)>=80}).length;
  var pkgs=items.filter(function(c){return c.isPackage}).length;
  var dls=items.filter(function(c){return!c.isPackage}).length;
  var lbl=document.getElementById('hdr-window').textContent.replace(/[()]/g,'').trim();
  document.getElementById('stats-row').innerHTML=
    stat(d.total,'Total ('+lbl+')')+stat(passes,'≥80% Pass')+stat(items.length-passes,'<80% Fail')+
    stat(pkgs,'Partner')+stat(dls,'Internal')+stat(avgScore+'%','Avg Score (page)');
}
function stat(v,l){return '<div class="stat-card"><div class="val">'+v+'</div><div class="lbl">'+l+'</div></div>'}

function renderTable(d){
  if(!d.items.length){document.getElementById('tbl-body').innerHTML='<div class="empty">No audits match the current filters</div>';return}
  var rows=d.items.map(function(c){
    var fid=c.findingId||'--';
    var logsHtml=logsBase?'<a href="'+logsBase+encodeURIComponent(fid)+'&start=now%2Fy&end=now" target="_blank" class="tbl-link">logs</a>':'--';
    var ridHtml='--';
    if(c.recordId){var u=(c.isPackage?qbPkgUrl:qbDateUrl)+encodeURIComponent(c.recordId);ridHtml='<a href="'+u+'" target="_blank" class="tbl-link">'+esc(c.recordId)+'</a>';}
    var typeBadge=c.isPackage?'<span class="badge badge-pkg">Partner</span>':'<span class="badge badge-dl">Internal</span>';
    var ownerLabel=c.voName||(c.owner&&c.owner!=='api'?c.owner.split('@')[0]:'');
    var owner=ownerLabel?'<span class="mono" style="font-size:10px">'+esc(ownerLabel)+'</span>':'<span style="color:var(--text-dim);font-size:10px">api</span>';
    var started=c.startedAt?'<span title="'+fmtTime(c.startedAt)+'">'+timeAgo(c.startedAt)+'</span>':'--';
    var finished='<span title="'+fmtTime(c.ts)+'">'+timeAgo(c.ts)+'</span>';
    var dur=c.durationMs?'<span style="font-variant-numeric:tabular-nums">'+fmtDur(c.durationMs)+'</span>':'--';
    var reviewedBadge='';
    if(c.reason==='perfect_score'){reviewedBadge='<span class="badge" style="background:rgba(63,185,80,0.10);color:#3fb950;border:1px solid rgba(63,185,80,0.25);" title="100% — no review needed">✓ Auto</span>';}
    else if(c.reason==='invalid_genie'){reviewedBadge='<span class="badge" style="background:rgba(110,118,129,0.12);color:#8b949e;border:1px solid rgba(110,118,129,0.3);" title="No recording — no review needed">✓ Auto</span>';}
    else if(c.reviewed){reviewedBadge='<span class="badge" style="background:rgba(63,185,80,0.12);color:#3fb950;border:1px solid rgba(63,185,80,0.3);">✓ Reviewed</span>';}
    return '<tr><td><a href="/audit/report?id='+encodeURIComponent(fid)+'" target="_blank" class="tbl-link">'+esc(fid)+'</a></td><td>'+logsHtml+'</td><td>'+ridHtml+'</td><td>'+typeBadge+'</td><td>'+owner+'</td><td>'+scoreHtml(c.score)+'</td><td>'+started+'</td><td>'+finished+'</td><td>'+dur+'</td><td>'+reviewedBadge+'</td></tr>';
  }).join('');
  document.getElementById('tbl-body').innerHTML='<table><thead><tr><th>Finding ID</th><th>Logs</th><th>QB Record</th><th>Type</th><th>Team Member</th><th>Score</th><th>Started</th><th>Finished</th><th>Duration</th><th>Reviewed</th></tr></thead><tbody>'+rows+'</tbody></table>';
}

function renderPagination(d){
  var el=document.getElementById('pagination');
  if(d.pages<=1){el.style.display='none';return}
  el.style.display='flex';
  el.innerHTML='<button id="pg-prev" '+(d.page<=1?'disabled':'')+'>← Prev</button>'+
    '<span class="page-info">Page '+d.page+' of '+d.pages+'</span>'+
    '<button id="pg-next" '+(d.page>=d.pages?'disabled':'')+'>Next →</button>';
  document.getElementById('pg-prev').onclick=function(){if(state.page>1){state.page--;load();}};
  document.getElementById('pg-next').onclick=function(){if(state.page<d.pages){state.page++;load();}};
}

document.getElementById('apply-btn').onclick=function(){
  state.type=document.getElementById('f-type').value;
  state.owner=document.getElementById('f-owner').value;
  state.department=document.getElementById('f-dept').value;
  state.shift=document.getElementById('f-shift').value;
  state.reviewed=document.getElementById('f-reviewed').value;
  state.scoreMin=parseInt(document.getElementById('f-score-min').value,10)||0;
  state.scoreMax=parseInt(document.getElementById('f-score-max').value,10)||100;
  state.page=1;load();
};
document.getElementById('reset-btn').onclick=function(){
  state={page:1,type:'all',owner:'',department:'',shift:'',reviewed:'',scoreMin:0,scoreMax:100,limit:50};
  document.getElementById('f-reviewed').value='';
  document.getElementById('f-type').value='all';
  document.getElementById('f-score-min').value=0;
  document.getElementById('f-score-max').value=100;
  setWindow(24);
  load();
};
document.getElementById('f-type').onchange=function(){state.type=this.value;state.page=1;load()};
document.getElementById('f-owner').onchange=function(){state.owner=this.value;state.page=1;load()};
document.getElementById('f-dept').onchange=function(){state.department=this.value;state.page=1;load()};
document.getElementById('f-shift').onchange=function(){state.shift=this.value;state.page=1;load()};
document.getElementById('f-reviewed').onchange=function(){state.reviewed=this.value;state.page=1;load()};
document.querySelectorAll('.window-btn').forEach(function(btn){
  btn.addEventListener('click',function(){setWindow(+this.getAttribute('data-hours'));load();});
});
document.getElementById('f-date-go').addEventListener('click',function(){
  var s=document.getElementById('f-date-start').value;
  var e=document.getElementById('f-date-end').value;
  if(!s||!e){alert('Select both start and end dates');return;}
  if(s>e){alert('Start date must be before end date');return;}
  state.customStart=new Date(s+'T00:00:00').getTime();
  state.customEnd=new Date(e+'T23:59:59').getTime();
  state.page=1;
  document.querySelectorAll('.window-btn').forEach(function(b){b.classList.remove('active')});
  document.getElementById('hdr-window').textContent='('+s+' – '+e+')';
  document.getElementById('f-date-clear').style.display='';
  var ow=document.getElementById('f-owner');while(ow.options.length>1)ow.remove(1);
  var dw=document.getElementById('f-dept');while(dw.options.length>1)dw.remove(1);
  var sw2=document.getElementById('f-shift');while(sw2.options.length>1)sw2.remove(1);
  state.owner='';state.department='';state.shift='';ow.value='';dw.value='';sw2.value='';
  load();
});
document.getElementById('f-date-clear').addEventListener('click',function(){setWindow(24);load();});
// Set default 24h active, then apply any URL params (e.g. from drill-down "View all" link)
setWindow(24);
(function(){
  var p=new URLSearchParams(window.location.search);
  var h=parseInt(p.get('hours')||'',10);if(h>0)setWindow(h);
  var t=p.get('type');if(t&&t!=='all'){state.type=t;document.getElementById('f-type').value=t;}
  var rv=p.get('reviewed');if(rv){state.reviewed=rv;document.getElementById('f-reviewed').value=rv;}
  var ow=p.get('owner');if(ow){state.owner=ow;}
})();

load();
</script>
</body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

const DASHBOARD_SECTIONS: Record<string, (orgId: string) => Promise<unknown>> = {
  pipeline: async (orgId) => {
    const [s, queueCounts] = await Promise.all([getStats(orgId), getQueueCounts()]);
    const queued = Object.values(queueCounts).reduce((a, b) => a + b, 0);
    return {
      inPipe: queued,
      activeCount: s.active.length,
      queued,
      active: s.active,
      completed24h: s.completedCount,
      completedTs: s.completed.map((c: any) => c.ts),
      errors24h: s.errors.length,
      errors: s.errors,
      errorsTs: s.errors.map((e: any) => e.ts),
      retries24h: s.retries.length,
      retriesTs: s.retries.map((r: any) => r.ts),
    };
  },
  review: (orgId) => getReviewStats(orgId),
  tokens: (_orgId) => getTokenUsage(1),
  recent: (orgId) => getRecentCompleted(orgId, 25),
};

async function handleDashboardSection(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;
  const section = new URL(req.url).searchParams.get("section") ?? "";
  const fn = DASHBOARD_SECTIONS[section];
  if (!fn) return json({ error: "unknown section" }, 400);
  return json(await fn(auth.orgId));
}

async function handleAdminMe(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;
  return json({ username: auth.email, role: auth.role, orgId: auth.orgId });
}

// -- Badge Editor --

async function handleBadgeEditorPage(_req: Request): Promise<Response> {
  return html(getBadgeEditorPage());
}

async function handleBadgeEditorItems(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;
  const custom = await listCustomStoreItems(auth.orgId);
  return json({ builtIn: STORE_CATALOG, custom });
}

async function handleBadgeEditorSave(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  const body = await req.json();
  const { id, name, type, price, icon, description, preview } = body;
  if (!id || !name || !type || price == null || !icon) {
    return json({ error: "id, name, type, price, and icon are required" }, 400);
  }

  // Block overwriting built-in IDs
  if (STORE_CATALOG.some((i) => i.id === id)) {
    return json({ error: "cannot overwrite a built-in item" }, 400);
  }

  const item: StoreItem = {
    id,
    name,
    type,
    price: Number(price),
    icon,
    description: description || "",
    rarity: rarityFromPrice(Number(price)),
    preview: preview || undefined,
  };

  await saveCustomStoreItem(auth.orgId, item);
  return json({ ok: true, item });
}

async function handleBadgeEditorDelete(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  const body = await req.json();
  const { id } = body;
  if (!id) return json({ error: "id required" }, 400);

  // Block deleting built-in IDs
  if (STORE_CATALOG.some((i) => i.id === id)) {
    return json({ error: "cannot delete a built-in item" }, 400);
  }

  await deleteCustomStoreItem(auth.orgId, id);
  return json({ ok: true });
}

// -- Admin: Settings --

function extractSettingsKind(req: Request): WebhookKind | null {
  const url = new URL(req.url);
  const parts = url.pathname.split("/");
  const kind = parts[3];
  const kindMap: Record<string, WebhookKind> = {
    terminate: "terminate", review: "terminate",
    appeal: "appeal", judge: "appeal",
    manager: "manager",
    "judge-finish": "judge",
    "re-audit-receipt": "re-audit-receipt",
  };
  return kindMap[kind] ?? null;
}

async function handleAdminGetSettings(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  const kind = extractSettingsKind(req);
  if (!kind) return json({ error: "kind must be terminate, appeal, or manager" }, 400);
  const config = await getWebhookConfig(auth.orgId, kind);
  return json(config ?? { postUrl: "", postHeaders: {} });
}

async function handleAdminSaveSettings(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  const kind = extractSettingsKind(req);
  if (!kind) return json({ error: "kind must be terminate, appeal, or manager" }, 400);
  const body = await req.json();
  const config: WebhookConfig = {
    postUrl: body.postUrl ?? "",
    postHeaders: body.postHeaders ?? {},
    ...(body.testEmail ? { testEmail: String(body.testEmail) } : {}),
    ...(body.emailTemplateId ? { emailTemplateId: String(body.emailTemplateId) } : {}),
    ...(body.bcc ? { bcc: String(body.bcc) } : {}),
  };
  await saveWebhookConfig(auth.orgId, kind, config);
  return json({ ok: true });
}

// -- Admin: Users --

async function handleAdminListUsers(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  const users = await listUsers(auth.orgId);
  return json(users);
}

async function handleAdminAddUser(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  const body = await req.json();
  const { email: emailField, username, password, role, supervisor } = body;
  const email = emailField || username;
  console.log(`[ADD-USER] org=${auth.orgId} email=${email} role=${role} supervisor=${supervisor} body_keys=${Object.keys(body).join(",")}`);

  if (!email || !password) {
    console.error(`[ADD-USER] ❌ Missing fields: email=${email} hasPassword=${!!password}`);
    return json({ error: "email and password required" }, 400);
  }
  const atIdx = email.indexOf("@"); const dotIdx = email.lastIndexOf(".");
  if (atIdx < 1 || dotIdx <= atIdx + 1 || dotIdx >= email.length - 1) {
    console.error(`[ADD-USER] ❌ Invalid email: ${email}`);
    return json({ error: "email must be a valid email address" }, 400);
  }

  const validRoles = ["admin", "judge", "manager", "reviewer", "user"];
  const userRole = validRoles.includes(role) ? role : "reviewer";

  if ((userRole === "judge" || userRole === "manager") && supervisor) {
    const sup = await getUser(auth.orgId, supervisor);
    if (!sup || sup.role !== "admin") {
      console.error(`[ADD-USER] ❌ Invalid supervisor for ${userRole}: supervisor=${supervisor} sup=${JSON.stringify(sup)}`);
      return json({ error: "judges and managers must be assigned to an admin" }, 400);
    }
  } else if ((userRole === "reviewer" || userRole === "user") && supervisor) {
    const sup = await getUser(auth.orgId, supervisor);
    if (!sup || (sup.role !== "judge" && sup.role !== "manager" && sup.role !== "admin")) {
      console.error(`[ADD-USER] ❌ Invalid supervisor for reviewer: supervisor=${supervisor} sup=${JSON.stringify(sup)}`);
      return json({ error: "reviewers must be assigned to a judge, manager, or admin" }, 400);
    }
  }

  try {
    await createUser(auth.orgId, email, password, userRole as any, supervisor || undefined);
    console.log(`[ADD-USER] ✅ Created ${email} (${userRole}) in org ${auth.orgId}`);
    return json({ ok: true, email, role: userRole, supervisor: supervisor || null });
  } catch (err: any) {
    console.error(`[ADD-USER] ❌ createUser failed for ${email}:`, err);
    return json({ error: err.message || "failed to create user" }, 500);
  }
}

async function handleAdminDeleteUser(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;
  const { email } = await req.json();
  if (!email) return json({ error: "email required" }, 400);
  if (email === auth.email) return json({ error: "cannot delete your own account" }, 400);
  await deleteUser(auth.orgId, email);
  console.log(`[DELETE-USER] ✅ ${auth.email} deleted ${email} from org ${auth.orgId}`);
  return json({ ok: true });
}

// -- Admin: Pipeline Config --

async function handleGetPipelineConfig(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  return json(await getPipelineConfig(auth.orgId));
}

async function handleSetPipelineConfig(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  const body = await req.json();
  const update: Record<string, number> = {};
  if (typeof body.maxRetries === "number") update.maxRetries = body.maxRetries;
  if (typeof body.retryDelaySeconds === "number") update.retryDelaySeconds = body.retryDelaySeconds;
  if (Object.keys(update).length === 0) {
    return json({ error: "provide maxRetries and/or retryDelaySeconds" }, 400);
  }
  const result = await setPipelineConfig(auth.orgId, update);
  return json(result);
}

// -- Gamification Settings --

async function handleAdminGetGamification(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;
  const settings = await getGamificationSettings(auth.orgId);
  return json(settings ?? { threshold: null, comboTimeoutMs: null, enabled: null, sounds: null });
}

async function handleAdminSaveGamification(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;
  const body = await req.json() as GamificationSettings;
  await saveGamificationSettings(auth.orgId, body);
  return json({ ok: true });
}

async function handleJudgeGetGamification(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  if (auth.role !== "judge" && auth.role !== "admin") return json({ error: "forbidden" }, 403);
  const override = await getJudgeGamificationOverride(auth.orgId, auth.email);
  const resolved = await resolveGamificationSettings(auth.orgId, auth.email, auth.role);
  const orgSettings = await getGamificationSettings(auth.orgId);
  return json({ override: override ?? { threshold: null, comboTimeoutMs: null, enabled: null, sounds: null }, resolved, orgDefaults: orgSettings });
}

async function handleJudgeSaveGamification(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  if (auth.role !== "judge" && auth.role !== "admin") return json({ error: "forbidden" }, 403);
  const body = await req.json() as GamificationSettings;
  await saveJudgeGamificationOverride(auth.orgId, auth.email, body);
  return json({ ok: true });
}

async function handleReviewerGetGamification(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const user = await getUser(auth.orgId, auth.email);
  const resolved = await resolveGamificationSettings(auth.orgId, auth.email, auth.role, user?.supervisor);
  const personal = await getReviewerGamificationOverride(auth.orgId, auth.email);
  return json({ resolved, personal: personal ?? { threshold: null, comboTimeoutMs: null, enabled: null, sounds: null } });
}

async function handleReviewerSaveGamification(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const body = await req.json() as GamificationSettings;
  await saveReviewerGamificationOverride(auth.orgId, auth.email, body);
  return json({ ok: true });
}

// -- Store Page --

async function handleStorePage(req: Request): Promise<Response> {
  const auth = await authenticate(req);
  if (!auth) return Response.redirect(new URL("/login", req.url).href, 302);
  return html(getStorePage());
}

// -- Chat Page --

async function handleChatPage(req: Request): Promise<Response> {
  const auth = await authenticate(req);
  if (!auth) return Response.redirect(new URL("/login", req.url).href, 302);
  return html(getChatPage());
}

async function handleChatMe(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  return json({ username: auth.email, role: auth.role });
}

async function handleChatCosmetics(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const FRAME_RANK: Record<string, number> = {
    frame_bronze: 1, frame_silver: 2, frame_emerald: 3, frame_neon: 4,
    frame_fire: 5, frame_frost: 6, frame_toxic: 7, frame_diamond: 8,
    frame_galaxy: 9, frame_legendary: 10,
    frame_plasma: 11, frame_aurora: 12, frame_obsidian: 13, frame_crimson: 14,
    frame_hologram: 15, frame_sakura: 16, frame_storm: 17, frame_void: 18,
  };
  const FLAIR_INFO: Record<string, { rank: number; icon: string }> = {
    flair_star: { rank: 1, icon: "\u2B50" },
    flair_check: { rank: 2, icon: "\u2705" },
    flair_bolt: { rank: 3, icon: "\u26A1" },
    flair_flame: { rank: 4, icon: "\uD83D\uDD25" },
    flair_rocket: { rank: 5, icon: "\uD83D\uDE80" },
    flair_shield: { rank: 6, icon: "\uD83D\uDEE1\uFE0F" },
    flair_rose: { rank: 7, icon: "\uD83C\uDF39" },
    flair_diamond: { rank: 8, icon: "\uD83D\uDC8E" },
    flair_skull: { rank: 9, icon: "\uD83D\uDC80" },
    flair_crown: { rank: 10, icon: "\uD83D\uDC51" },
    flair_trident: { rank: 11, icon: "\uD83D\uDD31" },
  };
  const COLOR_INFO: Record<string, { rank: number; preview: string }> = {
    color_emerald: { rank: 1, preview: "#3fb950" },
    color_ruby: { rank: 2, preview: "#f85149" },
    color_sapphire: { rank: 3, preview: "#58a6ff" },
    color_gold: { rank: 4, preview: "#f59e0b" },
    color_violet: { rank: 5, preview: "#a855f7" },
    color_toxic: { rank: 6, preview: "#84cc16" },
    color_frost: { rank: 7, preview: "#7dd3fc" },
    color_sunset: { rank: 8, preview: "linear-gradient(90deg,#f97316,#ec4899)" },
    color_ocean: { rank: 9, preview: "linear-gradient(90deg,#14b8a6,#3b82f6)" },
    color_inferno: { rank: 10, preview: "linear-gradient(90deg,#dc2626,#f97316,#eab308)" },
    color_aurora: { rank: 11, preview: "linear-gradient(90deg,#3fb950,#58a6ff,#a855f7)" },
    color_vaporwave: { rank: 12, preview: "linear-gradient(90deg,#ec4899,#8b5cf6,#06b6d4)" },
    color_rainbow: { rank: 13, preview: "linear-gradient(90deg,#f85149,#f97316,#eab308,#3fb950,#58a6ff,#a855f7)" },
    color_prismatic: { rank: 14, preview: "linear-gradient(90deg,#fff,#f0abfc,#c4b5fd,#93c5fd,#6ee7b7,#fde68a,#fca5a5)" },
  };
  const FONT_INFO: Record<string, { rank: number; css: string }> = {
    font_mono: { rank: 1, css: "'Courier New', monospace" },
    font_serif: { rank: 2, css: "Georgia, 'Times New Roman', serif" },
    font_handwritten: { rank: 3, css: "'Comic Sans MS', cursive" },
    font_bold: { rank: 4, css: "Impact, 'Arial Black', sans-serif" },
    font_pixel: { rank: 5, css: "'Courier New', monospace" },
    font_gothic: { rank: 6, css: "'Old English Text MT', serif" },
    font_neon_script: { rank: 7, css: "'Brush Script MT', cursive" },
    font_chrome: { rank: 8, css: "'Trebuchet MS', sans-serif" },
  };
  const BUBBLE_FONT_INFO: Record<string, { rank: number; css: string }> = {
    bfont_mono: { rank: 1, css: "'Courier New', monospace" },
    bfont_serif: { rank: 2, css: "Georgia, 'Times New Roman', serif" },
    bfont_script: { rank: 3, css: "'Brush Script MT', cursive" },
    bfont_impact: { rank: 4, css: "Impact, 'Arial Black', sans-serif" },
    bfont_gothic: { rank: 5, css: "'Old English Text MT', serif" },
    bfont_neon: { rank: 6, css: "'Trebuchet MS', sans-serif" },
  };
  const BUBBLE_COLOR_INFO: Record<string, { rank: number; preview: string }> = {
    bcolor_emerald: { rank: 1, preview: "#3fb950" },
    bcolor_ruby: { rank: 2, preview: "#f85149" },
    bcolor_gold: { rank: 3, preview: "#f59e0b" },
    bcolor_cyan: { rank: 4, preview: "#22d3ee" },
    bcolor_violet: { rank: 5, preview: "#a855f7" },
    bcolor_sunset: { rank: 6, preview: "linear-gradient(135deg,#f97316,#ec4899)" },
    bcolor_rainbow: { rank: 7, preview: "linear-gradient(90deg,#f85149,#f97316,#eab308,#3fb950,#58a6ff,#a855f7)" },
    bcolor_prismatic: { rank: 8, preview: "linear-gradient(90deg,#fff,#f0abfc,#c4b5fd,#93c5fd,#6ee7b7,#fde68a,#fca5a5)" },
  };
  const TITLE_RANK: Record<string, { rank: number; label: string }> = {
    title_rookie: { rank: 1, label: "Rookie" },
    title_ace: { rank: 2, label: "Ace Agent" },
    title_shadow: { rank: 3, label: "Shadow Ops" },
    title_warden: { rank: 4, label: "Warden" },
    title_elite: { rank: 5, label: "Elite Performer" },
    title_oracle: { rank: 6, label: "Oracle" },
    title_phantom: { rank: 7, label: "Phantom" },
    title_apex: { rank: 8, label: "Apex Predator" },
    title_legend: { rank: 9, label: "Legend" },
    title_immortal: { rank: 10, label: "Immortal" },
  };
  const EPIC_FLAIRS = new Set(["flair_skull", "flair_crown", "flair_trident"]);

  const users = await listUsers(auth.orgId);
  const customItems = await listCustomStoreItems(auth.orgId);
  const customItemMap = new Map(customItems.map((i) => [i.id, i]));
  const cosmetics: Record<string, {
    frame: string | null; frameColor: string | null;
    flair: string | null; flairIcon: string | null;
    nameColor: string | null; nameColorCSS: string | null;
    font: string | null; fontCSS: string | null; avatarIcon: string | null;
    bubbleFont: string | null; bubbleFontCSS: string | null;
    bubbleColor: string | null; bubbleColorCSS: string | null;
    title: string | null; titleLabel: string | null;
    theme: string | null;
  }> = {};

  await Promise.all(users.map(async (u) => {
    const gs = await getGameState(auth.orgId, u.email);
    let bestFrame: string | null = null, bestFrameRank = 0;
    let bestFlair: string | null = null, bestFlairIcon: string | null = null, bestFlairRank = 0;
    let bestColor: string | null = null, bestColorCSS: string | null = null, bestColorRank = 0;
    let bestFont: string | null = null, bestFontCSS: string | null = null, bestFontRank = 0;
    let bestBubbleFont: string | null = null, bestBubbleFontCSS: string | null = null, bestBubbleFontRank = 0;
    let bestBubbleColor: string | null = null, bestBubbleColorCSS: string | null = null, bestBubbleColorRank = 0;
    let bestTitle: string | null = null, bestTitleLabel: string | null = null, bestTitleRank = 0;

    for (const p of gs.purchases) {
      if (FRAME_RANK[p] && FRAME_RANK[p] > bestFrameRank) { bestFrame = p; bestFrameRank = FRAME_RANK[p]; }
      // Custom frames: rank by price (offset by 100 to sort after built-ins)
      if (!FRAME_RANK[p] && customItemMap.has(p) && customItemMap.get(p)!.type === "avatar_frame") {
        const cRank = 100 + customItemMap.get(p)!.price;
        if (cRank > bestFrameRank) { bestFrame = p; bestFrameRank = cRank; }
      }
      if (FLAIR_INFO[p] && FLAIR_INFO[p].rank > bestFlairRank) { bestFlair = p; bestFlairIcon = FLAIR_INFO[p].icon; bestFlairRank = FLAIR_INFO[p].rank; }
      if (COLOR_INFO[p] && COLOR_INFO[p].rank > bestColorRank) { bestColor = p; bestColorCSS = COLOR_INFO[p].preview; bestColorRank = COLOR_INFO[p].rank; }
      if (FONT_INFO[p] && FONT_INFO[p].rank > bestFontRank) { bestFont = p; bestFontCSS = FONT_INFO[p].css; bestFontRank = FONT_INFO[p].rank; }
      if (BUBBLE_FONT_INFO[p] && BUBBLE_FONT_INFO[p].rank > bestBubbleFontRank) { bestBubbleFont = p; bestBubbleFontCSS = BUBBLE_FONT_INFO[p].css; bestBubbleFontRank = BUBBLE_FONT_INFO[p].rank; }
      if (BUBBLE_COLOR_INFO[p] && BUBBLE_COLOR_INFO[p].rank > bestBubbleColorRank) { bestBubbleColor = p; bestBubbleColorCSS = BUBBLE_COLOR_INFO[p].preview; bestBubbleColorRank = BUBBLE_COLOR_INFO[p].rank; }
      if (TITLE_RANK[p] && TITLE_RANK[p].rank > bestTitleRank) { bestTitle = p; bestTitleLabel = TITLE_RANK[p].label; bestTitleRank = TITLE_RANK[p].rank; }
    }

    // Equipped title overrides highest-rank purchased title
    if (gs.equippedTitle && TITLE_RANK[gs.equippedTitle] && gs.purchases.includes(gs.equippedTitle)) {
      bestTitle = gs.equippedTitle;
      bestTitleLabel = TITLE_RANK[gs.equippedTitle].label;
    }

    const avatarIcon = (bestFlair && EPIC_FLAIRS.has(bestFlair)) ? bestFlairIcon : null;
    const theme = (gs.equippedTheme && gs.purchases.includes(gs.equippedTheme)) ? gs.equippedTheme : null;

    // Custom frame: if best frame isn't in hardcoded FRAME_RANK, return its preview as frameColor
    let frameColor: string | null = null;
    if (bestFrame && !FRAME_RANK[bestFrame]) {
      const customFrame = customItemMap.get(bestFrame);
      if (customFrame?.preview) frameColor = customFrame.preview;
    }

    cosmetics[u.email] = {
      frame: bestFrame, frameColor,
      flair: bestFlair, flairIcon: bestFlairIcon,
      nameColor: bestColor, nameColorCSS: bestColorCSS,
      font: bestFont, fontCSS: bestFontCSS, avatarIcon,
      bubbleFont: bestBubbleFont, bubbleFontCSS: bestBubbleFontCSS,
      bubbleColor: bestBubbleColor, bubbleColorCSS: bestBubbleColorCSS,
      title: bestTitle, titleLabel: bestTitleLabel,
      theme,
    };
  }));

  return json(cosmetics);
}

// -- Equip API --

async function handleEquip(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const body = await req.json();
  const { category, itemId, eventType, animationId } = body;
  const gs = await getGameState(auth.orgId, auth.email);

  if (category === "title") {
    if (!itemId) return json({ error: "itemId required" }, 400);
    if (itemId !== "none" && !gs.purchases.includes(itemId)) return json({ error: "not owned" }, 403);
    gs.equippedTitle = itemId === "none" ? null : itemId;
  } else if (category === "theme") {
    if (!itemId) return json({ error: "itemId required" }, 400);
    if (itemId !== "none" && !gs.purchases.includes(itemId)) return json({ error: "not owned" }, 403);
    gs.equippedTheme = itemId === "none" ? null : itemId;
  } else if (category === "animation") {
    if (!eventType) return json({ error: "eventType required" }, 400);
    if (!PREFAB_EVENTS.some((e) => e.type === eventType)) return json({ error: "invalid event type" }, 400);
    if (animationId && animationId !== "none" && !gs.purchases.includes(animationId)) return json({ error: "not owned" }, 403);
    if (!gs.animBindings) gs.animBindings = {};
    if (!animationId || animationId === "none") {
      delete gs.animBindings[eventType];
    } else {
      gs.animBindings[eventType] = animationId;
    }
  } else {
    return json({ error: "invalid category" }, 400);
  }

  await saveGameState(auth.orgId, auth.email, gs);
  return json({ ok: true });
}

// -- Prefab Subscription Endpoints --

async function handleGetPrefabSubscriptions(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  if (auth.role !== "manager" && auth.role !== "admin") return json({ error: "forbidden" }, 403);
  const subs = await getPrefabSubscriptions(auth.orgId);
  return json({ subscriptions: subs });
}

async function handleSavePrefabSubscriptions(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  if (auth.role !== "manager" && auth.role !== "admin") return json({ error: "forbidden" }, 403);
  const body = await req.json();
  const { subscriptions } = body;
  if (!subscriptions || typeof subscriptions !== "object") return json({ error: "subscriptions object required" }, 400);
  await savePrefabSubscriptions(auth.orgId, subscriptions);
  return json({ ok: true });
}

// -- Badges API --

async function handleBadgesApi(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const badges = await getEarnedBadges(auth.orgId, auth.email);
  return json({ earned: badges.map((b) => b.badgeId) });
}

// -- Gamification Page Handlers --

async function handleGamificationPageGet(req: Request): Promise<Response> {
  const auth = await authenticate(req);
  if (!auth || (auth.role !== "admin" && auth.role !== "judge")) {
    return Response.redirect(new URL("/login", req.url).href, 302);
  }
  return html(getGamificationPage());
}

async function handleListPacks(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  if (auth.role !== "admin" && auth.role !== "judge") return json({ error: "forbidden" }, 403);
  const packs = await listSoundPacks(auth.orgId);
  return json(packs);
}

async function handleSavePack(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  if (auth.role !== "admin" && auth.role !== "judge") return json({ error: "forbidden" }, 403);
  const body = await req.json();
  const { id, name } = body;
  if (!name) return json({ error: "name required" }, 400);
  const packId = id || crypto.randomUUID().slice(0, 8);
  const existing = await getSoundPack(auth.orgId, packId);
  const pack: SoundPackMeta = {
    id: packId,
    name,
    slots: existing?.slots ?? {},
    createdAt: existing?.createdAt ?? Date.now(),
    createdBy: existing?.createdBy ?? auth.email,
  };
  await saveSoundPack(auth.orgId, pack);
  return json(pack);
}

async function handleDeletePack(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  if (auth.role !== "admin" && auth.role !== "judge") return json({ error: "forbidden" }, 403);
  const body = await req.json();
  const { id } = body;
  if (!id) return json({ error: "id required" }, 400);
  // Delete S3 files for all slots
  const pack = await getSoundPack(auth.orgId, id);
  if (pack) {
    const SLOTS: SoundSlot[] = ["ping", "double", "triple", "mega", "ultra", "rampage", "godlike", "levelup"];
    for (const slot of SLOTS) {
      if (pack.slots[slot]) {
        try {
          const ref = new S3Ref(env.s3Bucket, `sounds/${auth.orgId}/${id}/${slot}.mp3`);
          await ref.save(new Uint8Array(0)); // S3 doesn't have delete in our client, overwrite with empty
        } catch { /* best effort */ }
      }
    }
  }
  await deleteSoundPack(auth.orgId, id);
  return json({ ok: true });
}

async function handleUploadSound(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  if (auth.role !== "admin" && auth.role !== "judge") return json({ error: "forbidden" }, 403);

  const formData = await req.formData();
  const packId = formData.get("packId") as string;
  const slot = formData.get("slot") as string;
  const file = formData.get("file") as File;

  if (!packId || !slot || !file) return json({ error: "packId, slot, and file required" }, 400);
  const validSlots: SoundSlot[] = ["ping", "double", "triple", "mega", "ultra", "rampage", "godlike", "levelup"];
  if (!validSlots.includes(slot as SoundSlot)) return json({ error: "invalid slot" }, 400);
  if (file.size > 2 * 1024 * 1024) return json({ error: "file too large (max 2MB)" }, 400);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const s3Key = `sounds/${auth.orgId}/${packId}/${slot}.mp3`;
  const ref = new S3Ref(env.s3Bucket, s3Key);
  await ref.save(bytes);

  // Update pack metadata
  const pack = await getSoundPack(auth.orgId, packId);
  if (pack) {
    pack.slots[slot as SoundSlot] = file.name;
    await saveSoundPack(auth.orgId, pack);
  }

  return json({ ok: true, slot, filename: file.name });
}

const BUILTIN_PACKS: Record<string, Record<SoundSlot, string>> = {
  smite: { ping: "smite-mario-coin.mp3", double: "smite-double-kill.mp3", triple: "smite-triple-kill.mp3", mega: "smite-quadra-kill.mp3", ultra: "smite-penta-kill.mp3", rampage: "smite-rampage.mp3", godlike: "smite-godlike.mp3", levelup: "smite-unstoppable.mp3", shutdown: "" },
  opengameart: { ping: "oga-Coin01.mp3", double: "oga-Rise01.mp3", triple: "oga-Rise02.mp3", mega: "oga-Rise03.mp3", ultra: "oga-Rise04.mp3", rampage: "oga-Rise05.mp3", godlike: "oga-Rise07.mp3", levelup: "oga-Upper01.mp3", shutdown: "" },
  "mixkit-punchy": { ping: "mixkit-winning-coin.mp3", double: "mixkit-alert-ding.mp3", triple: "mixkit-achievement-bell.mp3", mega: "mixkit-bonus-reached.mp3", ultra: "mixkit-game-bonus.mp3", rampage: "mixkit-success-alert.mp3", godlike: "mixkit-arcade-retro.mp3", levelup: "mixkit-fairy-sparkle.mp3", shutdown: "" },
  "mixkit-epic": { ping: "mixkit-notification.mp3", double: "mixkit-game-notification.mp3", triple: "mixkit-magic-notify.mp3", mega: "mixkit-achievement-bell.mp3", ultra: "mixkit-bonus-reached.mp3", rampage: "mixkit-arcade-retro.mp3", godlike: "mixkit-success-alert.mp3", levelup: "mixkit-fairy-sparkle.mp3", shutdown: "" },
};

const BUILTIN_PACK_NAMES: Record<string, string> = {
  smite: "SMITE Announcer",
  opengameart: "OpenGameArt CC0",
  "mixkit-punchy": "Mixkit Punchy",
  "mixkit-epic": "Mixkit Epic",
};

async function handleSeedSoundPacks(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  if (auth.role !== "admin") return json({ error: "admin only" }, 403);

  let uploaded = 0;
  const errors: string[] = [];

  for (const [packId, slots] of Object.entries(BUILTIN_PACKS)) {
    // Create pack metadata
    const pack: SoundPackMeta = {
      id: packId,
      name: BUILTIN_PACK_NAMES[packId] || packId,
      slots: {},
      createdAt: Date.now(),
      createdBy: auth.email,
    };

    for (const [slot, filename] of Object.entries(slots)) {
      try {
        const filePath = new URL("./sounds/" + filename, import.meta.url);
        const bytes = await Deno.readFile(filePath);
        const s3Key = `sounds/${auth.orgId}/${packId}/${slot}.mp3`;
        const ref = new S3Ref(env.s3Bucket, s3Key);
        await ref.save(bytes);
        pack.slots[slot as SoundSlot] = filename;
        uploaded++;
      } catch (e) {
        errors.push(`${packId}/${slot}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    await saveSoundPack(auth.orgId, pack);
  }

  return json({ ok: true, uploaded, packs: Object.keys(BUILTIN_PACKS).length, errors: errors.length > 0 ? errors : undefined });
}

async function handleGamificationPageGetSettings(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  if (auth.role !== "admin" && auth.role !== "judge") return json({ error: "forbidden" }, 403);

  if (auth.role === "admin") {
    const settings = await getGamificationSettings(auth.orgId);
    return json({ settings: settings ?? { threshold: null, comboTimeoutMs: null, enabled: null, sounds: null }, role: "admin", orgId: auth.orgId });
  }
  // Judge
  const override = await getJudgeGamificationOverride(auth.orgId, auth.email);
  const orgSettings = await getGamificationSettings(auth.orgId);
  return json({ settings: override ?? { threshold: null, comboTimeoutMs: null, enabled: null, sounds: null }, orgDefaults: orgSettings, role: "judge", orgId: auth.orgId });
}

async function handleGamificationPageSaveSettings(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  if (auth.role !== "admin" && auth.role !== "judge") return json({ error: "forbidden" }, 403);
  const body = await req.json() as GamificationSettings;

  if (auth.role === "admin") {
    await saveGamificationSettings(auth.orgId, body);
  } else {
    await saveJudgeGamificationOverride(auth.orgId, auth.email, body);
  }
  return json({ ok: true });
}

// -- Admin: Queues + Parallelism --

async function handleGetQueues(_req: Request): Promise<Response> {
  const res = await fetch(`${env.qstashUrl}/v2/queues`, {
    headers: { Authorization: `Bearer ${env.qstashToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    return json({ error: `QStash error: ${res.status} ${text}` }, res.status);
  }
  return json(await res.json());
}

async function handleSetQueue(req: Request): Promise<Response> {
  const body = await req.json();
  const { queueName, parallelism } = body;
  if (!queueName || parallelism == null) {
    return json({ error: "queueName and parallelism required" }, 400);
  }

  const res = await fetch(`${env.qstashUrl}/v2/queues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.qstashToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ queueName, parallelism }),
  });
  if (!res.ok) {
    const text = await res.text();
    return json({ error: `QStash error: ${res.status} ${text}` }, res.status);
  }
  return json(await res.json());
}

async function handleGetParallelism(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;
  const config = await getPipelineConfig(auth.orgId);
  console.log(`[PARALLELISM] GET → ${config.parallelism}`);
  return json({ parallelism: config.parallelism });
}

async function handleSetParallelism(req: Request): Promise<Response> {
  console.log(`[PARALLELISM] POST received`);
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) { console.warn(`[PARALLELISM] POST auth failed`); return auth; }
  const body = await req.json();
  const { parallelism } = body;
  if (parallelism == null || typeof parallelism !== "number" || parallelism < 1) {
    return json({ error: "parallelism must be a number >= 1" }, 400);
  }
  // Persist to KV as source of truth
  await setPipelineConfig(auth.orgId, { parallelism });
  // Apply to all QStash queues concurrently
  const results = await Promise.all(
    ALL_QUEUES.map(async (queueName) => {
      const res = await fetch(`${env.qstashUrl}/v2/queues`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.qstashToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ queueName, parallelism }),
      });
      const ok = res.ok;
      if (!ok) console.error(`[PARALLELISM] ❌ Failed to set ${queueName}: ${res.status} ${await res.text()}`);
      else console.log(`[PARALLELISM] ✅ ${queueName} → ${parallelism}`);
      return { queueName, ok };
    })
  );
  console.log(`[PARALLELISM] Set to ${parallelism} across ${results.filter((r) => r.ok).length}/${ALL_QUEUES.length} queues`);
  return json({ ok: true, parallelism, queues: results });
}

// -- Admin: Email Reports --

async function handleListEmailReports(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  const configs = await listEmailReportConfigs(auth.orgId);
  return json(configs);
}

async function handleSaveEmailReport(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  const body = await req.json();
  if (!body.name || !body.recipients?.length) {
    return json({ error: "name and recipients required" }, 400);
  }
  const saved = await saveEmailReportConfig(auth.orgId, body);
  // Invalidate cached preview — data or config may have changed
  if (saved.id) await deleteEmailReportPreview(auth.orgId, saved.id);
  return json(saved);
}

async function handleDeleteEmailReport(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  const body = await req.json();
  if (!body.id) return json({ error: "id required" }, 400);
  await deleteEmailReportConfig(auth.orgId, body.id);
  return json({ ok: true });
}

async function handleSendNowEmailReport(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  const body = await req.json();
  if (!body.id) return json({ error: "id required" }, 400);

  const config = await getEmailReportConfig(auth.orgId, body.id);
  if (!config) return json({ error: "report config not found" }, 404);
  if (!config.recipients?.length) return json({ error: "no recipients configured" }, 400);

  try {
    await runReport(auth.orgId, config);
    return json({ ok: true });
  } catch (err) {
    console.error(`[SEND-NOW] ❌ org=${auth.orgId} id=${body.id}:`, err);
    return json({ error: String(err) }, 500);
  }
}

async function handlePreviewEmailReport(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  const body = await req.json();
  if (!body.id) return json({ error: "id required" }, 400);

  const config = await getEmailReportConfig(auth.orgId, body.id);
  if (!config) return json({ error: "report config not found" }, 404);

  try {
    const sections = await queryReportData(auth.orgId, config);
    const template = config.templateId ? await getEmailTemplate(auth.orgId, config.templateId) : null;
    const sectionsHtml = renderSections(sections);
    const htmlBody = renderFullEmail(template?.html ?? null, sectionsHtml, config.name);

    await saveEmailReportPreview(auth.orgId, body.id, htmlBody);
    return json({ ok: true });
  } catch (err) {
    console.error(`[PREVIEW] ❌ org=${auth.orgId} id=${body.id}:`, err);
    return json({ error: String(err) }, 500);
  }
}

async function handlePreviewInlineEmailReport(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  const config = await req.json();
  if (!config.name) return json({ error: "config.name required" }, 400);

  try {
    const sections = await queryReportData(auth.orgId, config);
    const template = config.templateId ? await getEmailTemplate(auth.orgId, config.templateId) : null;
    const sectionsHtml = renderSections(sections);
    const htmlBody = renderFullEmail(template?.html ?? null, sectionsHtml, config.name);
    return new Response(htmlBody, { headers: { "content-type": "text/html; charset=utf-8" } });
  } catch (err) {
    console.error(`[PREVIEW-INLINE] ❌ org=${auth.orgId}:`, err);
    return json({ error: String(err) }, 500);
  }
}

async function handlePreviewViewEmailReport(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return json({ error: "id required" }, 400);

  const previewHtml = await getEmailReportPreview(auth.orgId, id);
  if (!previewHtml) return new Response("Preview expired or not generated yet.", { status: 404, headers: { "content-type": "text/plain" } });

  return new Response(previewHtml.html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

// -- Admin: Email Templates --

async function handleListEmailTemplates(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;
  return json(await listEmailTemplates(auth.orgId));
}

async function handleGetEmailTemplate(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return json({ error: "id required" }, 400);
  const t = await getEmailTemplate(auth.orgId, id);
  return t ? json(t) : json({ error: "not found" }, 404);
}

async function handleSaveEmailTemplate(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;
  const body = await req.json();
  if (!body.name || !body.subject || !body.html) return json({ error: "name, subject, html required" }, 400);
  return json(await saveEmailTemplate(auth.orgId, body));
}

async function handleDeleteEmailTemplate(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;
  const body = await req.json();
  if (!body.id) return json({ error: "id required" }, 400);
  await deleteEmailTemplate(auth.orgId, body.id);
  return json({ ok: true });
}

// -- Admin: Bad Word Config --

async function handleGetBadWordConfig(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;
  return json(await getBadWordConfig(auth.orgId));
}

async function handleSaveBadWordConfig(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;
  const body = await req.json();
  await saveBadWordConfig(auth.orgId, body);
  return json({ ok: true });
}

// -- Admin: Office Bypass Config --

async function handleGetOfficeBypass(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;
  return json(await getOfficeBypassConfig(auth.orgId));
}

async function handleSaveOfficeBypass(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;
  const body = await req.json();
  await saveOfficeBypassConfig(auth.orgId, body);
  const patterns: string[] = body.patterns ?? [];
  const pruned = await pruneBypassedFromQueues(auth.orgId, patterns);
  console.log(`[ADMIN] OfficeBypass saved by ${auth.email}: reviewPruned=${pruned.reviewPruned} judgePruned=${pruned.judgePruned}`);
  return json({ ok: true, ...pruned });
}

// -- Admin: Manager Scopes --

async function handleGetManagerScopes(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;
  const scopes = await listManagerScopes(auth.orgId);
  return json(scopes);
}

async function handleSaveManagerScope(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;
  const body = await req.json();
  const { email, departments, shifts } = body;
  if (!email) return json({ error: "email required" }, 400);
  await saveManagerScope(auth.orgId, email, {
    departments: Array.isArray(departments) ? departments : [],
    shifts: Array.isArray(shifts) ? shifts : [],
  });
  return json({ ok: true });
}

async function handleGetAuditDimensions(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;
  const [dims, completed] = await Promise.all([
    getAuditDimensions(auth.orgId),
    getAllCompleted(auth.orgId),
  ]);
  // Always merge live audit data so new offices appear automatically
  const liveDepts = completed.map((c) => c.department).filter(Boolean) as string[];
  const liveShifts = completed.map((c) => c.shift).filter(Boolean) as string[];
  const mergedDepts = [...new Set([...dims.departments, ...liveDepts])].sort();
  const mergedShifts = [...new Set([...dims.shifts, ...liveShifts])].sort();
  const changed = mergedDepts.length !== dims.departments.length || mergedShifts.length !== dims.shifts.length;
  if (changed) await saveAuditDimensions(auth.orgId, { departments: mergedDepts, shifts: mergedShifts });
  return json({ departments: mergedDepts, shifts: mergedShifts });
}

async function handleSaveAuditDimensions(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;
  const body = await req.json();
  await saveAuditDimensions(auth.orgId, {
    departments: Array.isArray(body.departments) ? [...new Set(body.departments as string[])].sort() : [],
    shifts: Array.isArray(body.shifts) ? [...new Set(body.shifts as string[])].sort() : [],
  });
  return json({ ok: true });
}

// -- Admin: Chargebacks & Omissions Report --

const CHARGEBACK_QUESTIONS = new Set([
  "Income",
  "MCC Recurring Charges Disclosed?",
  "Married/Cohab Qualifier Question",
  "Single Qualifier Question",
]);

async function handleGetChargebacks(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;
  const url = new URL(req.url);
  const since = parseInt(url.searchParams.get("since") ?? "0", 10);
  const until = parseInt(url.searchParams.get("until") ?? String(Date.now()), 10);
  if (!since) return json({ error: "since required" }, 400);
  const entries = await getChargebackEntries(auth.orgId, since, until);
  const chargebacks = entries.filter((e) => e.failedQHeaders.some((h) => CHARGEBACK_QUESTIONS.has(h)));
  const omissions = entries.filter((e) => e.failedQHeaders.some((h) => !CHARGEBACK_QUESTIONS.has(h)));
  return json({ chargebacks, omissions });
}

async function handleGetWireDeductions(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;
  const url = new URL(req.url);
  const since = parseInt(url.searchParams.get("since") ?? "0", 10);
  const until = parseInt(url.searchParams.get("until") ?? String(Date.now()), 10);
  if (!since) return json({ error: "since required" }, 400);
  const result = await getWireDeductionEntries(auth.orgId, since, until);
  console.log(`[WIRE-DEDUCTIONS] orgId=${auth.orgId} since=${since} until=${until} found=${result.items.length} total=${result.totalCount} newestTs=${result.newestTs}`);
  return json({ items: result.items, _debug: { totalCount: result.totalCount, newestTs: result.newestTs, orgId: auth.orgId } });
}

async function handlePostToSheet(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;
  const body = await req.json();
  const { since, until, tabs } = body as { since: number; until: number; tabs: string };
  if (!since || !until || !tabs) return json({ error: "since, until, tabs required" }, 400);
  const saS3Key = env.sheetsSaS3Key;
  const sheetId = env.chargebacksSheetId;
  const orgId = env.chargebacksOrgId as OrgId;
  if (!saS3Key || !sheetId || !orgId) return json({ error: "sheets not configured" }, 500);
  const saBytes = await new S3Ref(env.s3Bucket, saS3Key).get();
  if (!saBytes) return json({ error: "SA credentials not found" }, 500);
  const saJson = JSON.parse(new TextDecoder().decode(saBytes));
  const saEmail = saJson.client_email as string;
  const saKey = saJson.private_key as string;
  const tabList = tabs.split(",").map((t: string) => t.trim());
  const fmtDate = (ts: number) => new Date(ts).toLocaleDateString("en-US");
  const realm = Deno.env.get("QB_REALM");
  const crmUrl = (e: { recordId: string }) => `https://${realm}.quickbase.com/db/bpb28qsnn?a=dr&rid=${e.recordId}`;
  const pkgCrmUrl = (e: { recordId: string }) => `https://${realm}.quickbase.com/nav/app/bmhvhc7sk/table/bttffb64u/action/dr?rid=${e.recordId}`;
  const auditUrl = (e: { findingId: string }) => `${env.selfUrl}/audit/report?id=${e.findingId}`;
  const posted: string[] = [];
  if (tabList.includes("chargebacks") || tabList.includes("omissions")) {
    const entries = await getChargebackEntries(orgId, since, until);
    const chargebacks = entries.filter((e) => e.failedQHeaders.some((h) => CHARGEBACK_QUESTIONS.has(h)));
    const omissions = entries.filter((e) => e.failedQHeaders.some((h) => !CHARGEBACK_QUESTIONS.has(h)));
    const toRows = (list: typeof entries): string[][] =>
      list.map((e) => [fmtDate(e.ts), e.voName, e.revenue, crmUrl(e), e.destination, e.failedQHeaders.join(", "), `${e.score}%`]);
    if (tabList.includes("chargebacks")) { await appendSheetRows(sheetId, "Chargebacks", toRows(chargebacks), saEmail, saKey); posted.push("Chargebacks"); }
    if (tabList.includes("omissions")) { await appendSheetRows(sheetId, "Omissions", toRows(omissions), saEmail, saKey); posted.push("Omissions"); }
  }
  if (tabList.includes("wire")) {
    const wireResult = await getWireDeductionEntries(orgId, since, until);
    const toWireRows = (list: WireDeductionEntry[]): string[][] =>
      list.map((e) => [fmtDate(e.ts), `${e.score}%`, String(e.questionsAudited), String(e.totalSuccess), pkgCrmUrl(e), auditUrl(e), e.office, e.excellenceAuditor, "", e.guestName]);
    await appendSheetRows(sheetId, "Wire Deductions", toWireRows(wireResult.items), saEmail, saKey);
    posted.push("Wire Deductions");
  }
  console.log(`[POST-TO-SHEET] ✅ Posted by ${auth.email}: ${posted.join(", ")}`);
  return json({ ok: true, posted });
}

async function handleTriggerWeeklySheets(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;
  const now = Date.now();
  const since = now - 7 * 24 * 3600 * 1000;
  console.log("[TRIGGER-WEEKLY-SHEETS] 🚀 Manual trigger by", auth.email);
  runWeeklySheets(since, now).then(() => {
    console.log("[TRIGGER-WEEKLY-SHEETS] ✅ Done");
  }).catch((err) => {
    console.error("[TRIGGER-WEEKLY-SHEETS] ❌", err);
  });
  return json({ ok: true, message: "Weekly sheets job started" });
}

// -- Webhooks: Shared Helpers --

/** Resolve template — only sends if a specific template is configured via emailTemplateId. */
async function resolveWebhookTemplate(orgId: OrgId, webhookCfg: WebhookConfig | null) {
  if (!webhookCfg?.emailTemplateId) return null;
  return getEmailTemplate(orgId, webhookCfg.emailTemplateId);
}

/** Parse QB VoName field "VO MB - Harmony Eason" → { full: "Harmony Eason", first: "Harmony" } */
function parseVoName(voNameRaw: string, fallback: string) {
  const full = voNameRaw.includes(" - ")
    ? voNameRaw.split(" - ").slice(1).join(" - ").trim()
    : voNameRaw.trim();
  const display = full || (fallback.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()) || fallback);
  return { full: display, first: display.split(" ")[0] || display };
}

/** Mustache-style variable substitution. */
function renderTemplate(str: string, vars: Record<string, string>): string {
  return str.replace(/\{\{(\w+)\}\}/g, (_: string, k: string) => vars[k] ?? "");
}

/** Resolve test/live recipients. In test mode: only testEmail, no cc/bcc. */
function resolveRecipients(webhookCfg: WebhookConfig | null, to: string) {
  const test = webhookCfg?.testEmail || "";
  return {
    to: test || to,
    cc: test ? undefined : undefined, // caller sets cc
    bcc: test ? undefined : (webhookCfg?.bcc || undefined),
    isTest: !!test,
  };
}

// -- Webhooks: Audit Complete Email --

async function handleAuditCompleteWebhook(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const orgId = url.searchParams.get("org") as OrgId;
  if (!orgId) return json({ error: "org required" }, 400);
  // ?testOverrideTo=a@b.com,c@d.com — forces recipients, bypasses webhook config (for test scripts)
  const testOverrideTo = url.searchParams.get("testOverrideTo") || "";

  const webhookCfg = await getWebhookConfig(orgId, "terminate").catch((err) => {
    console.error(`[EMAIL] audit-complete: getWebhookConfig failed:`, err);
    return null;
  });
  console.log(`[EMAIL] audit-complete: org=${orgId} emailTemplateId=${webhookCfg?.emailTemplateId ?? "NONE"} testEmail=${webhookCfg?.testEmail ?? ""} testOverrideTo=${testOverrideTo || "none"}`);

  const body = await req.json();
  const { finding, score } = body;
  if (!finding) return json({ error: "finding required" }, 400);

  const template = await resolveWebhookTemplate(orgId, webhookCfg);
  if (!template) {
    console.log(`[EMAIL] audit-complete: skipped — emailTemplateId=${webhookCfg?.emailTemplateId ?? "not set"}`);
    return json({ ok: true, skipped: "no template configured" });
  }
  console.log(`[EMAIL] audit-complete: template="${template.name}" subject="${template.subject}"`);

  const agentEmail = finding.owner ?? "";
  const voEmail = String(finding.record?.VoEmail ?? "");
  const supervisorEmail = String(finding.record?.SupervisorEmail ?? "");
  const gmEmail = String(finding.record?.GmEmail ?? "");
  const { full: teamMemberFull, first: teamMemberFirst } = parseVoName(String(finding.record?.VoName ?? ""), agentEmail);
  const findingId = finding.id ?? "";
  const recordId = String(finding.record?.RecordId ?? "");
  const isPackage = finding.recordingIdField === "GenieNumber";
  const qbTableId = isPackage ? "bttffb64u" : "bpb28qsnn";
  const crmUrl = recordId ? `https://${env.qbRealm}.quickbase.com/db/${qbTableId}?a=dr&rid=${recordId}` : "";
  const scoreVal = score ?? (Array.isArray(finding.answeredQuestions)
    ? Math.round(finding.answeredQuestions.filter((q: any) => q.answer === "Yes").length / finding.answeredQuestions.length * 100)
    : 0);
  const scoreVerbiage = scoreVal === 100 ? "Perfect score — great call! Review your audit below."
    : scoreVal >= 80 ? "Strong performance overall. Check the missed questions below."
    : scoreVal >= 60 ? "A few areas to work on. Review your missed questions below."
    : "There's room to improve here. Take a look at what was missed.";
  const allQs = Array.isArray(finding.answeredQuestions) ? finding.answeredQuestions : [];
  const missedQs = allQs.filter((q: any) => q.answer === "No");
  const scoreColor = scoreVal === 100 ? "#3fb950" : scoreVal >= 80 ? "#58a6ff" : scoreVal >= 60 ? "#d29922" : "#f85149";
  const passedOrFailed = scoreVal === 100 ? "Passed" : "Failed";
  const isInvalidGenie = (finding.rawTranscript ?? "").includes("Invalid Genie") || (finding.rawTranscript ?? "").includes("Genie Invalid");
  const missedQuestionsRows = missedQs.length
    ? missedQs.map((q: any, i: number) =>
        `<tr><td style="padding:8px 12px;border-bottom:1px solid #21262d;color:#8b949e;font-size:12px;width:32px;text-align:center;">${i + 1}</td><td style="padding:8px 12px;border-bottom:1px solid #21262d;color:#e6edf3;font-size:13px;">${q.header ?? q.question ?? "Unknown"}</td></tr>`
      ).join("")
    : `<tr><td colspan="2" style="padding:8px 12px;color:#6e7681;font-size:13px;font-style:italic;">No missed questions — perfect score!</td></tr>`;
  const missedQuestionsHtml = missedQuestionsRows;
  const notesSection = isInvalidGenie
    ? `<div style="background:#161b22;border:1px solid #30363d;border-left:3px solid #f85149;border-radius:8px;padding:18px 20px;"><p style="margin:0 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#f85149;">Recording Invalid</p><p style="margin:0;font-size:14px;color:#c9d1d9;line-height:1.6;">Your Genie recording could not be located. <a href="${env.selfUrl}/audit/report?id=${finding.id ?? ""}" style="color:#58a6ff;text-decoration:none;">Click here to view your report and submit a new recording →</a></p></div>`
    : missedQs.length === 0
      ? `<div style="background:#161b22;border:1px solid #2ea043;border-radius:8px;padding:18px 20px;text-align:center;"><p style="margin:0;font-size:15px;font-weight:600;color:#3fb950;">Perfect score — great call!</p><p style="margin:6px 0 0;font-size:13px;color:#8b949e;">Review your audit below to see what you did right.</p></div>`
      : `<p style="margin:0 0 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#8b949e;">Missed Questions</p><table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #21262d;border-radius:8px;overflow:hidden;"><tr style="background:#161b22;"><td style="padding:8px 14px;font-size:11px;font-weight:700;color:#8b949e;width:32px;">#</td><td style="padding:8px 14px;font-size:11px;font-weight:700;color:#8b949e;">Category</td></tr>${missedQuestionsRows}</table>`;

  // Package vs date-leg dynamic vars — single template supports both
  const auditTypeLabel = isPackage ? "package verification" : "date leg";
  const guestNameVal = String(finding.record?.GuestName ?? "");
  const greeting = isPackage ? "Hi," : `Hi ${teamMemberFirst},`;
  const guestContext = (!isPackage && guestNameVal)
    ? ` for <strong style="color:#c9d1d9;">${guestNameVal}</strong>`
    : "";
  const supportTeamName = isPackage ? "AI Team" : "Excellence Audit Team";
  const recordTypeLabel = isPackage ? "Package ID" : "Date Leg ID";
  const urgentNote = isPackage
    ? ""
    : `For urgent issues, include your <em>${recordTypeLabel}</em> in the subject so we can find it fast.`;

  const vars: Record<string, string> = {
    agentName: teamMemberFull,
    agentEmail: voEmail || agentEmail,
    teamMember: teamMemberFull,
    teamMemberFirst,
    supervisorEmail,
    score: scoreVal + "%",
    scoreVerbiage,
    scoreColor,
    passedOrFailed,
    notesSection,
    findingId,
    recordId,
    guestName: guestNameVal,
    // Unique subject identifier: guest name for date legs, record ID for packages (or when name missing)
    subjectGuest: guestNameVal || (isPackage ? `Package #${recordId}` : `#${recordId}`),
    // Dynamic per audit type
    greeting,
    auditTypeLabel,
    guestContext,
    supportTeamName,
    recordTypeLabel,
    urgentNote,
    reportUrl: `${env.selfUrl}/audit/report?id=${findingId}`,
    recordingUrl: `${env.selfUrl}/audit/recording?id=${findingId}`,
    appealUrl: `${env.selfUrl}/audit/appeal?findingId=${findingId}`,
    feedbackText: finding.feedback?.text ?? "",
    missedQuestions: missedQuestionsHtml,
    missedCount: String(missedQs.length),
    passedCount: String(allQs.length - missedQs.length),
    totalQuestions: String(allQs.length),
    crmUrl,
    managerNotesDisplay: missedQs.length === 0 ? "display:none" : "",
    logoUrl: `${env.selfUrl}/logo.png`,
    selfUrl: env.selfUrl,
  };

  const resolvedTest = testOverrideTo || webhookCfg?.testEmail || "";
  // Packages: send to office GM. Date legs: send to VO/agent. Test override always wins.
  const to = resolvedTest || (isPackage ? gmEmail : (voEmail || agentEmail));
  console.log(`[EMAIL] audit-complete: to=${to} isPackage=${isPackage} cc=${supervisorEmail || "none"} bcc=${webhookCfg?.bcc || "none"} score=${scoreVal}% finding=${findingId}`);
  if (!to) return json({ error: "no recipient email" }, 400);
  const cc = resolvedTest ? undefined : (supervisorEmail || undefined);
  const bcc = resolvedTest ? undefined : (webhookCfg?.bcc || undefined);

  try {
    await sendEmail({ to, subject: renderTemplate(template.subject, vars), htmlBody: renderTemplate(template.html, vars), cc, bcc });
    console.log(`[EMAIL] ✅ Audit complete sent → ${to}${cc ? ` cc:${cc}` : ""}${bcc ? ` bcc:${bcc}` : ""} (finding: ${findingId})`);
  } catch (err) {
    console.error(`[EMAIL] ❌ Audit complete send failed (finding: ${findingId}):`, err);
    return json({ error: "email send failed" }, 500);
  }
  return json({ ok: true, to });
}

// -- Webhooks: Appeal Filed Email --

async function handleAppealFiledWebhook(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const orgId = url.searchParams.get("org") as OrgId;
  if (!orgId) return json({ error: "org required" }, 400);

  const webhookCfg = await getWebhookConfig(orgId, "appeal").catch(() => null);
  const body = await req.json();
  const { finding, findingId: fid, comment } = body;
  const findingId = fid ?? finding?.id ?? "";
  if (!findingId) return json({ error: "findingId required" }, 400);

  const template = await resolveWebhookTemplate(orgId, webhookCfg);
  if (!template) return json({ ok: true, skipped: "no template configured" });

  const agentEmail = String(finding?.owner ?? "");
  const voEmail = String(finding?.record?.VoEmail ?? "");
  const gmEmail = String(finding?.record?.GmEmail ?? "");
  const isPackage = finding?.recordingIdField === "GenieNumber";
  const recipientEmail = isPackage ? gmEmail : (voEmail || agentEmail);
  const { full: agentName } = parseVoName(String(finding?.record?.VoName ?? ""), recipientEmail);

  const vars: Record<string, string> = {
    findingId,
    agentName,
    agentEmail: recipientEmail,
    gmEmail,
    recordId: String(finding?.record?.RecordId ?? ""),
    guestName: String(finding?.record?.GuestName ?? ""),
    reportUrl: `${env.selfUrl}/audit/report?id=${findingId}`,
    judgeUrl: `${env.selfUrl}/judge`,
    comment: comment ?? "",
    appealedAt: new Date().toLocaleString("en-US", { timeZone: "America/New_York" }) + " EST",
    logoUrl: `${env.selfUrl}/logo.png`,
    selfUrl: env.selfUrl,
  };

  const resolvedTest = webhookCfg?.testEmail || "";
  // Appeal-filed is a staff notification — BCC list serves as primary recipients
  const bccList = webhookCfg?.bcc || "";
  const to = resolvedTest || bccList.split(",")[0]?.trim() || "";
  if (!to) return json({ error: "no recipient configured — set BCC in Appeal webhook settings" }, 400);
  const bcc = resolvedTest ? undefined : (bccList.split(",").slice(1).join(",").trim() || undefined);

  await sendEmail({ to, subject: renderTemplate(template.subject, vars), htmlBody: renderTemplate(template.html, vars), bcc });
  console.log(`[EMAIL] Appeal filed → ${to} (finding: ${findingId})`);
  return json({ ok: true, to });
}

// -- Webhooks: Appeal Decided Email --

async function handleAppealDecidedWebhook(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const orgId = url.searchParams.get("org") as OrgId;
  if (!orgId) return json({ error: "org required" }, 400);

  const webhookCfg = await getWebhookConfig(orgId, "judge").catch(() => null);
  const body = await req.json();
  const { finding, findingId: fid, originalScore, finalScore, overturns, totalQuestions, judgedBy } = body;
  const findingId = fid ?? finding?.id ?? "";
  if (!findingId) return json({ error: "findingId required" }, 400);

  const template = await resolveWebhookTemplate(orgId, webhookCfg);
  if (!template) return json({ ok: true, skipped: "no template configured" });

  const agentEmail = String(finding?.owner ?? "");
  const voEmail = String(finding?.record?.VoEmail ?? "");
  const gmEmail = String(finding?.record?.GmEmail ?? "");
  const supervisorEmail = String(finding?.record?.SupervisorEmail ?? "");
  const isPackage = finding?.recordingIdField === "GenieNumber";
  const recipientEmail = isPackage ? gmEmail : (voEmail || agentEmail);
  const { full: agentName, first: teamMemberFirst } = parseVoName(String(finding?.record?.VoName ?? ""), recipientEmail);

  const vars: Record<string, string> = {
    findingId,
    agentName,
    agentEmail: recipientEmail,
    gmEmail,
    teamMemberFirst,
    recordId: String(finding?.record?.RecordId ?? ""),
    guestName: String(finding?.record?.GuestName ?? ""),
    supervisorEmail,
    originalScore: (originalScore ?? 0) + "%",
    finalScore: (finalScore ?? 0) + "%",
    overturns: String(overturns ?? 0),
    totalQuestions: String(totalQuestions ?? 0),
    judgedBy: judgedBy ?? "",
    reportUrl: `${env.selfUrl}/audit/report?id=${findingId}`,
    logoUrl: `${env.selfUrl}/logo.png`,
    selfUrl: env.selfUrl,
  };

  const resolvedTest = webhookCfg?.testEmail || "";
  const to = resolvedTest || recipientEmail;
  if (!to) return json({ error: "no recipient email" }, 400);
  const cc = resolvedTest ? undefined : (supervisorEmail || undefined);
  const bcc = resolvedTest ? undefined : (webhookCfg?.bcc || undefined);

  await sendEmail({ to, subject: renderTemplate(template.subject, vars), htmlBody: renderTemplate(template.html, vars), cc, bcc });
  console.log(`[EMAIL] Appeal decided → ${to}${cc ? ` cc:${cc}` : ""}${bcc ? ` bcc:${bcc}` : ""} (finding: ${findingId})`);
  return json({ ok: true, to });
}

// -- Webhooks: Manager Review Email --

async function handleManagerReviewWebhook(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const orgId = url.searchParams.get("org") as OrgId;
  if (!orgId) return json({ error: "org required" }, 400);

  const webhookCfg = await getWebhookConfig(orgId, "manager").catch(() => null);
  const body = await req.json();
  const { finding, findingId: fid, remediation } = body;
  const findingId = fid ?? finding?.id ?? "";
  if (!findingId) return json({ error: "findingId required" }, 400);

  const template = await resolveWebhookTemplate(orgId, webhookCfg);
  if (!template) return json({ ok: true, skipped: "no template configured" });

  const agentEmail = String(finding?.owner ?? "");
  const voEmail = String(finding?.record?.VoEmail ?? "");
  const gmEmail = String(finding?.record?.GmEmail ?? "");
  const supervisorEmail = String(finding?.record?.SupervisorEmail ?? "");
  const isPackage = finding?.recordingIdField === "GenieNumber";
  const recipientEmail = isPackage ? gmEmail : (voEmail || agentEmail);
  const { full: agentName, first: teamMemberFirst } = parseVoName(String(finding?.record?.VoName ?? ""), recipientEmail);

  const vars: Record<string, string> = {
    findingId,
    agentName,
    agentEmail: recipientEmail,
    gmEmail,
    teamMemberFirst,
    recordId: String(finding?.record?.RecordId ?? ""),
    guestName: String(finding?.record?.GuestName ?? ""),
    supervisorEmail,
    managerNotes: remediation?.notes ?? "",
    addressedBy: remediation?.addressedBy ?? "",
    reportUrl: `${env.selfUrl}/audit/report?id=${findingId}`,
    logoUrl: `${env.selfUrl}/logo.png`,
    selfUrl: env.selfUrl,
  };

  const resolvedTest = webhookCfg?.testEmail || "";
  const to = resolvedTest || recipientEmail;
  if (!to) return json({ error: "no recipient email" }, 400);
  const cc = resolvedTest ? undefined : (supervisorEmail || undefined);
  const bcc = resolvedTest ? undefined : (webhookCfg?.bcc || undefined);

  await sendEmail({ to, subject: renderTemplate(template.subject, vars), htmlBody: renderTemplate(template.html, vars), cc, bcc });
  console.log(`[EMAIL] Manager review → ${to}${cc ? ` cc:${cc}` : ""}${bcc ? ` bcc:${bcc}` : ""} (finding: ${findingId})`);
  return json({ ok: true, to });
}

// -- Audit: Report SSE --

async function handleReportSSE(orgId: OrgId, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return json({ error: "id required" }, 400);

  console.log(`[SSE] 🔍 report-sse: org=${orgId} finding=${id}`);

  const isYesAnswer = (a: string) => {
    const s = String(a ?? "").trim().toLowerCase();
    return s.startsWith("yes") || s === "true" || s === "y" || s === "1";
  };

  let closed = false;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const enq = (chunk: string) => {
        if (!closed) controller.enqueue(encoder.encode(chunk));
      };

      const sendEvent = (event: string, data: unknown) => {
        enq(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const keepalive = () => enq(`: keepalive\n\n`);

      const poll = async () => {
        if (closed) return;
        try {
          const f = await getFinding(orgId, id);
          if (!f) {
            console.warn(`[SSE] ⚠️ report-sse: finding ${id} not found, closing`);
            closed = true;
            controller.close();
            return;
          }

          const questions: any[] = f.answeredQuestions ?? [];
          const yesCount = questions.filter((q: any) => isYesAnswer(q.answer)).length;
          const noCount = questions.filter((q: any) => !isYesAnswer(q.answer)).length;
          const total = questions.length;
          const score = total > 0 ? Math.round((yesCount / total) * 100) : 0;
          const status = f.findingStatus ?? "pending";

          sendEvent("update", { score, passed: yesCount, failed: noCount, total, status });

          if (status === "finished" || status === "terminated") {
            console.log(`[SSE] ✅ report-sse: finding ${id} complete (status=${status} score=${score}%)`);
            sendEvent("complete", { status });
            closed = true;
            controller.close();
            return;
          }

          setTimeout(poll, 2000);
        } catch (err) {
          console.error(`[SSE] ❌ report-sse poll error (finding=${id}):`, err);
          // Keep polling on transient errors
          setTimeout(poll, 3000);
        }
      };

      const keepaliveTimer = setInterval(keepalive, 15_000);

      req.signal.addEventListener("abort", () => {
        console.log(`[SSE] report-sse: client disconnected (finding=${id})`);
        closed = true;
        clearInterval(keepaliveTimer);
        try { controller.close(); } catch { /* already closed */ }
      });

      // Initial poll after short delay
      setTimeout(poll, 1500);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

// -- Audit: Send Re-Audit Receipt Email --

async function handleSendReauditReceipt(orgId: OrgId, req: Request): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const { findingId, bccOnly = false } = body;
  if (!findingId) return json({ error: "findingId required" }, 400);

  console.log(`[EMAIL] 🔍 re-audit-receipt: org=${orgId} finding=${findingId} bccOnly=${bccOnly}`);

  const webhookCfg = await getWebhookConfig(orgId, "re-audit-receipt").catch((err) => {
    console.error(`[EMAIL] re-audit-receipt: getWebhookConfig failed:`, err);
    return null;
  });
  console.log(`[EMAIL] re-audit-receipt: emailTemplateId=${webhookCfg?.emailTemplateId ?? "NONE"} testEmail=${webhookCfg?.testEmail ?? ""} bcc=${webhookCfg?.bcc ?? ""}`);

  // BCC-only path (agent opted out) — skip entirely if no BCC configured
  if (bccOnly && !webhookCfg?.bcc) {
    console.log(`[EMAIL] re-audit-receipt: ⚠️ bccOnly but no BCC configured — skipped`);
    return json({ ok: true, skipped: "bcc-only but no bcc configured" });
  }

  const template = await resolveWebhookTemplate(orgId, webhookCfg);
  if (!template) {
    console.log(`[EMAIL] re-audit-receipt: ⚠️ skipped — no template configured`);
    return json({ ok: true, skipped: "no template configured" });
  }

  const finding = await getFinding(orgId, findingId);
  if (!finding) return json({ error: "finding not found" }, 404);

  const agentEmail = String((finding as any).owner ?? "");
  const voEmail = String((finding.record as any)?.VoEmail ?? "");
  const gmEmail = String((finding.record as any)?.GmEmail ?? "");
  const isPackage = (finding as any).recordingIdField === "GenieNumber";
  const recipientEmail = isPackage ? gmEmail : (voEmail || (agentEmail !== "api" ? agentEmail : ""));
  const { full: teamMemberFull, first: teamMemberFirst } = parseVoName(String((finding.record as any)?.VoName ?? ""), recipientEmail);
  const recordId = String((finding.record as any)?.RecordId ?? "");

  // Appeal type details
  const appealType = String((finding as any).appealType ?? "");
  const appealTypeLabel = appealType === "additional-recording" ? "Additional Recording"
    : appealType === "different-recording" ? "Replacement Recording"
    : appealType === "upload-recording" ? "Uploaded Recording"
    : "Re-Audit";
  const newGenieIds = Array.isArray((finding as any).genieIds)
    ? (finding as any).genieIds.join(", ")
    : String((finding as any).recordingId ?? "");
  const originalFindingId = String((finding as any).appealSourceFindingId ?? "");
  const originalFinding = originalFindingId ? await getFinding(orgId, originalFindingId).catch(() => null) : null;
  const originalGenieId = originalFinding
    ? (Array.isArray((originalFinding as any).genieIds)
        ? (originalFinding as any).genieIds.join(", ")
        : String((originalFinding as any).recordingId ?? ""))
    : "";

  const vars: Record<string, string> = {
    agentName: teamMemberFull,
    agentEmail: recipientEmail,
    gmEmail,
    teamMember: teamMemberFull,
    teamMemberFirst,
    findingId,
    recordId,
    guestName: String((finding.record as any)?.GuestName ?? ""),
    reportUrl: `${env.selfUrl}/audit/report?id=${findingId}`,
    originalReportUrl: originalFindingId ? `${env.selfUrl}/audit/report?id=${originalFindingId}` : "",
    recordingUrl: `${env.selfUrl}/audit/recording?id=${findingId}`,
    appealType,
    appealTypeLabel,
    newGenieIds,
    originalGenieId,
    originalFindingId,
    logoUrl: `${env.selfUrl}/logo.png`,
    selfUrl: env.selfUrl,
    submittedAt: new Date().toLocaleString("en-US", { timeZone: "America/New_York" }) + " EST",
  };

  // Resolve recipients — bccOnly: send to BCC address directly, skip agent
  const agentRecipient = recipientEmail;
  const { to: resolvedTo, bcc } = resolveRecipients(webhookCfg, agentRecipient);
  const to = bccOnly ? (webhookCfg?.bcc || "") : resolvedTo;

  console.log(`[EMAIL] re-audit-receipt: to=${to || "(none)"} bcc=${bcc || "none"} bccOnly=${bccOnly} finding=${findingId}`);
  if (!to) return json({ ok: true, skipped: "no recipient" });

  // When bccOnly, don't also re-send to the BCC (it IS the recipient now)
  const emailBcc = bccOnly ? undefined : bcc;

  try {
    await sendEmail({ to, subject: renderTemplate(template.subject, vars), htmlBody: renderTemplate(template.html, vars), bcc: emailBcc });
    console.log(`[EMAIL] ✅ Re-audit receipt sent → ${to}${emailBcc ? ` bcc:${emailBcc}` : ""}${bccOnly ? " (bcc-only)" : ""} (finding: ${findingId})`);
  } catch (err) {
    console.error(`[EMAIL] ❌ Re-audit receipt send failed (finding: ${findingId}):`, err);
    return json({ error: "email send failed" }, 500);
  }
  return json({ ok: true, to });
}

// -- Admin: Token Usage --

async function handleTokenUsage(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const hours = Number(url.searchParams.get("hours") ?? "1");
  const usage = await getTokenUsage(hours);
  return json(usage);
}

// -- Admin: Force Nos (testing) --

async function handleForceNos(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  const url = new URL(req.url);
  const findingId = url.searchParams.get("id");
  if (!findingId) return json({ error: "id required" }, 400);

  const { getFinding: getF } = await import("./lib/kv.ts");
  const finding = await getF(auth.orgId, findingId);
  if (!finding) return json({ error: "finding not found" }, 404);
  if (!finding.answeredQuestions?.length) return json({ error: "no answered questions yet" }, 400);

  let flipped = 0;
  for (const q of finding.answeredQuestions) {
    if (q.answer === "Yes") {
      q.answer = "No";
      q.thinking = "[FORCED NO FOR TESTING] " + (q.thinking || "");
      flipped++;
    }
  }
  await saveFinding(auth.orgId, finding);
  await populateReviewQueue(auth.orgId, findingId, finding.answeredQuestions);

  return json({ ok: true, flipped, totalNos: finding.answeredQuestions.filter((q: any) => q.answer === "No").length });
}

// -- Admin: Retry Finding --

async function handleRetryFinding(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  const url = new URL(req.url);
  const findingId = url.searchParams.get("id");
  if (!findingId) return json({ error: "id required" }, 400);

  const { getFinding: getF } = await import("./lib/kv.ts");
  const finding = await getF(auth.orgId, findingId);

  if (!finding) {
    // Finding not yet in KV — still initializing, publish directly to bypass queue backlog
    await publishStep("init", { findingId, orgId: auth.orgId });
    console.log(`[RETRY-FINDING] Admin ${auth.email} published init (not found) for ${findingId}`);
    return json({ ok: true, findingId, step: "init" });
  }
  if (finding.findingStatus === "finished") return json({ error: "already finished" }, 400);

  // Un-terminate so the step doesn't bail out immediately
  if (finding.findingStatus === "terminated") {
    finding.findingStatus = "active";
    await saveFinding(auth.orgId, finding);
  }

  // Pick the right step based on how far it got
  let step = "finalize";
  if (!finding.s3RecordingKey && !finding.s3RecordingKeys?.length) {
    step = "init";
  } else if (!finding.rawTranscript) {
    step = "transcribe";
  } else if (!finding.answeredQuestions?.length) {
    step = "prepare";
  }

  // Reset the active entry server-side: fresh ts, updated step, record metadata
  const qbRecordId = String(finding.record?.RecordId ?? "");
  await trackActive(auth.orgId, findingId, step, {
    recordId: qbRecordId || undefined,
    isPackage: finding.recordingIdField === "GenieNumber",
  });

  const body: Record<string, unknown> = { findingId, orgId: auth.orgId, adminRetry: true };
  if (step === "finalize") body.totalBatches = finding.totalBatches ?? 0;

  // Publish directly (bypass queue backlog) so the retry runs immediately
  await publishStep(step, body);
  console.log(`[RETRY-FINDING] Admin ${auth.email} published ${step} for ${findingId}`);
  return json({ ok: true, findingId, step });
}

// -- Admin: Terminate Running Active Audits --

async function handleTerminateAll(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  const terminated = await terminateAllActive(auth.orgId);
  console.log(`[ADMIN] ${auth.email} terminated ${terminated} active audits`);
  return json({ ok: true, terminated });
}

// -- Admin: Terminate Single Finding --

async function handleTerminateFinding(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return json({ error: "id required" }, 400);

  await terminateFinding(auth.orgId, id);
  console.log(`[ADMIN] ${auth.email} terminated finding ${id}`);
  return json({ ok: true });
}

// -- Admin: Clear Waiting Queue (QStash only) --

async function handleClearQueue(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  const purged = await purgeAllQueues();
  await pauseAllQueues();
  console.log(`[ADMIN] ${auth.email} purged ${purged} queued messages, paused all queues`);
  return json({ ok: true, purged });
}

async function handleClearErrors(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  const cleared = await clearErrors(auth.orgId);
  console.log(`[ADMIN] ${auth.email} cleared ${cleared} errors`);
  return json({ ok: true, cleared });
}

// -- Admin: Pause / Resume Queues --

async function handlePauseQueues(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;
  await pauseAllQueues();
  console.log(`[ADMIN] ${auth.email} paused all queues`);
  return json({ ok: true });
}

async function handleResumeQueues(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  await resumeAllQueues();
  console.log(`[ADMIN] ${auth.email} resumed all queues`);
  return json({ ok: true });
}

// -- Admin: Clear Review Queue --

async function handleClearReviewQueue(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  const { cleared } = await clearReviewQueue(auth.orgId);
  console.log(`[ADMIN] ${auth.email} cleared review queue (${cleared} KV entries deleted)`);
  return json({ ok: true, cleared });
}

// -- Admin: Dump State --

async function handleDumpState(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  const body = await req.json().catch(() => ({})) as { cursor?: Deno.KvKeyPart[]; limit?: number };
  const PAGE = body.limit ?? 500;

  const db = await Deno.openKv(Deno.env.get("KV_URL") ?? undefined);
  const selector: Deno.KvListSelector = body.cursor
    ? { prefix: [auth.orgId], start: body.cursor as Deno.KvKey }
    : { prefix: [auth.orgId] };

  const entries: Array<{ key: Deno.KvKeyPart[]; value: unknown }> = [];
  let lastKey: Deno.KvKeyPart[] | null = null;

  const iter = db.list(selector, { limit: PAGE });
  for await (const entry of iter) {
    entries.push({ key: entry.key as Deno.KvKeyPart[], value: entry.value });
    lastKey = entry.key as Deno.KvKeyPart[];
  }

  const done = entries.length < PAGE;
  console.log(`[ADMIN] dump-state: ${entries.length} entries, done=${done}`);

  return json({ orgId: auth.orgId, entries, cursor: done ? null : lastKey, done });
}

// -- Admin: Import State (direct entries) --

async function handleImportState(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  const body = await req.json();
  const { entries, orgId: sourceOrgId } = body as {
    entries: Array<{ key: Deno.KvKeyPart[]; value: unknown }>;
    orgId?: string;
  };

  if (!entries || !Array.isArray(entries)) {
    return json({ error: "entries array required" }, 400);
  }

  const db = await Deno.openKv(Deno.env.get("KV_URL") ?? undefined);
  const targetOrgId = auth.orgId;

  // Nuke ALL existing state for this org
  let cleared = 0;
  const nukeIter = db.list({ prefix: [targetOrgId] });
  for await (const entry of nukeIter) {
    await db.delete(entry.key);
    cleared++;
  }

  // Write imported entries, remapping orgId if source differs from target
  let written = 0;
  const BATCH = 10;
  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    const atomic = db.atomic();
    for (const entry of batch) {
      let key = entry.key;
      // Remap orgId: replace source orgId prefix with target orgId
      if (sourceOrgId && key[0] === sourceOrgId && sourceOrgId !== targetOrgId) {
        key = [targetOrgId, ...key.slice(1)];
      }
      atomic.set(key as Deno.KvKey, entry.value);
      written++;
    }
    await atomic.commit();
  }

  console.log(`[ADMIN] ${auth.email} imported state: cleared ${cleared}, wrote ${written} entries (source org: ${sourceOrgId ?? "same"})`);
  return json({ ok: true, cleared, written });
}

// -- Admin: Pull State (paginated fetch from remote dump-state, import locally) --

async function handlePullState(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  const body = await req.json();
  const { sourceUrl, cookie } = body as {
    sourceUrl: string;   // e.g. "https://autobottom.thetechgoose.deno.net"
    cookie: string;      // session cookie value from the source server
  };

  if (!sourceUrl || !cookie) {
    return json({ error: "sourceUrl and cookie required" }, 400);
  }

  const db = await Deno.openKv(Deno.env.get("KV_URL") ?? undefined);
  const targetOrgId = auth.orgId;

  // Nuke local state first
  let cleared = 0;
  const nukeIter = db.list({ prefix: [targetOrgId] });
  for await (const entry of nukeIter) {
    await db.delete(entry.key);
    cleared++;
  }
  console.log(`[ADMIN] pull-state: cleared ${cleared} local entries`);

  // Paginated fetch from remote dump-state
  let cursor: unknown = undefined;
  let written = 0;
  let pages = 0;
  let sourceOrgId: string | null = null;

  while (true) {
    const fetchBody: Record<string, unknown> = { limit: 500 };
    if (cursor) fetchBody.cursor = cursor;

    console.log(`[ADMIN] pull-state: fetching page ${pages}...`);
    const res = await fetch(`${sourceUrl}/admin/dump-state`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cookie": `session=${cookie}` },
      body: JSON.stringify(fetchBody),
    });

    if (!res.ok) {
      const errText = await res.text();
      return json({ error: `Failed to fetch page ${pages}: ${res.status} ${errText}`, written, pages }, 502);
    }

    const data = await res.json() as {
      orgId: string;
      entries: Array<{ key: Deno.KvKeyPart[]; value: unknown }>;
      cursor: unknown;
      done: boolean;
    };

    if (!sourceOrgId) sourceOrgId = data.orgId;

    // Write entries, remapping orgId
    const BATCH = 10;
    for (let i = 0; i < data.entries.length; i += BATCH) {
      const batch = data.entries.slice(i, i + BATCH);
      const atomic = db.atomic();
      for (const entry of batch) {
        let key = entry.key;
        if (sourceOrgId && key[0] === sourceOrgId && sourceOrgId !== targetOrgId) {
          key = [targetOrgId, ...key.slice(1)];
        }
        atomic.set(key as Deno.KvKey, entry.value);
        written++;
      }
      await atomic.commit();
    }

    pages++;
    console.log(`[ADMIN] pull-state: page ${pages} done (${data.entries.length} entries)`);

    if (data.done) break;
    cursor = data.cursor;
  }

  console.log(`[ADMIN] ${auth.email} pull-state complete: cleared ${cleared}, wrote ${written} entries in ${pages} pages`);
  return json({ ok: true, cleared, written, pages, sourceOrgId });
}

// -- Admin: Init Org --

async function handleInitOrg(req: Request): Promise<Response> {
  const body = await req.json();
  const { name, email, password } = body;
  if (!name) return json({ error: "name required" }, 400);
  const db = await Deno.openKv(Deno.env.get("KV_URL") ?? undefined);
  const existingDefault = await db.get<string>(["default-org"]);
  const orgId = existingDefault.value ?? await createOrg(name, name);
  await db.set(["default-org"], orgId);
  if (email && password) {
    try { await createUser(orgId, email, password, "admin"); } catch { /* already exists */ }
  }
  const seededTemplates = await seedDefaultEmailTemplates(orgId);
  return json({ ok: true, orgId, name, seededTemplates });
}

// -- Admin: Seed --

async function loadSeedData(): Promise<any[]> {
  const seedPath = new URL("./seed-data.json", import.meta.url);
  const raw = await Deno.readTextFile(seedPath);
  return JSON.parse(raw);
}

async function handleSeedDryRun(_req: Request): Promise<Response> {
  const findings = await loadSeedData();
  const summary = findings.map((f: any) => ({
    id: f.id,
    recordingId: f.recordingId,
    answerCount: f.answeredQuestions?.length ?? 0,
    noCount: (f.answeredQuestions ?? []).filter((q: any) => q.answer === "No").length,
  }));
  return json({ dryRun: true, count: findings.length, findings: summary });
}

async function seedOrgData(orgId: OrgId): Promise<{ seeded: number; managerSeeded: number; judgeSeeded: number; qlabSeeded: number; orgId: OrgId }> {
  const findings = await loadSeedData();
  const db = await Deno.openKv(Deno.env.get("KV_URL") ?? undefined);

  // Create admin user (ignore if already exists)
  try { await createUser(orgId, "admin@autobot.dev", "admin", "admin"); } catch { /* exists */ }

  // Seed test team (password: 0000) with proper supervisor hierarchy:
  //   admin@monsterrg.com (admin)
  //     ├── judge@monsterrg.com (judge)       supervised by admin
  //     ├── manager@monsterrg.com (manager)   supervised by admin
  //     ├── reviewer@monsterrg.com (reviewer)  supervised by judge
  //     ├── reviewer2@monsterrg.com (reviewer) supervised by judge
  //     └── agent@monsterrg.com (user)         supervised by manager
  const testUsers: Array<[string, string, string | undefined]> = [
    ["admin@monsterrg.com", "admin", undefined],
    ["judge@monsterrg.com", "judge", "admin@monsterrg.com"],
    ["manager@monsterrg.com", "manager", "admin@monsterrg.com"],
    ["reviewer@monsterrg.com", "reviewer", "judge@monsterrg.com"],
    ["reviewer2@monsterrg.com", "reviewer", "judge@monsterrg.com"],
    ["agent@monsterrg.com", "user", "manager@monsterrg.com"],
  ];
  // Super-admin user (password: dooks) - gates /super-admin access
  const saStale = await db.get(["email-index", "ai@monsterrg.com"]);
  if (saStale.value) {
    const saOrgId = (saStale.value as any).orgId;
    await db.delete([saOrgId, "user", "ai@monsterrg.com"]);
    await db.delete(["email-index", "ai@monsterrg.com"]);
  }
  await createUser(orgId, "ai@monsterrg.com", "dooks", "admin");
  console.log("[SEED] Created ai@monsterrg.com (super-admin)");

  for (const [email, role, supervisor] of testUsers) {
    const staleIndex = await db.get(["email-index", email]);
    if (staleIndex.value) {
      const staleOrgId = (staleIndex.value as any).orgId;
      await db.delete([staleOrgId, "user", email]);
      await db.delete(["email-index", email]);
    }
    await createUser(orgId, email, "0000", role as any, supervisor);
    console.log(`[SEED] Created ${email} (${role}${supervisor ? `, reports to ${supervisor}` : ""})`);
  }

  // Clean up legacy orphan users from previous seed format
  const teamEmails = new Set(testUsers.map(([e]) => e));
  teamEmails.add("admin@autobot.dev");
  const allUsers = await listUsers(orgId);
  for (const u of allUsers) {
    if (!teamEmails.has(u.email)) {
      await deleteUser(orgId, u.email);
      console.log(`[SEED] Removed orphan user: ${u.email}`);
    }
  }

  const { populateManagerQueue, submitRemediation } = await import("./manager/kv.ts");
  let seeded = 0;

  for (const finding of findings) {
    finding.recordingPath = "test-recordings/demo-recording.mp3";

    await saveFinding(orgId, finding);

    if (finding.rawTranscript) {
      await saveTranscript(orgId, finding.id, finding.rawTranscript, finding.diarizedTranscript);
    }

    if (finding.answeredQuestions?.length) {
      await saveBatchAnswers(orgId, finding.id, 0, finding.answeredQuestions);
    }

    if (finding.answeredQuestions?.length) {
      await populateReviewQueue(orgId, finding.id, finding.answeredQuestions);
    }

    await trackCompleted(orgId, finding.id);

    seeded++;
    console.log(`[SEED] ${seeded}/${findings.length} -- ${finding.id}`);
  }

  // -- Manager seed --
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const reviewers = ["reviewer@monsterrg.com", "reviewer2@monsterrg.com"];
  let managerSeeded = 0;

  for (let i = 0; i < Math.min(12, findings.length); i++) {
    const finding = findings[i];
    const noQuestions = (finding.answeredQuestions ?? [])
      .map((q: any, idx: number) => ({ ...q, idx }))
      .filter((q: any) => q.answer === "No");

    if (noQuestions.length === 0) continue;

    // Clear review-pending entries (simulate reviewer completing them)
    for (const q of noQuestions) {
      await db.delete(orgKey(orgId, "review-pending", finding.id, q.idx));
    }
    await db.delete(orgKey(orgId, "review-audit-pending", finding.id));

    // Write review-decided entries
    const reviewer = reviewers[i % reviewers.length];
    const completedAt = now - Math.floor(Math.random() * 8 * WEEK_MS);
    for (const q of noQuestions) {
      const decision = Math.random() < 0.75 ? "confirm" : "flip";
      await db.set(orgKey(orgId, "review-decided", finding.id, q.idx), {
        findingId: finding.id,
        questionIndex: q.idx,
        header: q.header ?? "",
        populated: q.populated ?? "",
        thinking: q.thinking ?? "",
        defense: q.defense ?? "",
        answer: q.answer,
        decision,
        reviewer,
        decidedAt: completedAt,
      });
    }

    await populateManagerQueue(orgId, finding.id);

    // Override completedAt to spread across weeks for trend data
    const queueEntry = await db.get(orgKey(orgId, "manager-queue", finding.id));
    if (queueEntry.value) {
      const updated = { ...(queueEntry.value as Record<string, any>), completedAt };
      await db.set(orgKey(orgId, "manager-queue", finding.id), updated);
    }

    // Remediate ~half
    if (i < 6) {
      const remediatedAt = completedAt + Math.floor(Math.random() * 3 * DAY_MS);
      await submitRemediation(
        orgId,
        finding.id,
        [
          "Spoke with agent about proper greeting protocol. Agent acknowledged the gap and will follow the script going forward.",
          "Coached agent on verification steps. Reviewed call together and identified where they skipped the ID check. Written warning issued.",
          "Agent was already aware of the issue. Discussed alternative phrasing for disclosure requirements. No further action needed.",
          "Scheduled 1-on-1 coaching session. Agent needs refresher on cancellation policy disclosure. Follow-up audit in 2 weeks.",
          "Team meeting held to address this pattern. Updated the call script to make the required step more prominent.",
          "Agent terminated after repeated failures on compliance questions. This was the third offense in 30 days.",
        ][i],
        "manager@monsterrg.com",
      );
      const remEntry = await db.get(orgKey(orgId, "manager-remediation", finding.id));
      if (remEntry.value) {
        const updated = { ...(remEntry.value as Record<string, any>), addressedAt: remediatedAt };
        await db.set(orgKey(orgId, "manager-remediation", finding.id), updated);
      }
    }

    managerSeeded++;
  }
  console.log(`[SEED] Manager queue seeded: ${managerSeeded} items`);

  // -- Judge / Appeal seed --
  // All users already created above with proper supervisor hierarchy
  const judges = ["judge@monsterrg.com"];
  const auditors = ["agent@monsterrg.com"];
  let judgeSeeded = 0;

  const appealFindings = findings.slice(2, 10);
  for (let i = 0; i < appealFindings.length; i++) {
    const finding = appealFindings[i];
    if (!finding.answeredQuestions?.length) continue;

    const auditor = auditors[i % auditors.length];
    finding.owner = auditor;
    await saveFinding(orgId, finding);

    const appealedAt = now - Math.floor(Math.random() * 6 * WEEK_MS);
    const isComplete = i < 6;

    await saveAppeal(orgId, {
      findingId: finding.id,
      appealedAt,
      status: isComplete ? "complete" : "pending",
      judgedBy: isComplete ? judges[i % judges.length] : undefined,
      auditor,
    });

    await populateJudgeQueue(orgId, finding.id, finding.answeredQuestions, undefined, finding.recordingIdField as string | undefined, finding.recordingId ? String(finding.recordingId) : undefined);

    if (isComplete) {
      const judge = judges[i % judges.length];
      for (let qi = 0; qi < finding.answeredQuestions.length; qi++) {
        const decision = Math.random() < 0.2 ? "overturn" as const : "uphold" as const;
        await recordJudgeDecision(orgId, finding.id, qi, decision, judge);
      }
    }

    judgeSeeded++;
    console.log(`[SEED] Judge appeal ${judgeSeeded}: ${finding.id} (${isComplete ? "complete" : "pending"})`);
  }
  console.log(`[SEED] Judge seeded: ${judgeSeeded} appeals`);

  // -- Question Lab seed --
  const qlabKv = await import("./question-lab/kv.ts");

  const config = await qlabKv.createConfig(orgId, "Verification Audit");

  const questionsData: Array<{
    name: string;
    text: string;
    autoYesExp: string;
    tests: Array<{ snippet: string; expected: "yes" | "no" }>;
  }> = [
    {
      name: "Guest Name",
      text: "Did the agent verify the guest's full name during the call?",
      autoYesExp: "",
      tests: [
        {
          snippet: `[AGENT]: Hi, good afternoon. Is this Ms. Jane Doe?\n[CUSTOMER]: Yes.\n[AGENT]: Awesome. This is James. I'm with Acme Travel Group.`,
          expected: "yes",
        },
        {
          snippet: `[AGENT]: Hello, I'm calling from Acme Travel Group about your upcoming booking.\n[CUSTOMER]: Okay.\n[AGENT]: Let me just pull up your details here.`,
          expected: "no",
        },
      ],
    },
    {
      name: "Age Verification",
      text: "Did the agent confirm the guest meets the minimum age requirement (28 years old)?",
      autoYesExp: "",
      tests: [
        {
          snippet: `[AGENT]: Are you at least 28 years old, Ms. Jane?\n[CUSTOMER]: Oh, God, yes.`,
          expected: "yes",
        },
        {
          snippet: `[AGENT]: So you'll both be attending the presentation during your stay.\n[CUSTOMER]: Yes, we will.`,
          expected: "no",
        },
      ],
    },
    {
      name: "Confirmation Expectations",
      text: "Did the agent explain when and how the guest will receive their confirmation (email within 48 hours or 30 days before trip)?",
      autoYesExp: "",
      tests: [
        {
          snippet: `[AGENT]: Now, last but not least, ma'am, you're going to get that confirmation email within 48 hours if you have any questions.`,
          expected: "yes",
        },
        {
          snippet: `[AGENT]: About 30 days before your trip, you receive a text and email for confirmation.`,
          expected: "yes",
        },
        {
          snippet: `[AGENT]: All right, so everything is booked. We look forward to seeing you there!\n[CUSTOMER]: Great, thank you!`,
          expected: "no",
        },
      ],
    },
    {
      name: "MCC Recurring Charges",
      text: "Did the agent disclose that the Cruise Club membership will begin recurring charges after 6 months?",
      autoYesExp: "",
      tests: [
        {
          snippet: `[AGENT]: After your six month free trial of the Cruise Club ends, you will be billed $14.99 per month unless you cancel.\n[CUSTOMER]: Okay, got it.`,
          expected: "yes",
        },
        {
          snippet: `[AGENT]: You also get a six month free membership to our cruise club as part of the White Glove service Plus, with savings on Carnival, Norwegian, and Margarita cruises.`,
          expected: "no",
        },
      ],
    },
    {
      name: "Married/Cohabiting Qualifier",
      text: "Did the agent confirm whether the guest is married or cohabiting with their significant other (not separated)?",
      autoYesExp: "",
      tests: [
        {
          snippet: `[AGENT]: Now, you and your significant other are legally married or living together. You're not separated or going through a separation. Is that correct?\n[CUSTOMER]: That's correct.`,
          expected: "yes",
        },
        {
          snippet: `[AGENT]: Just to confirm you are single as in not separated or living with someone. Is that correct?\n[CUSTOMER]: Correct, I'm single.`,
          expected: "yes",
        },
        {
          snippet: `[AGENT]: And will your partner be attending with you?\n[CUSTOMER]: No, I'll be going alone.`,
          expected: "no",
        },
      ],
    },
    {
      name: "Correct Location",
      text: "Did the agent state the correct destination/location for the booking?",
      autoYesExp: "",
      tests: [
        {
          snippet: `[AGENT]: Now, I have you arriving in Branson, Missouri, on July 24th of 2026.\n[CUSTOMER]: That's right.`,
          expected: "yes",
        },
        {
          snippet: `[AGENT]: So your trip is all set for next summer.\n[CUSTOMER]: And that's to Branson, right?\n[AGENT]: Let me check on that for you.`,
          expected: "no",
        },
      ],
    },
    {
      name: "Reschedule Process",
      text: "Did the agent explain the reschedule process and any associated fees or deposit forfeiture?",
      autoYesExp: "",
      tests: [
        {
          snippet: `[AGENT]: If you need to reschedule, just call us at least 30 days before your trip. There's a $75 reschedule fee, but your deposit stays intact.\n[CUSTOMER]: That sounds reasonable.`,
          expected: "yes",
        },
        {
          snippet: `[AGENT]: By declining the White Glove Plus, you will forfeit your 150 refundable deposit if you do not show for your dates.\n[CUSTOMER]: Understood.`,
          expected: "no",
        },
      ],
    },
  ];

  let qlabSeeded = 0;
  for (const qData of questionsData) {
    const question = await qlabKv.createQuestion(orgId, config.id, qData.name, qData.text);
    if (!question) continue;
    if (qData.autoYesExp) {
      await qlabKv.updateQuestion(orgId, question.id, { autoYesExp: qData.autoYesExp });
    }
    for (const t of qData.tests) {
      await qlabKv.createTest(orgId, question.id, t.snippet, t.expected);
      qlabSeeded++;
    }
  }

  console.log(`[SEED] Question Lab seeded: ${questionsData.length} questions, ${qlabSeeded} tests in config "${config.name}"`);

  // -- Cosmetics seed (avatar frames, flairs, name colors, fonts, animations) --
  const cosmeticProfiles: Array<[string, string[], number, number]> = [
    // [email, purchases, xp, tokens]
    ["admin@monsterrg.com",  ["frame_legendary", "flair_crown", "color_prismatic", "font_chrome", "anim_nova"], 15000, 600],
    ["judge@monsterrg.com",  ["frame_galaxy", "flair_skull", "color_vaporwave", "font_neon_script", "anim_lightning"], 10000, 400],
    ["manager@monsterrg.com", ["frame_diamond", "flair_diamond", "color_aurora", "font_gothic", "anim_fireworks"], 7000, 300],
    ["reviewer@monsterrg.com", ["frame_toxic", "flair_flame", "color_inferno", "font_bold", "anim_matrix"], 4500, 200],
    ["reviewer2@monsterrg.com", ["frame_frost", "flair_bolt", "color_ocean", "font_serif", "anim_petals"], 2500, 150],
    ["agent@monsterrg.com",  ["frame_emerald", "flair_star", "color_gold", "font_mono", "anim_sparkle"], 1200, 80],
  ];

  for (const [email, purchases, xp, tokens] of cosmeticProfiles) {
    const existing = await getGameState(orgId, email);
    await saveGameState(orgId, email, {
      ...existing,
      totalXp: Math.max(existing.totalXp, xp),
      tokenBalance: Math.max(existing.tokenBalance, tokens),
      purchases: [...new Set([...existing.purchases, ...purchases])],
    });
    console.log(`[SEED] Cosmetics for ${email}: ${purchases.join(", ")}`);
  }
  console.log("[SEED] Cosmetics seeded for all test users");

  return { seeded, managerSeeded, judgeSeeded, qlabSeeded, orgId };
}

// -- Default email template content --

const DEFAULT_EMAIL_TEMPLATES: { name: string; subject: string; html: string }[] = [
  {
    name: "Audit Complete",
    subject: "Audit for: {{subjectGuest}} {{passedOrFailed}}",
    html: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Audit Results</title></head><body style="margin:0;padding:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#0d1117;"><tr><td align="center" style="padding:32px 16px;"><table width="560" cellpadding="0" cellspacing="0" style="max-width:100%;width:560px;border:1px solid #21262d;border-radius:12px;overflow:hidden;"><tr><td style="background:#161b22;padding:24px 32px;border-bottom:1px solid #21262d;text-align:center;"><table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr><td style="vertical-align:middle;"><img src="{{logoUrl}}" width="32" height="32" alt="AutoBot" style="display:block;border-radius:6px;background:#0d1117;"></td><td style="vertical-align:middle;padding-left:10px;font-family:'Courier New',monospace;font-size:16px;font-weight:700;color:#3fb950;letter-spacing:2px;">AutoBot</td></tr></table></td></tr><tr><td style="padding:32px;text-align:center;"><p style="margin:0 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#8b949e;">Your Score</p><p style="margin:0;font-size:64px;font-weight:800;color:{{scoreColor}};line-height:1;">{{score}}</p></td></tr><tr><td style="padding:0 32px 28px;">{{notesSection}}</td></tr><tr><td style="padding:0 32px 32px;text-align:center;"><a href="{{reportUrl}}" style="display:inline-block;background:#238636;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:8px;border:1px solid #2ea043;">View Full Report</a></td></tr></table></td></tr></table></body></html>`,
  },
  {
    name: "Appeal Filed",
    subject: "Appeal Filed: {{guestName}} - Record: {{recordId}}",
    html: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Appeal Filed</title></head><body style="margin:0;padding:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#0d1117;min-height:100vh;"><tr><td align="center" style="padding:32px 16px;"><table width="560" cellpadding="0" cellspacing="0" style="max-width:100%;width:560px;border:1px solid #3d2b00;border-radius:12px;overflow:hidden;"><tr><td style="background:#1c1600;padding:24px 28px 20px;border-bottom:1px solid #3d2b00;"><p style="margin:0 0 4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#d29922;">Action Required</p><h1 style="margin:0;font-size:20px;font-weight:700;color:#f0c842;">Appeal Filed</h1><p style="margin:6px 0 0;font-size:12px;color:#9e8300;">A team member has submitted an appeal for review.</p></td></tr><tr><td style="padding:22px 28px 0;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td style="width:50%;padding-right:8px;vertical-align:top;"><div style="background:#161b22;border:1px solid #3d2b00;border-radius:8px;padding:14px 16px;"><p style="margin:0 0 2px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#d29922;">Team Member</p><p style="margin:0;font-size:14px;font-weight:600;color:#f0f6fc;">{{agentName}}</p><p style="margin:2px 0 0;font-size:11px;color:#8b949e;">{{agentEmail}}</p></div></td><td style="width:50%;padding-left:8px;vertical-align:top;"><div style="background:#161b22;border:1px solid #3d2b00;border-radius:8px;padding:14px 16px;"><p style="margin:0 0 2px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#d29922;">Guest / Record</p><p style="margin:0;font-size:14px;font-weight:600;color:#f0f6fc;">{{guestName}}</p><p style="margin:2px 0 0;font-size:11px;color:#8b949e;">Record #{{recordId}}</p></div></td></tr></table></td></tr><tr><td style="padding:14px 28px 0;"><div style="border-left:3px solid #d29922;padding:12px 16px;background:#161b22;border-radius:0 8px 8px 0;"><p style="margin:0 0 4px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#d29922;">Agent Comment</p><p style="margin:0;font-size:13px;color:#c9d1d9;line-height:1.6;">{{comment}}</p></div></td></tr><tr><td style="padding:22px 28px 24px;text-align:center;"><table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr><td style="padding-right:10px;"><a href="{{judgeUrl}}" style="display:inline-block;background:#9e6a03;color:#ffffff;font-size:13px;font-weight:700;text-decoration:none;padding:10px 22px;border-radius:6px;border:1px solid #d29922;">Open Judge Panel</a></td><td><a href="{{reportUrl}}" style="display:inline-block;background:#161b22;color:#c9d1d9;font-size:13px;font-weight:600;text-decoration:none;padding:10px 22px;border-radius:6px;border:1px solid #30363d;">View Report</a></td></tr></table></td></tr><tr><td style="background:#0d1117;border-top:1px solid #3d2b00;padding:14px 28px;text-align:center;"><p style="margin:0;font-size:11px;color:#6e7681;">Filed {{appealedAt}} &nbsp;·&nbsp; Audit ID: {{findingId}}</p></td></tr></table></td></tr></table></body></html>`,
  },
  {
    name: "Appeal Result",
    subject: "Your Appeal Result: {{finalScore}}",
    html: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Appeal Result</title></head><body style="margin:0;padding:0;background:#070d18;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#070d18;min-height:100vh;"><tr><td align="center" style="padding:40px 16px;"><table width="580" cellpadding="0" cellspacing="0" style="max-width:100%;width:580px;background:#0d1520;border:1px solid #1e2d45;border-radius:16px;overflow:hidden;"><tr><td style="padding:24px 28px 22px;border-bottom:1px solid #1a2840;"><table cellpadding="0" cellspacing="0"><tr><td style="vertical-align:middle;padding-right:10px;"><svg width="30" height="30" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="18" cy="18" r="18" fill="#0f1e30"/><line x1="18" y1="4" x2="18" y2="9" stroke="#3fb950" stroke-width="2" stroke-linecap="round"/><circle cx="18" cy="3.5" r="1.5" fill="#3fb950"/><rect x="9" y="9" width="18" height="14" rx="4" fill="#1a2840" stroke="#3fb950" stroke-width="1.2"/><circle cx="14" cy="16" r="2.5" fill="#3fb950" opacity="0.9"/><circle cx="22" cy="16" r="2.5" fill="#3fb950" opacity="0.9"/><circle cx="14.8" cy="15.3" r="0.8" fill="#070d18"/><circle cx="22.8" cy="15.3" r="0.8" fill="#070d18"/><rect x="13" y="24" width="10" height="8" rx="2" fill="#1a2840" stroke="#0f1e30" stroke-width="1"/><rect x="6" y="25" width="6" height="3" rx="1.5" fill="#1a2840"/><rect x="24" y="25" width="6" height="3" rx="1.5" fill="#1a2840"/><rect x="14" y="32" width="3" height="4" rx="1" fill="#0f1e30"/><rect x="19" y="32" width="3" height="4" rx="1" fill="#0f1e30"/></svg></td><td style="vertical-align:middle;"><span style="font-size:16px;font-weight:700;color:#e6edf3;letter-spacing:-0.3px;">AutoBot</span></td></tr></table><div style="margin-top:16px;"><div style="margin-bottom:8px;"><span style="display:inline-block;background:#d29922;color:#0a0a0a;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:1.5px;padding:2px 6px;border-radius:3px;">Appeal</span><span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#8b949e;margin-left:5px;">Complete</span></div><h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#e6edf3;line-height:1.2;">Your Appeal Has Been Reviewed</h1><p style="margin:0;font-size:13px;color:#8b949e;line-height:1.6;">Hi <strong style="color:#c9d1d9;">{{teamMemberFirst}}</strong>, here are the results for guest <strong style="color:#c9d1d9;">{{guestName}}</strong>.</p></div></td></tr><tr><td style="padding:24px 28px 0;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td width="44%" style="vertical-align:middle;"><div style="background:#111d2e;border:1px solid #1e2d45;border-radius:10px;padding:20px;text-align:center;"><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#4a6080;margin-bottom:10px;">Original Score</div><div style="font-size:44px;font-weight:800;color:#4a6080;line-height:1;font-variant-numeric:tabular-nums;">{{originalScore}}</div></div></td><td width="12%" style="text-align:center;vertical-align:middle;"><span style="font-size:20px;color:#3b82f6;">&#8594;</span></td><td width="44%" style="vertical-align:middle;"><div style="background:#111d2e;border:2px solid #3b82f6;border-radius:10px;padding:20px;text-align:center;"><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#3b82f6;margin-bottom:10px;">Final Score</div><div style="font-size:44px;font-weight:800;color:#e6edf3;line-height:1;font-variant-numeric:tabular-nums;">{{finalScore}}</div></div></td></tr></table></td></tr><tr><td style="padding:12px 28px 0;"><div style="background:#111d2e;border:1px solid #1e2d45;border-radius:10px;padding:16px 20px;text-align:center;"><span style="font-size:13px;color:#8b949e;"><strong style="color:#e6edf3;">{{overturns}}</strong> of <strong style="color:#e6edf3;">{{totalQuestions}}</strong> questions were overturned &nbsp;&#183;&nbsp; Reviewed by <a href="mailto:{{judgedBy}}" style="color:#3b82f6;text-decoration:none;">{{judgedBy}}</a></span></div></td></tr><tr><td style="padding:24px 28px 28px;text-align:center;"><a href="{{reportUrl}}" style="display:inline-block;padding:12px 32px;background:#3b82f6;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;border:1px solid #2563eb;">View Updated Report</a></td></tr><tr><td style="background:#080f1a;border-top:1px solid #1a2840;padding:14px 28px;text-align:center;"><p style="margin:0 0 4px;font-size:11px;color:#4a6080;">Questions? Contact your supervisor at</p><p style="margin:0;font-size:10px;color:#3a5070;font-family:monospace;">Audit ID: {{findingId}}</p></td></tr></table></td></tr></table></body></html>`,
  },
  {
    name: "Re-Audit Receipt",
    subject: "Uploaded Recording - {{recordId}}",
    html: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Recording Submitted</title></head><body style="margin:0;padding:0;background:#070d18;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#070d18;min-height:100vh;"><tr><td align="center" style="padding:40px 16px;"><table width="580" cellpadding="0" cellspacing="0" style="max-width:100%;width:580px;background:#0d1520;border:1px solid #1e2d45;border-radius:16px;overflow:hidden;"><tr><td style="padding:28px 32px 24px;text-align:center;border-bottom:1px solid #1a2840;"><table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr><td style="vertical-align:middle;padding-right:10px;"><svg width="32" height="32" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="18" cy="18" r="18" fill="#0f1e30"/><line x1="18" y1="4" x2="18" y2="9" stroke="#3fb950" stroke-width="2" stroke-linecap="round"/><circle cx="18" cy="3.5" r="1.5" fill="#3fb950"/><rect x="9" y="9" width="18" height="14" rx="4" fill="#1a2840" stroke="#3fb950" stroke-width="1.2"/><circle cx="14" cy="16" r="2.5" fill="#3fb950" opacity="0.9"/><circle cx="22" cy="16" r="2.5" fill="#3fb950" opacity="0.9"/><circle cx="14.8" cy="15.3" r="0.8" fill="#070d18"/><circle cx="22.8" cy="15.3" r="0.8" fill="#070d18"/><rect x="13" y="24" width="10" height="8" rx="2" fill="#1a2840" stroke="#0f1e30" stroke-width="1"/><rect x="6" y="25" width="6" height="3" rx="1.5" fill="#1a2840"/><rect x="24" y="25" width="6" height="3" rx="1.5" fill="#1a2840"/><rect x="14" y="32" width="3" height="4" rx="1" fill="#0f1e30"/><rect x="19" y="32" width="3" height="4" rx="1" fill="#0f1e30"/></svg></td><td style="vertical-align:middle;"><span style="font-size:17px;font-weight:700;color:#e6edf3;letter-spacing:-0.3px;">AutoBot</span></td></tr></table></td></tr><tr><td style="padding:28px 32px 24px;text-align:center;border-bottom:1px solid #1a2840;"><div style="margin-bottom:12px;"><span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#3b82f6;">Uploaded</span><span style="display:inline-block;background:#1e3a5f;color:#60a5fa;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:1.5px;padding:2px 7px;border-radius:3px;margin-left:5px;">Recording</span></div><h1 style="margin:0 0 10px;font-size:24px;font-weight:700;color:#e6edf3;line-height:1.2;">Recording Submitted for Re-Audit</h1><p style="margin:0;font-size:14px;color:#8b949e;">Hey <strong style="color:#c9d1d9;">{{teamMemberFirst}}</strong>, hang tight &#8212; your results will be available shortly.</p></td></tr><tr><td style="padding:24px 32px;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#111d2e;border:1px solid #1e2d45;border-radius:10px;overflow:hidden;"><tr><td style="padding:16px 20px;text-align:center;border-bottom:1px solid #1a2840;"><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#4a6080;margin-bottom:6px;">Record</div><div style="font-size:20px;font-weight:700;color:#e6edf3;">{{recordId}}</div></td></tr><tr><td style="padding:16px 20px;text-align:center;border-bottom:1px solid #1a2840;"><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#4a6080;margin-bottom:6px;">Original Genie</div><div style="font-size:16px;font-weight:600;color:#3b82f6;">{{originalGenieId}}</div></td></tr><tr><td style="padding:16px 20px;text-align:center;border-bottom:1px solid #1a2840;"><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#4a6080;margin-bottom:6px;">New Genie(s)</div><div style="font-size:16px;font-weight:600;color:#e6edf3;">{{newGenieIds}}</div></td></tr><tr><td style="padding:16px 20px;text-align:center;"><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#4a6080;margin-bottom:6px;">Submitted</div><div style="font-size:14px;font-weight:500;color:#c9d1d9;">{{submittedAt}}</div></td></tr></table></td></tr><tr><td style="padding:0 32px 24px;text-align:center;"><p style="margin:0;font-size:13px;color:#8b949e;line-height:1.7;">Your audit is being updated with the new recording. Once processing is complete, your report will reflect the latest results.</p></td></tr><tr><td style="padding:0 32px 32px;text-align:center;"><a href="{{reportUrl}}" style="display:inline-block;padding:12px 32px;background:#3b82f6;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;border:1px solid #2563eb;">View Audit Report</a></td></tr><tr><td style="background:#080f1a;border-top:1px solid #1a2840;padding:14px 28px;text-align:center;"><p style="margin:0 0 4px;font-size:11px;color:#4a6080;">This is an automated receipt. Do not reply to this email.</p><p style="margin:0;font-size:10px;color:#3a5070;font-family:monospace;">Audit ID: {{findingId}}</p></td></tr></table></td></tr></table></body></html>`,
  },
];

/** Seeds default email templates for an org if they don't already exist (matched by name). */
async function seedDefaultEmailTemplates(orgId: OrgId, force = false): Promise<string[]> {
  const existing = await listEmailTemplates(orgId);
  const existingByName = new Map(existing.map((t) => [t.name, t]));
  const upserted: string[] = [];
  for (const tpl of DEFAULT_EMAIL_TEMPLATES) {
    if (force || !existingByName.has(tpl.name)) {
      const existing = existingByName.get(tpl.name);
      await saveEmailTemplate(orgId, existing ? { ...existing, ...tpl } : tpl);
      upserted.push(tpl.name);
      console.log(`[SEED] ${force && existingByName.has(tpl.name) ? "Updated" : "Created"} default email template: ${tpl.name}`);
    }
  }
  return upserted;
}

async function handleSeedEmailTemplates(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;
  const force = new URL(req.url).searchParams.get("force") === "1";
  const upserted = await seedDefaultEmailTemplates(auth.orgId, force);
  return json({ ok: true, upserted });
}

async function handleSeed(_req: Request): Promise<Response> {
  const db = await Deno.openKv(Deno.env.get("KV_URL") ?? undefined);

  // Create or reuse default org
  let orgId: OrgId;
  const existingOrg = await db.get<string>(["default-org"]);
  if (existingOrg.value) {
    orgId = existingOrg.value;
  } else {
    orgId = await createOrg("Auto-Bot Dev", "admin@autobot.dev");
    await db.set(["default-org"], orgId);
  }

  const result = await seedOrgData(orgId);
  return json({ ok: true, ...result });
}

// -- Super Admin --

async function routeSuperAdmin(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  if (req.method === "GET" && path === "/super-admin") {
    return html(getSuperAdminPage());
  }
  if (req.method === "GET" && path === "/super-admin/api/orgs") {
    return handleSuperAdminListOrgs();
  }
  if (req.method === "POST" && path === "/super-admin/api/org") {
    return handleSuperAdminCreateOrg(req);
  }
  if (req.method === "POST" && path === "/super-admin/api/org/delete") {
    return handleSuperAdminDeleteOrg(req);
  }
  if (req.method === "POST" && path === "/super-admin/api/org/seed") {
    return handleSuperAdminSeed(req);
  }
  if (req.method === "POST" && path === "/super-admin/api/org/seed-sounds") {
    return handleSuperAdminSeedSounds(req);
  }
  if (req.method === "POST" && path === "/super-admin/api/org/wipe") {
    return handleSuperAdminWipe(req);
  }
  if (req.method === "POST" && path === "/super-admin/api/org/impersonate") {
    return handleSuperAdminImpersonate(req);
  }
  return json({ error: "not found" }, 404);
}

async function handleSuperAdminListOrgs(): Promise<Response> {
  const db = await Deno.openKv(Deno.env.get("KV_URL") ?? undefined);
  const orgs = await listOrgs();

  const result = [];
  for (const org of orgs) {
    let userCount = 0;
    for await (const _ of db.list({ prefix: [org.id, "user"] })) {
      userCount++;
    }
    // Count findings: ChunkedKv stores _n meta-key per finding
    let findingCount = 0;
    for await (const entry of db.list({ prefix: [org.id, "audit-finding"] })) {
      const lastKey = entry.key[entry.key.length - 1];
      if (lastKey === "_n") findingCount++;
    }
    result.push({ ...org, userCount, findingCount });
  }
  return json(result);
}

async function handleSuperAdminCreateOrg(req: Request): Promise<Response> {
  const body = await req.json();
  const { name } = body;
  if (!name) return json({ error: "name required" }, 400);

  const orgId = await createOrg(name, "super-admin@local");
  await createUser(orgId, "admin@autobot.dev", "admin", "admin");
  return json({ ok: true, orgId });
}

async function handleSuperAdminDeleteOrg(req: Request): Promise<Response> {
  const body = await req.json();
  const { orgId } = body;
  if (!orgId) return json({ error: "orgId required" }, 400);

  // Wipe all org-scoped KV entries
  const db = await Deno.openKv(Deno.env.get("KV_URL") ?? undefined);
  let deleted = 0;
  for await (const entry of db.list({ prefix: [orgId] })) {
    await db.delete(entry.key);
    deleted++;
  }

  // Clean up email-index entries pointing to this org
  for await (const entry of db.list<{ orgId: string }>({ prefix: ["email-index"] })) {
    if (entry.value && entry.value.orgId === orgId) {
      await db.delete(entry.key);
      deleted++;
    }
  }

  // Clear default-org pointer if it points to this org
  const defaultOrg = await db.get<string>(["default-org"]);
  if (defaultOrg.value === orgId) {
    await db.delete(["default-org"]);
  }

  // Delete the org record itself
  await deleteOrg(orgId);

  console.log(`[SUPER-ADMIN] Deleted org ${orgId}: ${deleted} KV entries removed`);
  return json({ ok: true, deleted });
}

async function handleSuperAdminSeed(req: Request): Promise<Response> {
  const body = await req.json();
  const { orgId } = body;
  if (!orgId) return json({ error: "orgId required" }, 400);

  const result = await seedOrgData(orgId);
  return json({ ok: true, ...result });
}

async function handleSuperAdminSeedSounds(req: Request): Promise<Response> {
  const body = await req.json();
  const { orgId, packIds } = body;
  if (!orgId) return json({ error: "orgId required" }, 400);
  if (!packIds?.length) return json({ error: "packIds required" }, 400);

  let uploaded = 0;
  const errors: string[] = [];

  for (const packId of packIds) {
    const slots = BUILTIN_PACKS[packId];
    if (!slots) { errors.push(`Unknown pack: ${packId}`); continue; }

    const pack: SoundPackMeta = {
      id: packId,
      name: BUILTIN_PACK_NAMES[packId] || packId,
      slots: {},
      createdAt: Date.now(),
      createdBy: "super-admin@local",
    };

    for (const [slot, filename] of Object.entries(slots)) {
      try {
        const filePath = new URL("./sounds/" + filename, import.meta.url);
        const bytes = await Deno.readFile(filePath);
        const s3Key = `sounds/${orgId}/${packId}/${slot}.mp3`;
        const ref = new S3Ref(env.s3Bucket, s3Key);
        await ref.save(bytes);
        pack.slots[slot as SoundSlot] = filename;
        uploaded++;
      } catch (e) {
        errors.push(`${packId}/${slot}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    await saveSoundPack(orgId, pack);
  }

  return json({ ok: true, uploaded, errors: errors.length > 0 ? errors : undefined });
}

async function handleSuperAdminWipe(req: Request): Promise<Response> {
  const body = await req.json();
  const { orgId } = body;
  if (!orgId) return json({ error: "orgId required" }, 400);

  const db = await Deno.openKv(Deno.env.get("KV_URL") ?? undefined);
  let deleted = 0;
  for await (const entry of db.list({ prefix: [orgId] })) {
    await db.delete(entry.key);
    deleted++;
  }

  // Clean up email-index entries pointing to this org
  for await (const entry of db.list<{ orgId: string }>({ prefix: ["email-index"] })) {
    if (entry.value && entry.value.orgId === orgId) {
      await db.delete(entry.key);
      deleted++;
    }
  }

  console.log(`[SUPER-ADMIN] Wiped org ${orgId}: ${deleted} KV entries`);
  return json({ ok: true, deleted });
}

async function handleSuperAdminImpersonate(req: Request): Promise<Response> {
  const body = await req.json();
  const { orgId } = body;
  if (!orgId) return json({ error: "orgId required" }, 400);

  const token = await createSession({ email: "super-admin@local", orgId, role: "admin" });
  return new Response(JSON.stringify({ ok: true, redirect: "/admin/dashboard" }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": sessionCookie(token),
    },
  });
}

// -- Admin: Reset Finding --

async function handleResetFinding(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  const body = await req.json();
  const { findingId } = body;
  if (!findingId) return json({ error: "findingId required" }, 400);

  const db = await Deno.openKv(Deno.env.get("KV_URL") ?? undefined);
  let deleted = 0;

  // Prefixes with sub-keys (org-scoped)
  const listPrefixes = [
    orgKey(auth.orgId, "review-pending", findingId),
    orgKey(auth.orgId, "review-decided", findingId),
    orgKey(auth.orgId, "review-lock", findingId),
    orgKey(auth.orgId, "judge-pending", findingId),
    orgKey(auth.orgId, "judge-decided", findingId),
    orgKey(auth.orgId, "judge-lock", findingId),
  ];
  for (const prefix of listPrefixes) {
    for await (const entry of db.list({ prefix })) {
      await db.delete(entry.key);
      deleted++;
    }
  }

  // Exact keys (org-scoped)
  const exactKeys: Deno.KvKey[] = [
    orgKey(auth.orgId, "review-audit-pending", findingId),
    orgKey(auth.orgId, "judge-audit-pending", findingId),
    orgKey(auth.orgId, "appeal", findingId),
    orgKey(auth.orgId, "manager-queue", findingId),
    orgKey(auth.orgId, "manager-remediation", findingId),
  ];
  for (const key of exactKeys) {
    const entry = await db.get(key);
    if (entry.versionstamp) {
      await db.delete(key);
      deleted++;
    }
  }

  // Re-populate review queue
  let queued = 0;
  const answers = await getAllAnswersForFinding(auth.orgId, findingId);
  if (answers?.length) {
    await populateReviewQueue(auth.orgId, findingId, answers);
    queued = answers.filter((q: any) => q.answer === "No").length;
  }

  console.log(`[ADMIN] Reset finding ${findingId}: ${deleted} deleted, ${queued} re-queued`);
  return json({ ok: true, deleted, queued, findingId });
}

// -- Admin: Flip Answer --

async function handleAdminFlipAnswer(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;
  const { findingId, questionIndex } = await req.json();
  if (!findingId || questionIndex === undefined) return json({ error: "findingId and questionIndex required" }, 400);
  const finding = await getFinding(auth.orgId, findingId);
  if (!finding) return json({ error: "finding not found" }, 404);
  const questions = finding.answeredQuestions as any[];
  if (!questions || questionIndex >= questions.length) return json({ error: "question index out of range" }, 400);
  const q = questions[questionIndex];
  const isYes = (a: string) => { const s = String(a ?? "").trim().toLowerCase(); return s.startsWith("yes") || s === "true" || s === "y" || s === "1"; };
  const newAnswer = isYes(q.answer) ? "No" : "Yes";
  questions[questionIndex] = { ...q, answer: newAnswer, adminFlippedAt: Date.now(), adminFlippedBy: auth.email };
  finding.answeredQuestions = questions;
  await saveFinding(auth.orgId, finding);
  await saveBatchAnswers(auth.orgId, findingId, 0, questions);
  console.log(`🔧 [ADMIN] ${auth.email} flipped answer for finding ${findingId} Q${questionIndex}: ${q.answer} → ${newAnswer}`);
  return json({ ok: true });
}

// -- Admin: Wipe KV --

async function handleWipeKv(_req: Request): Promise<Response> {
  const db = await Deno.openKv(Deno.env.get("KV_URL") ?? undefined);
  let deleted = 0;
  const iter = db.list({ prefix: [] });
  for await (const entry of iter) {
    await db.delete(entry.key);
    deleted++;
  }
  console.log(`[ADMIN] Wiped ${deleted} KV entries`);
  return json({ ok: true, deleted });
}

async function handleBackfillReviewScores(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;
  const body = await req.json();
  const { since, until } = body as { since: number; until: number };
  if (!since || !until) return json({ error: "since and until required" }, 400);
  const result = await backfillReviewScores(auth.orgId, since, until);
  console.log(`[ADMIN] 🔧 Backfill review scores by ${auth.email}: scanned=${result.scanned} updated=${result.updated}`);
  return json({ ok: true, ...result });
}

async function handleBackfillChargebackEntries(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;
  const body = await req.json();
  const { since, until } = body as { since: number; until: number };
  if (!since || !until) return json({ error: "since and until required" }, 400);
  const result = await backfillChargebackEntries(auth.orgId, since, until);
  console.log(`[ADMIN] 🔧 Backfill chargeback entries by ${auth.email}: scanned=${result.scanned} cbUpdated=${result.cbUpdated} cbDeleted=${result.cbDeleted} wireUpdated=${result.wireUpdated}`);
  return json({ ok: true, ...result });
}

async function handlePurgeOldAudits(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;
  const body = await req.json();
  const { since, before } = body as { since?: number; before?: number };
  if (!before) return json({ error: "before required" }, 400);
  const result = await purgeOldEntries(auth.orgId, since ?? 0, before);
  console.log(`[ADMIN] 🗑️ Purged audits [${since ? new Date(since).toISOString() : "epoch"} – ${new Date(before).toISOString()}] by ${auth.email}: completed=${result.completed} cb=${result.chargebacks} wire=${result.wire}`);
  return json({ ok: true, since: since ?? 0, before, ...result });
}

async function handlePurgeBypassedWireDeductions(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;
  const bypassCfg = await getOfficeBypassConfig(auth.orgId);
  if (!bypassCfg.patterns.length) return json({ error: "no bypass patterns configured" }, 400);
  const result = await purgeBypassedWireDeductions(auth.orgId, bypassCfg.patterns);
  console.log(`[ADMIN] 🧹 Purged bypassed wire deductions by ${auth.email}: deleted=${result.deleted} kept=${result.kept} patterns=${bypassCfg.patterns.join(",")}`);
  return json({ ok: true, deleted: result.deleted, kept: result.kept, patterns: bypassCfg.patterns });
}

async function handleDeduplicateFindings(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;
  const body = await req.json();
  const { since, until, dryRun, plan } = body as { since: number; until: number; dryRun?: boolean; plan?: unknown };

  if (!since || !until) return json({ error: "since and until required" }, 400);

  // Phase 1: dry-run — scan and return the plan without deleting
  if (dryRun) {
    const result = await findDuplicates(auth.orgId, since, until);
    console.log(`[ADMIN] 🔍 Dedup dry-run by ${auth.email}: scanned=${result.scanned} groups=${result.groups} toDelete=${result.toDelete.filter(d => !d.keep).length}`);
    return json({ ok: true, scanned: result.scanned, groups: result.groups, toDelete: result.toDelete });
  }

  // Phase 2: stream deletion progress as SSE
  if (!plan || !Array.isArray(plan)) return json({ error: "plan required for deletion" }, 400);

  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  const send = (data: unknown) => writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)).catch(() => {});

  // Run deletion in background — response streams back
  (async () => {
    try {
      console.log(`[ADMIN] 🧹 Dedup deletion started by ${auth.email}: ${plan.filter((d: any) => !d.keep).length} to delete`);
      await deleteDuplicates(auth.orgId, plan as any[], (deleted, total, findingId) => {
        console.log(`[ADMIN] 🧹 Dedup progress: ${deleted}/${total} findingId=${findingId}`);
        send({ deleted, total, findingId });
      });
      console.log(`[ADMIN] 🧹 Dedup done by ${auth.email}`);
      send({ done: true });
    } catch (err) {
      console.error(`[ADMIN] ❌ Dedup error:`, err);
      send({ error: String(err) });
    } finally {
      await writer.close().catch(() => {});
    }
  })();

  return new Response(readable, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}

// -- SSE Events Endpoint --

async function handleSSE(req: Request): Promise<Response> {
  const auth = await authenticate(req);
  if (!auth) return json({ error: "unauthorized" }, 401);

  let closed = false;
  let lastSeen = Date.now();

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch { closed = true; }
      };

      // Heartbeat every 15s
      const heartbeat = setInterval(() => {
        if (closed) { clearInterval(heartbeat); return; }
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch { closed = true; clearInterval(heartbeat); }
      }, 15_000);

      // Poll for personal events every 2s
      const poll = setInterval(async () => {
        if (closed) { clearInterval(poll); return; }
        try {
          const events = await getEvents(auth.orgId, auth.email, lastSeen);
          if (events.length > 0) {
            for (const evt of events) {
              send(evt.type, evt);
            }
            lastSeen = Math.max(...events.map((e) => e.createdAt));
            await deleteEvents(auth.orgId, auth.email, events.map((e) => e.id));
          }
        } catch (err) {
          console.error(`[SSE] Poll error for ${auth.email}:`, err);
        }
      }, 2_000);

      // Poll for broadcast events every 3s
      let lastBroadcastSeen = Date.now();
      const broadcastPoll = setInterval(async () => {
        if (closed) { clearInterval(broadcastPoll); return; }
        try {
          const broadcasts = await getBroadcastEvents(auth.orgId, lastBroadcastSeen);
          for (const evt of broadcasts) {
            if (evt.triggerEmail === auth.email) continue;
            send("prefab-broadcast", evt);
          }
          if (broadcasts.length > 0) {
            lastBroadcastSeen = Math.max(...broadcasts.map((e) => e.ts));
          }
        } catch (err) {
          console.error(`[SSE] Broadcast poll error for ${auth.email}:`, err);
        }
      }, 3_000);

      // Send initial connection event
      send("connected", { email: auth.email, ts: Date.now() });

      // Cleanup when the client disconnects
      req.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(heartbeat);
        clearInterval(poll);
        clearInterval(broadcastPoll);
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

// -- Messaging Endpoints --

async function handleSendMessage(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const body = await req.json();
  const { to, body: msgBody } = body;
  if (!to || !msgBody) return json({ error: "to and body required" }, 400);
  if (typeof msgBody !== "string" || msgBody.trim().length === 0) {
    return json({ error: "body must be a non-empty string" }, 400);
  }

  const recipient = await getUser(auth.orgId, to);
  if (!recipient) return json({ error: "recipient not found" }, 404);

  const { emitEvent } = await import("./lib/kv.ts");
  const msg = await sendMessage(auth.orgId, auth.email, to, msgBody.trim());

  // Emit event for the recipient
  await emitEvent(auth.orgId, to, "message-received", {
    from: auth.email,
    preview: msgBody.trim().slice(0, 100),
    messageId: msg.id,
  });

  return json(msg);
}

async function handleGetConversation(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const url = new URL(req.url);
  const otherEmail = url.pathname.replace("/api/messages/", "");
  if (!otherEmail || otherEmail === "unread" || otherEmail === "conversations") {
    return json({ error: "email parameter required" }, 400);
  }

  await markConversationRead(auth.orgId, auth.email, otherEmail);
  const messages = await getConversation(auth.orgId, auth.email, otherEmail);
  return json(messages);
}

async function handleGetUnread(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const count = await getUnreadCount(auth.orgId, auth.email);
  return json({ count });
}

async function handleGetConversations(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const conversations = await getConversationList(auth.orgId, auth.email);
  return json(conversations);
}

async function handleGetOrgUsers(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const users = await listUsers(auth.orgId);
  return json(users.filter((u) => u.email !== auth.email).map((u) => ({ email: u.email, role: u.role })));
}

// -- Watchdog Cron --
// Hourly: find findings stuck in the same step for > 30 minutes and re-publish them.
// Root cause: Deno KV 503s under high parallelism leave steps hanging indefinitely with no timeout.
Deno.cron("watchdog", "0 * * * *", async () => {
  try {
    const stuck = await getStuckFindings(30 * 60 * 1000);
    if (stuck.length === 0) return;
    console.log(`[WATCHDOG] ⚠️ Found ${stuck.length} stuck finding(s)`);
    for (const s of stuck) {
      try {
        console.log(`[WATCHDOG] 🔁 Re-publishing ${s.findingId} (step=${s.step}, age=${Math.round(s.ageMs / 60000)}min)`);
        await publishStep(s.step, { findingId: s.findingId, orgId: s.orgId });
        // Bump watchdog ts so we don't immediately re-trigger on next cron run
        await trackActive(s.orgId as OrgId, s.findingId, s.step);
      } catch (err) {
        console.error(`[WATCHDOG] ❌ Failed to re-publish ${s.findingId}:`, err);
      }
    }
  } catch (err) {
    console.error("[WATCHDOG] ❌ Error:", err);
  }
});

// -- Chargebacks Weekly Cron --
// Every Tuesday at 7am: append previous week (Mon–Sun) chargebacks + omissions + wire deductions to Google Sheets.
async function runWeeklySheets(since: number, until: number): Promise<void> {
  const saS3Key = env.sheetsSaS3Key;
  const sheetId = env.chargebacksSheetId;
  const orgId = env.chargebacksOrgId as OrgId;
  if (!saS3Key || !sheetId || !orgId) {
    console.log("[SHEETS] ⚠️ Missing SHEETS_SA_S3_KEY, sheet ID, or org ID — skipping");
    return;
  }
  const saBytes = await new S3Ref(env.s3Bucket, saS3Key).get();
  if (!saBytes) { console.error(`[SHEETS] ❌ SA JSON not found in S3: ${saS3Key}`); return; }
  const saJson = JSON.parse(new TextDecoder().decode(saBytes));
  const saEmail = saJson.client_email as string;
  const saKey = saJson.private_key as string;
  console.log(`[SHEETS] ✅ SA loaded for ${saEmail}`);

  const entries = await getChargebackEntries(orgId, since, until);
  const chargebacks = entries.filter((e) => e.failedQHeaders.some((h) => CHARGEBACK_QUESTIONS.has(h)));
  const omissions = entries.filter((e) => e.failedQHeaders.some((h) => !CHARGEBACK_QUESTIONS.has(h)));
  const wireResult = await getWireDeductionEntries(orgId, since, until);
  const wireEntries = wireResult.items;

  const fmtDate = (ts: number) => new Date(ts).toLocaleDateString("en-US");
  const realm = Deno.env.get("QB_REALM");
  const crmUrl = (e: { recordId: string }) => `https://${realm}.quickbase.com/db/bpb28qsnn?a=dr&rid=${e.recordId}`;
  const pkgCrmUrl = (e: { recordId: string }) => `https://${realm}.quickbase.com/nav/app/bmhvhc7sk/table/bttffb64u/action/dr?rid=${e.recordId}`;
  const auditUrl = (e: { findingId: string }) => `${env.selfUrl}/audit/report?id=${e.findingId}`;
  const toRows = (list: typeof entries): string[][] =>
    list.map((e) => [fmtDate(e.ts), e.voName, e.revenue, crmUrl(e), e.destination, e.failedQHeaders.join(", "), `${e.score}%`]);
  const toWireRows = (list: WireDeductionEntry[]): string[][] =>
    list.map((e) => [fmtDate(e.ts), `${e.score}%`, String(e.questionsAudited), String(e.totalSuccess), pkgCrmUrl(e), auditUrl(e), e.office, e.excellenceAuditor, "", e.guestName]);

  await appendSheetRows(sheetId, "Chargebacks", toRows(chargebacks), saEmail, saKey);
  await appendSheetRows(sheetId, "Omissions", toRows(omissions), saEmail, saKey);
  await appendSheetRows(sheetId, "Wire Deductions", toWireRows(wireEntries), saEmail, saKey);
  console.log(`[SHEETS] ✅ Appended ${chargebacks.length} chargebacks, ${omissions.length} omissions, ${wireEntries.length} wire deductions`);
}

Deno.cron("chargebacks-weekly", "0 7 * * 2", async () => {
  try {
    const now = new Date();
    const sunday = new Date(now); sunday.setDate(sunday.getDate() - 1); sunday.setHours(23, 59, 59, 999);
    const monday = new Date(sunday); monday.setDate(monday.getDate() - 6); monday.setHours(0, 0, 0, 0);
    console.log(`[SHEETS-CRON] 🚀 Running for ${monday.toDateString()} – ${sunday.toDateString()}`);
    await runWeeklySheets(monday.getTime(), sunday.getTime());
  } catch (err) {
    console.error("[SHEETS-CRON] ❌ Error:", err);
  }
});

// TEST: fire immediately on this deploy to verify Wire Deductions tab — remove after confirming
(async () => {
  try {
    const now = new Date();
    const until = now.getTime();
    const since = until - 7 * 24 * 3600 * 1000;
    console.log("[SHEETS-TEST] 🚀 Firing test run for last 7 days");
    await runWeeklySheets(since, until);
    console.log("[SHEETS-TEST] ✅ Done");
  } catch (err) {
    console.error("[SHEETS-TEST] ❌", err);
  }
})();

// -- Webhook Email Handler Registration --
// Call handlers in-process to avoid Deno Deploy 508 loop-detected on self-fetch.
// Each handler builds a synthetic Request so the existing handler functions work as-is.

function makeSyntheticReq(path: string, orgId: string, payload: unknown): Request {
  return new Request(`${env.selfUrl}${path}?org=${encodeURIComponent(orgId)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

registerWebhookEmailHandler("terminate", async (orgId, payload) => {
  const res = await handleAuditCompleteWebhook(makeSyntheticReq("/webhooks/audit-complete", orgId, payload));
  const text = await res.text().catch(() => "");
  console.log(`[WEBHOOK:terminate-email] in-process result: ${text.slice(0, 200)}`);
});

registerWebhookEmailHandler("appeal", async (orgId, payload) => {
  const res = await handleAppealFiledWebhook(makeSyntheticReq("/webhooks/appeal-filed", orgId, payload));
  const text = await res.text().catch(() => "");
  console.log(`[WEBHOOK:appeal-email] in-process result: ${text.slice(0, 200)}`);
});

registerWebhookEmailHandler("judge", async (orgId, payload) => {
  const res = await handleAppealDecidedWebhook(makeSyntheticReq("/webhooks/appeal-decided", orgId, payload));
  const text = await res.text().catch(() => "");
  console.log(`[WEBHOOK:judge-email] in-process result: ${text.slice(0, 200)}`);
});

registerWebhookEmailHandler("manager", async (orgId, payload) => {
  const res = await handleManagerReviewWebhook(makeSyntheticReq("/webhooks/manager-review", orgId, payload));
  const text = await res.text().catch(() => "");
  console.log(`[WEBHOOK:manager-email] in-process result: ${text.slice(0, 200)}`);
});

// -- Email Report Cron --

import { runReport, queryReportData } from "./lib/report-engine.ts";
import { renderSections, renderFullEmail } from "./lib/report-renderer.ts";
import type { ScheduleConfig } from "./lib/kv.ts";

const estFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit", minute: "2-digit", hour12: false,
  weekday: "short", day: "2-digit",
});

function getEstParts(): Record<string, string> {
  return Object.fromEntries(
    estFormatter.formatToParts(new Date()).map((p) => [p.type, p.value])
  );
}

function matchesSimpleSchedule(schedule: Extract<ScheduleConfig, { mode: "simple" }>): boolean {
  const parts = getEstParts();
  const hhmm = `${parts.hour}:${parts.minute}`;
  const isWeekend = parts.weekday === "Sat" || parts.weekday === "Sun";

  switch (schedule.frequency) {
    case "hourly":
      return parts.minute === "00";

    case "daily":
      if (hhmm !== schedule.timeOfDayEst) return false;
      if (schedule.days === "weekdays" && isWeekend) return false;
      if (schedule.days === "weekends" && !isWeekend) return false;
      return true;

    case "monthly":
      return hhmm === schedule.timeOfDayEst &&
             parseInt(parts.day) === schedule.dayOfMonth;
  }
}

function matchesCronExpression(expression: string): boolean {
  const now = new Date();
  const [minF, hrF, domF, monF, dowF] = expression.trim().split(/\s+/);
  const match = (field: string, val: number) => field === "*" || parseInt(field) === val;
  return (
    match(minF, now.getUTCMinutes()) &&
    match(hrF,  now.getUTCHours()) &&
    match(domF, now.getUTCDate()) &&
    match(monF, now.getUTCMonth() + 1) &&
    match(dowF, now.getUTCDay())
  );
}

Deno.cron("email-reports", "* * * * *", async () => {
  try {
    const orgs = await listOrgs();
    for (const org of orgs) {
      const configs = await listEmailReportConfigs(org.id);
      for (const config of configs) {
        if (config.disabled || !config.schedule || !config.recipients?.length) continue;

        let shouldFire = false;
        if (config.schedule.mode === "simple") {
          shouldFire = matchesSimpleSchedule(config.schedule);
        } else if (config.schedule.mode === "cron") {
          shouldFire = matchesCronExpression(config.schedule.expression);
        }

        if (!shouldFire) continue;

        console.log(`[EMAIL-REPORT-CRON] Firing report "${config.name}" for org=${org.id}`);
        runReport(org.id, config).catch((err) =>
          console.error(`[EMAIL-REPORT-CRON] ❌ Failed "${config.name}" org=${org.id}:`, err)
        );
      }
    }
  } catch (err) {
    console.error("[EMAIL-REPORT-CRON] ❌ Error:", err);
  }
});

// -- Server --

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Health check
  if (url.pathname === "/health") {
    return json({ ok: true, ts: Date.now() });
  }

  // Favicon
  if (url.pathname === "/favicon.svg") {
    try {
      const svg = await Deno.readTextFile(new URL("./favicon.svg", import.meta.url));
      return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" } });
    } catch { return new Response("", { status: 404 }); }
  }

  // Logo PNG (for email clients that block SVG — Gmail, etc.)
  if (url.pathname === "/logo.png") {
    const png = await getLogoPng();
    if (png) return new Response(png as BodyInit, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" } });
    // Fallback: redirect to SVG
    return Response.redirect(`${env.selfUrl}/favicon.svg`, 302);
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
        return new Response(bytes as BodyInit, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=86400" } });
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
        const res = await handler(req);

        // Inject impersonation bar for admin viewing role-specific pages
        const rolePageMap: Record<string, string> = {
          "/judge": "judge", "/judge/dashboard": "judge",
          "/review": "reviewer", "/review/dashboard": "reviewer",
          "/manager": "manager", "/manager/audits": "manager", "/agent": "user",
        };
        const targetRole = rolePageMap[url.pathname];
        if (targetRole && res.headers.get("content-type")?.includes("text/html")) {
          const auth = await authenticate(req);
          if (auth?.role === "admin") {
            const body = await res.text();
            const asEmail = url.searchParams.get("as") ?? "";
            const snippet = getImpersonateSnippet(targetRole, asEmail);
            const injected = body.replace("</body>", snippet + "</body>");
            return new Response(injected, { status: res.status, headers: res.headers });
          }
        }

        return res;
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
            let genieNumber = "?";
            let recordId = "?";
            if (retryOrgId) {
              try {
                const f = await getFinding(retryOrgId, fid);
                if (f) {
                  genieNumber = String(f.record?.GenieNumber ?? f.genieIds?.[0] ?? "?");
                  recordId = String(f.record?.RecordId ?? "?");
                }
              } catch { /* best effort */ }
            }
            sendEmail({
              to: env.alertEmail,
              subject: `[Auto-Bot] Pipeline retries exhausted: ${stepName}`,
              htmlBody: `<h3>Pipeline Step Failed</h3>
<p><b>Finding ID:</b> ${fid}</p>
<p><b>Record ID:</b> ${recordId}</p>
<p><b>Genie Number:</b> ${genieNumber}</p>
<p><b>Step:</b> ${stepName}</p>
<p><b>Retries:</b> ${attempt - 1}/${pipelineCfg.maxRetries}</p>
<p><b>Error:</b></p><pre>${msg}</pre>
<p>
  <a href="${env.selfUrl}/audit/report?id=${fid}${retryOrgId ? `&org=${retryOrgId}` : ""}">View Report</a>
  &nbsp;|&nbsp;
  <a href="https://fly.io/apps/autobottom/monitoring/logs?search=${fid}">View Logs</a>
</p>`,
            }).catch((emailErr) => console.error(`[${url.pathname}] Failed to send alert email:`, emailErr));
          }
          return json({ error: msg, retried: attempt <= pipelineCfg.maxRetries, attempt }, 200);
        }

        return json({ error: msg }, 500);
      }
    }
  }

  // Super Admin (session-gated: must be logged in as ai@monsterrg.com)
  if (url.pathname.startsWith("/super-admin")) {
    const sa = await authenticate(req);
    if (!sa || sa.email !== "ai@monsterrg.com") {
      return req.method === "GET" && url.pathname === "/super-admin"
        ? Response.redirect(new URL("/login", req.url).href, 302)
        : json({ error: "unauthorized" }, 401);
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
