import * as icons from "./shared/icons.ts";
import { stepInit } from "./steps/init.ts";
import { stepTranscribe } from "./steps/transcribe.ts";
import { stepTranscribeCb } from "./steps/transcribe-cb.ts";
import { stepPrepare } from "./steps/prepare.ts";
import { stepAskBatch } from "./steps/ask-batch.ts";
import { stepFinalize } from "./steps/finalize.ts";
import { stepCleanup } from "./steps/cleanup.ts";
import {
  handleAuditByRid, handlePackageByRid, handleGetFinding, handleGetReport,
  handleGetStats, handleGetRecording, handleFileAppeal, handleAppealStatus,
  handleAppealDifferentRecording, handleAppealUploadRecording,
} from "./controller.ts";
import { getTokenUsage } from "./providers/groq.ts";
import { getOpenApiSpec, getSwaggerHtml, getDocsIndexHtml } from "./swagger.ts";
import { enqueueStep, publishStep } from "./lib/queue.ts";
import {
  trackActive, trackError, trackRetry, trackCompleted, terminateAllActive, getStats, getRecentCompleted, getPipelineConfig, setPipelineConfig,
  saveFinding, saveTranscript, saveBatchAnswers,
  getWebhookConfig, saveWebhookConfig, listEmailReportConfigs, saveEmailReportConfig, deleteEmailReportConfig,
  listEmailTemplates, getEmailTemplate, saveEmailTemplate, deleteEmailTemplate,
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
} from "./lib/kv.ts";
import type { WebhookConfig, WebhookKind, GamificationSettings, SoundPackMeta, SoundSlot } from "./lib/kv.ts";
import { S3Ref } from "./lib/s3.ts";
import { sendEmail } from "./providers/postmark.ts";
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
  handleReviewDashboardPage, handleReviewDashboardData, handleReviewMe,
} from "./review/handlers.ts";
import { getReviewStats, populateReviewQueue, clearReviewQueue } from "./review/kv.ts";

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
} from "./judge/handlers.ts";
import { getAppealStats, populateJudgeQueue, saveAppeal, recordDecision as recordJudgeDecision } from "./judge/kv.ts";

// Manager (unified auth)
import {
  handleManagerPage, handleManagerMe, handleManagerQueueList, handleManagerFinding,
  handleManagerRemediate, handleManagerStatsFetch, handleManagerBackfill,
  handleManagerListAgents, handleManagerCreateAgent, handleManagerDeleteAgent,
  handleManagerGameState,
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
  const db = await Deno.openKv();
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
  "/admin/terminate-all": handleTerminateAll,
  "/admin/clear-review-queue": handleClearReviewQueue,
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
  "/admin/email-templates": handleSaveEmailTemplate,
  "/admin/email-templates/delete": handleDeleteEmailTemplate,
  "/webhooks/audit-complete": handleAuditCompleteWebhook,
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
  "/admin/email-templates": handleListEmailTemplates,
  "/admin/email-templates/get": handleGetEmailTemplate,
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
  "/review/api/dashboard": handleReviewDashboardData,
  "/review/api/gamification": handleReviewerGetGamification,

  // Judge (role-guarded)
  "/judge": requireRolePageAuth(["judge"], handleJudgePage),
  "/judge/api/next": handleJudgeNext,
  "/judge/api/stats": handleJudgeStats,
  "/judge/api/me": handleJudgeMe,
  "/judge/api/reviewers": handleJudgeListReviewers,
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
  "/manager/api/queue": handleManagerQueueList,
  "/manager/api/finding": handleManagerFinding,
  "/manager/api/stats": handleManagerStatsFetch,
  "/manager/api/me": handleManagerMe,
  "/manager/api/game-state": handleManagerGameState,
  "/manager/api/agents": handleManagerListAgents,
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

  return json({ ok: true, orgId }, {
    status: 200,
    headers: { "Set-Cookie": sessionCookie(token) },
  } as any);
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
  const db = await Deno.openKv();
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

  const [pipelineStats, tokens, review, appeals, recentCompleted] = await Promise.all([
    getStats(auth.orgId),
    getTokenUsage(1),
    getReviewStats(auth.orgId),
    getAppealStats(auth.orgId),
    getRecentCompleted(auth.orgId, 25),
  ]);

  return json({
    pipeline: {
      inPipe: pipelineStats.active.length,
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
    recentCompleted,
  });
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
  const { email, password, role, supervisor } = body;
  if (!email || !password) return json({ error: "email and password required" }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "email must be a valid email address" }, 400);

  const validRoles = ["admin", "judge", "manager", "reviewer", "user"];
  const userRole = validRoles.includes(role) ? role : "reviewer";

  if ((userRole === "judge" || userRole === "manager") && supervisor) {
    const sup = await getUser(auth.orgId, supervisor);
    if (!sup || sup.role !== "admin") return json({ error: "judges and managers must be assigned to an admin" }, 400);
  } else if ((userRole === "reviewer" || userRole === "user") && supervisor) {
    const sup = await getUser(auth.orgId, supervisor);
    if (!sup || (sup.role !== "judge" && sup.role !== "manager")) return json({ error: "reviewers must be assigned to a judge or manager" }, 400);
  }

  await createUser(auth.orgId, email, password, userRole as any, supervisor || undefined);
  return json({ ok: true, email, role: userRole, supervisor: supervisor || null });
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
  smite: { ping: "smite-mario-coin.mp3", double: "smite-double-kill.mp3", triple: "smite-triple-kill.mp3", mega: "smite-quadra-kill.mp3", ultra: "smite-penta-kill.mp3", rampage: "smite-rampage.mp3", godlike: "smite-godlike.mp3", levelup: "smite-unstoppable.mp3" },
  opengameart: { ping: "oga-Coin01.mp3", double: "oga-Rise01.mp3", triple: "oga-Rise02.mp3", mega: "oga-Rise03.mp3", ultra: "oga-Rise04.mp3", rampage: "oga-Rise05.mp3", godlike: "oga-Rise07.mp3", levelup: "oga-Upper01.mp3" },
  "mixkit-punchy": { ping: "mixkit-winning-coin.mp3", double: "mixkit-alert-ding.mp3", triple: "mixkit-achievement-bell.mp3", mega: "mixkit-bonus-reached.mp3", ultra: "mixkit-game-bonus.mp3", rampage: "mixkit-success-alert.mp3", godlike: "mixkit-arcade-retro.mp3", levelup: "mixkit-fairy-sparkle.mp3" },
  "mixkit-epic": { ping: "mixkit-notification.mp3", double: "mixkit-game-notification.mp3", triple: "mixkit-magic-notify.mp3", mega: "mixkit-achievement-bell.mp3", ultra: "mixkit-bonus-reached.mp3", rampage: "mixkit-arcade-retro.mp3", godlike: "mixkit-success-alert.mp3", levelup: "mixkit-fairy-sparkle.mp3" },
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

const QUEUE_NAME = "audit-pipeline";

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

async function handleGetParallelism(_req: Request): Promise<Response> {
  const res = await fetch(`${env.qstashUrl}/v2/queues/${QUEUE_NAME}`, {
    headers: { Authorization: `Bearer ${env.qstashToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    return json({ error: `QStash error: ${res.status} ${text}` }, res.status);
  }
  const data = await res.json();
  return json({ parallelism: data.parallelism ?? null });
}

async function handleSetParallelism(req: Request): Promise<Response> {
  const body = await req.json();
  const { parallelism } = body;
  if (parallelism == null || typeof parallelism !== "number" || parallelism < 1) {
    return json({ error: "parallelism must be a number >= 1" }, 400);
  }
  const res = await fetch(`${env.qstashUrl}/v2/queues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.qstashToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ queueName: QUEUE_NAME, parallelism }),
  });
  if (!res.ok) {
    const text = await res.text();
    return json({ error: `QStash error: ${res.status} ${text}` }, res.status);
  }
  return json({ ok: true, parallelism });
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
  if (!body.name || !body.recipients || !body.sections) {
    return json({ error: "name, recipients, and sections required" }, 400);
  }
  const saved = await saveEmailReportConfig(auth.orgId, body);
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

// -- Webhooks: Audit Complete Email --

async function handleAuditCompleteWebhook(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const templateId = url.searchParams.get("template");
  const testEmail = url.searchParams.get("test");
  const orgId = url.searchParams.get("org") as OrgId;

  if (!orgId) return json({ error: "org required" }, 400);

  const body = await req.json();
  const { finding, score } = body;
  if (!finding) return json({ error: "finding required" }, 400);

  const template = templateId
    ? await getEmailTemplate(orgId, templateId)
    : (await listEmailTemplates(orgId))[0];
  if (!template) return json({ error: "no template found" }, 404);

  console.log(`[WEBHOOK] finding.record keys:`, JSON.stringify(Object.keys(finding.record ?? {})));
  console.log(`[WEBHOOK] finding.record values:`, JSON.stringify(finding.record ?? {}));

  const agentEmail = finding.owner ?? "";
  // Parse VO name from QB field 144: "VO MB - Harmony Eason" → "Harmony Eason"
  const voNameRaw = String(finding.record?.VoName ?? "");
  const teamMemberFull = voNameRaw.includes(" - ")
    ? voNameRaw.split(" - ").slice(1).join(" - ").trim()
    : voNameRaw.trim();
  const teamMemberFirst = teamMemberFull.split(" ")[0] || teamMemberFull;
  const agentName = teamMemberFull ||
    (agentEmail.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()) || agentEmail);
  // QB email fields
  const voEmail = String(finding.record?.VoEmail ?? "");
  const supervisorEmail = String(finding.record?.SupervisorEmail ?? "");
  const scoreVal = score ?? (Array.isArray(finding.answeredQuestions)
    ? Math.round(finding.answeredQuestions.filter((q: any) => q.answer === "Yes").length / finding.answeredQuestions.length * 100)
    : 0);
  const findingId = finding.id ?? "";
  const recordId = String(finding.record?.RecordId ?? "");
  const isPackage = !!finding.isPackage;
  const qbTableId = isPackage ? "bu3e8x98x" : "bpb28qsnn";
  const crmUrl = recordId ? `https://${env.qbRealm}.quickbase.com/db/${qbTableId}?a=dr&rid=${recordId}` : "";

  // Dynamic score verbiage
  const scoreVerbiage = scoreVal === 100
    ? "Perfect score — great call! Review your audit below."
    : scoreVal >= 80
    ? "Strong performance overall. Check the missed questions below."
    : scoreVal >= 60
    ? "A few areas to work on. Review your missed questions below."
    : "There's room to improve here. Take a look at what was missed.";

  const allQs = Array.isArray(finding.answeredQuestions) ? finding.answeredQuestions : [];
  const missedQs = allQs.filter((q: any) => q.answer === "No");
  const passedCount = allQs.length - missedQs.length;
  const scoreColor = scoreVal === 100 ? "#3fb950" : scoreVal >= 80 ? "#58a6ff" : scoreVal >= 60 ? "#d29922" : "#f85149";
  const missedQuestionsHtml = missedQs.length
    ? missedQs.map((q: any, i: number) =>
        `<tr><td style="padding:8px 12px;border-bottom:1px solid #21262d;color:#8b949e;font-size:12px;width:32px;text-align:center;">${i + 1}</td><td style="padding:8px 12px;border-bottom:1px solid #21262d;color:#e6edf3;font-size:13px;">${q.header ?? q.question ?? "Unknown"}</td></tr>`
      ).join("")
    : `<tr><td colspan="2" style="padding:8px 12px;color:#6e7681;font-size:13px;font-style:italic;">No missed questions — perfect score!</td></tr>`;

  console.log(`[WEBHOOK] agentName="${agentName}" voEmail="${voEmail}" supervisorEmail="${supervisorEmail}" crmUrl="${crmUrl}"`);

  const vars: Record<string, string> = {
    agentName,
    agentEmail: voEmail || agentEmail,
    teamMember: teamMemberFull,
    teamMemberFirst,
    supervisorEmail,
    score: scoreVal + "%",
    scoreVerbiage,
    scoreColor,
    findingId,
    recordId,
    guestName: String(finding.record?.GuestName ?? ""),
    reportUrl: `${env.selfUrl}/audit/report?id=${findingId}`,
    recordingUrl: `${env.selfUrl}/audit/recording?id=${findingId}`,
    appealUrl: `${env.selfUrl}/audit/appeal?findingId=${findingId}`,
    feedbackText: finding.feedback?.text ?? "",
    missedQuestions: missedQuestionsHtml,
    missedCount: String(missedQs.length),
    passedCount: String(passedCount),
    totalQuestions: String(allQs.length),
    crmUrl,
  };

  const render = (str: string) => str.replace(/\{\{(\w+)\}\}/g, (_: string, k: string) => vars[k] ?? "");
  const htmlBody = render(template.html);
  const subject = render(template.subject);

  const to = testEmail || agentEmail;
  if (!to) return json({ error: "no recipient email" }, 400);

  await sendEmail({ to, subject, htmlBody });
  console.log(`[EMAIL] Audit complete email → ${to} (finding: ${findingId})`);
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

  // Pick the right step based on how far it got
  let step = "finalize";
  if (!finding.rawTranscript) {
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

// -- Admin: Terminate All Active --

async function handleTerminateAll(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  const terminated = await terminateAllActive(auth.orgId);
  console.log(`[ADMIN] ${auth.email} terminated ${terminated} active audits`);
  return json({ ok: true, terminated });
}

// -- Admin: Clear Review Queue --

async function handleClearReviewQueue(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  const { cleared } = await clearReviewQueue(auth.orgId);
  console.log(`[ADMIN] ${auth.email} cleared review queue (${cleared} KV entries deleted)`);
  return json({ ok: true, cleared });
}

// -- Admin: Init Org --

async function handleInitOrg(req: Request): Promise<Response> {
  const body = await req.json();
  const { name, email, password } = body;
  if (!name) return json({ error: "name required" }, 400);
  const db = await Deno.openKv();
  const existingDefault = await db.get<string>(["default-org"]);
  const orgId = existingDefault.value ?? await createOrg(name, name);
  await db.set(["default-org"], orgId);
  if (email && password) {
    try { await createUser(orgId, email, password, "admin"); } catch { /* already exists */ }
  }
  return json({ ok: true, orgId, name });
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
  const db = await Deno.openKv();

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

    await populateJudgeQueue(orgId, finding.id, finding.answeredQuestions);

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

async function handleSeed(_req: Request): Promise<Response> {
  const db = await Deno.openKv();

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
  const db = await Deno.openKv();
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
  const db = await Deno.openKv();
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

  const db = await Deno.openKv();
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

  const db = await Deno.openKv();
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

// -- Admin: Wipe KV --

async function handleWipeKv(_req: Request): Promise<Response> {
  const db = await Deno.openKv();
  let deleted = 0;
  const iter = db.list({ prefix: [] });
  for await (const entry of iter) {
    await db.delete(entry.key);
    deleted++;
  }
  console.log(`[ADMIN] Wiped ${deleted} KV entries`);
  return json({ ok: true, deleted });
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
        const res = await handler(req);

        // Inject impersonation bar for admin viewing role-specific pages
        const rolePageMap: Record<string, string> = {
          "/judge": "judge", "/judge/dashboard": "judge",
          "/review": "reviewer", "/review/dashboard": "reviewer",
          "/manager": "manager", "/agent": "user",
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
            sendEmail({
              to: env.alertEmail,
              subject: `[Auto-Bot] Pipeline retries exhausted: ${stepName}`,
              htmlBody: `<h3>Pipeline Step Failed</h3>
<p><b>Finding ID:</b> ${fid}</p>
<p><b>Step:</b> ${stepName}</p>
<p><b>Retries:</b> ${attempt - 1}/${pipelineCfg.maxRetries}</p>
<p><b>Error:</b></p><pre>${msg}</pre>
<p><a href="${env.selfUrl}/audit/report?id=${fid}${retryOrgId ? `&org=${retryOrgId}` : ""}">View Report</a></p>`,
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
