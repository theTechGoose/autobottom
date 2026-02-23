import { stepInit } from "./steps/init.ts";
import { stepTranscribe } from "./steps/transcribe.ts";
import { stepTranscribeCb } from "./steps/transcribe-cb.ts";
import { stepPrepare } from "./steps/prepare.ts";
import { stepAskBatch } from "./steps/ask-batch.ts";
import { stepFinalize } from "./steps/finalize.ts";
import { stepCleanup } from "./steps/cleanup.ts";
import { handleAuditByRid, handlePackageByRid, handleGetFinding, handleGetReport, handleGetStats, handleGetRecording, handleFileAppeal, handleAppealStatus, handleAppealDifferentGenie, handleAppealUploadRecording } from "./controller.ts";
import { getTokenUsage } from "./providers/groq.ts";
import { getOpenApiSpec, getSwaggerHtml, getDocsIndexHtml } from "./swagger.ts";
import { enqueueStep } from "./lib/queue.ts";
import { trackError, trackRetry, trackCompleted, getStats, getPipelineConfig, setPipelineConfig, saveFinding, saveTranscript, saveBatchAnswers } from "./lib/kv.ts";
import { sendEmail } from "./providers/postmark.ts";
import { env } from "./env.ts";
import {
  handleReviewPage, handleNext, handleGetSettings, handleStats,
  handleLogin, handleLogout, handleDecide, handleBack,
  handleSaveSettings, handleAddUser, handleSetup, handleBackfill,
} from "./review/handlers.ts";
import { routeQuestionLab } from "./question-lab/handlers.ts";
import { getDashboardPage } from "./dashboard/page.ts";
import { getReviewStats, createUser, listUsers, populateReviewQueue } from "./review/kv.ts";
import { getWebhookConfig, saveWebhookConfig, listEmailReportConfigs, saveEmailReportConfig, deleteEmailReportConfig } from "./lib/kv.ts";
import type { WebhookConfig, WebhookKind } from "./lib/kv.ts";
import {
  handleJudgePage,
  handleNext as handleJudgeNext,
  handleStats as handleJudgeStats,
  handleLogin as handleJudgeLogin,
  handleLogout as handleJudgeLogout,
  handleDecide as handleJudgeDecide,
  handleBack as handleJudgeBack,
  handleSetup as handleJudgeSetup,
  handleAddUser as handleJudgeAddUser,
  handleDashboardPage as handleJudgeDashboardPage,
  handleDashboardData as handleJudgeDashboardData,
} from "./judge/handlers.ts";
import { getAppealStats, createUser as createJudgeUser } from "./judge/kv.ts";
import {
  handleManagerPage, handleManagerLogin, handleManagerLogout,
  handleManagerAddUser, handleManagerMe, handleManagerQueueList, handleManagerFinding,
  handleManagerRemediate, handleManagerStatsFetch, handleManagerBackfill,
} from "./manager/handlers.ts";

type Handler = (req: Request) => Promise<Response>;

const postRoutes: Record<string, Handler> = {
  // Pipeline steps (called by QStash)
  "/audit/step/init": stepInit,
  "/audit/step/transcribe": stepTranscribe,
  "/audit/step/transcribe-complete": stepTranscribeCb,
  "/audit/step/prepare": stepPrepare,
  "/audit/step/ask-batch": stepAskBatch,
  "/audit/step/finalize": stepFinalize,
  "/audit/step/cleanup": stepCleanup,

  // API endpoints (called by external callers)
  "/audit/test-by-rid": handleAuditByRid,
  "/audit/package-by-rid": handlePackageByRid,

  // Admin
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
  "/admin/judges": handleAdminAddJudge,
  "/admin/parallelism": handleSetParallelism,
  "/admin/email-reports": handleSaveEmailReport,
  "/admin/email-reports/delete": handleDeleteEmailReport,
  "/admin/reset-finding": handleResetFinding,

  // Appeal
  "/audit/appeal": handleFileAppeal,
  "/audit/appeal/different-genie": handleAppealDifferentGenie,
  "/audit/appeal/upload-recording": handleAppealUploadRecording,

  // Review API
  "/review/api/login": handleLogin,
  "/review/api/logout": handleLogout,
  "/review/api/decide": handleDecide,
  "/review/api/back": handleBack,
  "/review/api/settings": handleSaveSettings,
  "/review/api/users": handleAddUser,
  "/review/api/setup": handleSetup,
  "/review/api/backfill": handleBackfill,

  // Judge API
  "/judge/api/login": handleJudgeLogin,
  "/judge/api/logout": handleJudgeLogout,
  "/judge/api/decide": handleJudgeDecide,
  "/judge/api/back": handleJudgeBack,
  "/judge/api/setup": handleJudgeSetup,
  "/judge/api/users": handleJudgeAddUser,

  // Manager API
  "/manager/api/login": handleManagerLogin,
  "/manager/api/logout": handleManagerLogout,
  "/manager/api/users": handleManagerAddUser,
  "/manager/api/remediate": handleManagerRemediate,
  "/manager/api/backfill": handleManagerBackfill,
};

const getRoutes: Record<string, Handler> = {
  "/sound-test": async () => new Response(await Deno.readFile(new URL("./sound-test.html", import.meta.url)), { headers: { "Content-Type": "text/html" } }),
  "/": handleDemoPage,
  "/audit/finding": handleGetFinding,
  "/audit/report": handleGetReport,
  "/audit/stats": handleGetStats,
  "/audit/recording": handleGetRecording,
  "/audit/appeal/status": handleAppealStatus,
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

  // Review
  "/review": handleReviewPage,
  "/review/api/next": handleNext,
  "/review/api/settings": handleGetSettings,
  "/review/api/stats": handleStats,

  // Judge
  "/judge": handleJudgePage,
  "/judge/api/next": handleJudgeNext,
  "/judge/api/stats": handleJudgeStats,
  "/judge/dashboard": handleJudgeDashboardPage,
  "/judge/api/dashboard": handleJudgeDashboardData,

  // Dashboard
  "/admin/dashboard": handleDashboardPage,
  "/admin/dashboard/data": handleDashboardData,

  // Manager
  "/manager": handleManagerPage,
  "/manager/api/queue": handleManagerQueueList,
  "/manager/api/finding": handleManagerFinding,
  "/manager/api/stats": handleManagerStatsFetch,
  "/manager/api/me": handleManagerMe,
};

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

async function handleDemoPage(_req: Request): Promise<Response> {
  // Find first seeded finding ID for the report link
  const db = await Deno.openKv();
  let reportId = "";
  const iter = db.list({ prefix: ["audit-finding"] });
  for await (const entry of iter) {
    if (entry.key.length >= 2 && typeof entry.key[1] === "string") {
      reportId = entry.key[1] as string;
      break;
    }
  }
  const reportHref = reportId ? `/audit/report?id=${reportId}` : `/audit/report?id=demo`;

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
  .i-admin{background:rgba(31,111,235,0.12);color:#58a6ff}
  .i-review{background:rgba(139,92,246,0.12);color:#bc8cff}
  .i-judge{background:rgba(210,153,34,0.12);color:#d29922}
  .i-manager{background:rgba(121,192,255,0.12);color:#79c0ff}
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
    <a href="/admin/dashboard">
      <div class="icon i-admin">&#9881;</div>
      <div><div class="label">Admin Dashboard</div><div class="desc">Pipeline stats, config, user management</div></div>
      <span class="arrow">&rsaquo;</span>
    </a>
    <a href="/review">
      <div class="icon i-review">&#9654;</div>
      <div><div class="label">Review Queue</div><div class="desc">Human-in-the-loop audit verification</div></div>
      <span class="arrow">&rsaquo;</span>
    </a>
    <a href="/judge">
      <div class="icon i-judge">&#9878;</div>
      <div><div class="label">Judge Panel</div><div class="desc">Appeal decisions and dispute resolution</div></div>
      <span class="arrow">&rsaquo;</span>
    </a>
    <a href="/manager">
      <div class="icon i-manager">&#9636;</div>
      <div><div class="label">Manager Portal</div><div class="desc">Failure remediation and tracking</div></div>
      <span class="arrow">&rsaquo;</span>
    </a>
    <a href="/question-lab">
      <div class="icon i-qlab">&#9879;</div>
      <div><div class="label">Question Lab</div><div class="desc">Build and test audit question configs</div></div>
      <span class="arrow">&rsaquo;</span>
    </a>
    <a href="${reportHref}">
      <div class="icon i-report">&#9776;</div>
      <div><div class="label">Audit Report</div><div class="desc">View a finding report by ID</div></div>
      <span class="arrow">&rsaquo;</span>
    </a>
  </div>
</div>
</body>
</html>`);
}

async function handleDashboardPage(_req: Request): Promise<Response> {
  return html(getDashboardPage());
}

async function handleDashboardData(_req: Request): Promise<Response> {
  const [pipelineStats, tokens, review, appeals] = await Promise.all([
    getStats(),
    getTokenUsage(1),
    getReviewStats(),
    getAppealStats(),
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
  });
}

async function handleAdminAddJudge(req: Request): Promise<Response> {
  const body = await req.json();
  const { username, password } = body;
  if (!username || !password) return json({ error: "username and password required" }, 400);
  await createJudgeUser(username, password);
  return json({ ok: true, username });
}

async function handleForceNos(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const findingId = url.searchParams.get("id");
  if (!findingId) return json({ error: "id required" }, 400);

  const { getFinding: getF } = await import("./lib/kv.ts");
  const finding = await getF(findingId);
  if (!finding) return json({ error: "finding not found" }, 404);
  if (!finding.answeredQuestions?.length) return json({ error: "no answered questions yet" }, 400);

  // Flip all Yes to No
  let flipped = 0;
  for (const q of finding.answeredQuestions) {
    if (q.answer === "Yes") {
      q.answer = "No";
      q.thinking = "[FORCED NO FOR TESTING] " + (q.thinking || "");
      flipped++;
    }
  }
  await saveFinding(finding);

  // Populate review queue
  await populateReviewQueue(findingId, finding.answeredQuestions);

  return json({ ok: true, flipped, totalNos: finding.answeredQuestions.filter((q: any) => q.answer === "No").length });
}

async function handleTokenUsage(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const hours = Number(url.searchParams.get("hours") ?? "1");
  const usage = await getTokenUsage(hours);
  return json(usage);
}

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

async function handleGetPipelineConfig(_req: Request): Promise<Response> {
  return json(await getPipelineConfig());
}

async function handleSetPipelineConfig(req: Request): Promise<Response> {
  const body = await req.json();
  const update: Record<string, number> = {};
  if (typeof body.maxRetries === "number") update.maxRetries = body.maxRetries;
  if (typeof body.retryDelaySeconds === "number") update.retryDelaySeconds = body.retryDelaySeconds;
  if (Object.keys(update).length === 0) {
    return json({ error: "provide maxRetries and/or retryDelaySeconds" }, 400);
  }
  const result = await setPipelineConfig(update);
  return json(result);
}

// -- Admin endpoints (no auth) --

const QUEUE_NAME = "audit-pipeline";

async function handleAdminGetSettings(req: Request): Promise<Response> {
  const kind = extractSettingsKind(req);
  if (!kind) return json({ error: "kind must be terminate, appeal, or manager" }, 400);
  const config = await getWebhookConfig(kind);
  return json(config ?? { postUrl: "", postHeaders: {} });
}

async function handleAdminSaveSettings(req: Request): Promise<Response> {
  const kind = extractSettingsKind(req);
  if (!kind) return json({ error: "kind must be terminate, appeal, or manager" }, 400);
  const body = await req.json();
  const config: WebhookConfig = {
    postUrl: body.postUrl ?? "",
    postHeaders: body.postHeaders ?? {},
  };
  await saveWebhookConfig(kind, config);
  return json({ ok: true });
}

function extractSettingsKind(req: Request): WebhookKind | null {
  const url = new URL(req.url);
  const parts = url.pathname.split("/");
  // /admin/settings/:kind -> parts = ["", "admin", "settings", kind]
  const kind = parts[3];
  const kindMap: Record<string, WebhookKind> = {
    terminate: "terminate", review: "terminate",
    appeal: "appeal", judge: "appeal",
    manager: "manager",
    "judge-finish": "judge",
  };
  return kindMap[kind] ?? null;
}

async function handleAdminListUsers(_req: Request): Promise<Response> {
  const users = await listUsers();
  return json(users);
}

async function handleAdminAddUser(req: Request): Promise<Response> {
  const body = await req.json();
  const { username, password, role, supervisor } = body;
  if (!username || !password) return json({ error: "username and password required" }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)) return json({ error: "username must be a valid email address" }, 400);
  const validRoles = ["reviewer", "judge", "manager"];
  const userRole = validRoles.includes(role) ? role : "reviewer";
  // Create in review auth (all roles get review access)
  await createUser(username, password, userRole, supervisor || undefined);
  // If judge, also create in judge auth namespace
  if (userRole === "judge") {
    await createJudgeUser(username, password);
  }
  // If manager, also create in manager auth namespace
  if (userRole === "manager") {
    const { createManagerUser } = await import("./manager/kv.ts");
    await createManagerUser(username, password);
  }
  return json({ ok: true, username, role: userRole, supervisor: supervisor || null });
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

async function handleListEmailReports(_req: Request): Promise<Response> {
  const configs = await listEmailReportConfigs();
  return json(configs);
}

async function handleSaveEmailReport(req: Request): Promise<Response> {
  const body = await req.json();
  if (!body.name || !body.recipients || !body.sections) {
    return json({ error: "name, recipients, and sections required" }, 400);
  }
  const saved = await saveEmailReportConfig(body);
  return json(saved);
}

async function handleDeleteEmailReport(req: Request): Promise<Response> {
  const body = await req.json();
  if (!body.id) return json({ error: "id required" }, 400);
  await deleteEmailReportConfig(body.id);
  return json({ ok: true });
}

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

async function handleSeed(_req: Request): Promise<Response> {
  const findings = await loadSeedData();
  const { createManagerUser, populateManagerQueue, submitRemediation } = await import("./manager/kv.ts");
  const db = await Deno.openKv();
  let seeded = 0;

  for (const finding of findings) {
    // 0. Set test recording path (demo mp3 uploaded to S3)
    finding.recordingPath = "test-recordings/demo-recording.mp3";

    // 1. Save finding (chunked)
    await saveFinding(finding);

    // 2. Save transcript (chunked)
    if (finding.rawTranscript) {
      await saveTranscript(finding.id, finding.rawTranscript, finding.diarizedTranscript);
    }

    // 3. Save answered questions as batch 0
    if (finding.answeredQuestions?.length) {
      await saveBatchAnswers(finding.id, 0, finding.answeredQuestions);
    }

    // 4. Populate review queue for "No" answers
    if (finding.answeredQuestions?.length) {
      await populateReviewQueue(finding.id, finding.answeredQuestions);
    }

    // 5. Track as completed
    await trackCompleted(finding.id);

    seeded++;
    console.log(`[SEED] ${seeded}/${findings.length} — ${finding.id}`);
  }

  // -- Manager seed data --
  // Create manager user admin/admin
  await createManagerUser("admin", "admin");
  console.log("[SEED] Created manager user admin/admin");

  // Simulate completed reviews for ~12 findings and populate manager queue
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const reviewers = ["reviewer1", "reviewer2", "reviewer3"];
  let managerSeeded = 0;

  for (let i = 0; i < Math.min(12, findings.length); i++) {
    const finding = findings[i];
    const noQuestions = (finding.answeredQuestions ?? [])
      .map((q: any, idx: number) => ({ ...q, idx }))
      .filter((q: any) => q.answer === "No");

    if (noQuestions.length === 0) continue;

    // Clear review-pending entries (simulate reviewer completing them)
    for (const q of noQuestions) {
      await db.delete(["review-pending", finding.id, q.idx]);
    }
    await db.delete(["review-audit-pending", finding.id]);

    // Write review-decided entries: confirm most, flip a few
    const reviewer = reviewers[i % reviewers.length];
    const completedAt = now - Math.floor(Math.random() * 8 * WEEK_MS);
    for (const q of noQuestions) {
      const decision = Math.random() < 0.75 ? "confirm" : "flip";
      await db.set(["review-decided", finding.id, q.idx], {
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

    // Populate manager queue
    await populateManagerQueue(finding.id);

    // Override completedAt to spread across weeks for trend data
    const queueEntry = await db.get(["manager-queue", finding.id]);
    if (queueEntry.value) {
      const updated = { ...(queueEntry.value as Record<string, any>), completedAt };
      await db.set(["manager-queue", finding.id], updated);
    }

    // Remediate ~half of them
    if (i < 6) {
      const remediatedAt = completedAt + Math.floor(Math.random() * 3 * DAY_MS);
      await submitRemediation(
        finding.id,
        [
          "Spoke with agent about proper greeting protocol. Agent acknowledged the gap and will follow the script going forward.",
          "Coached agent on verification steps. Reviewed call together and identified where they skipped the ID check. Written warning issued.",
          "Agent was already aware of the issue. Discussed alternative phrasing for disclosure requirements. No further action needed.",
          "Scheduled 1-on-1 coaching session. Agent needs refresher on cancellation policy disclosure. Follow-up audit in 2 weeks.",
          "Team meeting held to address this pattern. Updated the call script to make the required step more prominent.",
          "Agent terminated after repeated failures on compliance questions. This was the third offense in 30 days.",
        ][i],
        "admin",
      );
      // Backdate the remediation
      const remEntry = await db.get(["manager-remediation", finding.id]);
      if (remEntry.value) {
        const updated = { ...(remEntry.value as Record<string, any>), addressedAt: remediatedAt };
        await db.set(["manager-remediation", finding.id], updated);
      }
    }

    managerSeeded++;
  }

  console.log(`[SEED] Manager queue seeded: ${managerSeeded} items`);

  // -- Judge / Appeal seed data --
  const { populateJudgeQueue, saveAppeal, recordDecision: recordJudgeDecision, createUser: createJudgeUserSeed } = await import("./judge/kv.ts");

  // Create judge users
  await createJudgeUserSeed("judge1", "judge1");
  await createJudgeUserSeed("judge2", "judge2");
  console.log("[SEED] Created judge users judge1/judge1, judge2/judge2");

  const judges = ["judge1", "judge2"];
  const auditors = ["auditor1", "auditor2", "auditor3", "auditor4", "auditor5"];
  let judgeSeeded = 0;

  // Pick a subset of findings for appeals (use indices 2-9 to avoid overlap issues)
  const appealFindings = findings.slice(2, 10);
  for (let i = 0; i < appealFindings.length; i++) {
    const finding = appealFindings[i];
    if (!finding.answeredQuestions?.length) continue;

    const auditor = auditors[i % auditors.length];
    finding.owner = auditor;
    await saveFinding(finding);

    // File appeal
    const appealedAt = now - Math.floor(Math.random() * 6 * WEEK_MS);
    const isComplete = i < 6; // first 6 are completed, last 2 pending

    await saveAppeal({
      findingId: finding.id,
      appealedAt,
      status: isComplete ? "complete" : "pending",
      judgedBy: isComplete ? judges[i % judges.length] : undefined,
      auditor,
    });

    // Populate judge queue
    await populateJudgeQueue(finding.id, finding.answeredQuestions);

    if (isComplete) {
      // Simulate judge decisions: uphold most, overturn a few
      const judge = judges[i % judges.length];
      for (let qi = 0; qi < finding.answeredQuestions.length; qi++) {
        // Overturn ~20% of questions
        const decision = Math.random() < 0.2 ? "overturn" as const : "uphold" as const;
        await recordJudgeDecision(finding.id, qi, decision, judge);
      }
    }

    judgeSeeded++;
    console.log(`[SEED] Judge appeal ${judgeSeeded}: ${finding.id} (${isComplete ? "complete" : "pending"})`);
  }

  console.log(`[SEED] Judge seeded: ${judgeSeeded} appeals`);

  // -- Question Lab seed data --
  const qlabKv = await import("./question-lab/kv.ts");

  const config = await qlabKv.createConfig("Verification Audit");

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
    const question = await qlabKv.createQuestion(config.id, qData.name, qData.text);
    if (!question) continue;
    if (qData.autoYesExp) {
      await qlabKv.updateQuestion(question.id, { autoYesExp: qData.autoYesExp });
    }
    for (const t of qData.tests) {
      await qlabKv.createTest(question.id, t.snippet, t.expected);
      qlabSeeded++;
    }
  }

  console.log(`[SEED] Question Lab seeded: ${questionsData.length} questions, ${qlabSeeded} tests in config "${config.name}"`);

  return json({ ok: true, seeded, managerSeeded, judgeSeeded, qlabSeeded });
}

async function handleResetFinding(req: Request): Promise<Response> {
  const body = await req.json();
  const { findingId } = body;
  if (!findingId) return json({ error: "findingId required" }, 400);

  const db = await Deno.openKv();
  let deleted = 0;

  // Prefixes that store per-finding data (with sub-keys like questionIndex)
  const listPrefixes = [
    ["review-pending", findingId],
    ["review-decided", findingId],
    ["review-lock", findingId],
    ["judge-pending", findingId],
    ["judge-decided", findingId],
    ["judge-lock", findingId],
  ];
  for (const prefix of listPrefixes) {
    for await (const entry of db.list({ prefix })) {
      await db.delete(entry.key);
      deleted++;
    }
  }

  // Exact keys (no sub-keys)
  const exactKeys: Deno.KvKey[] = [
    ["review-audit-pending", findingId],
    ["judge-audit-pending", findingId],
    ["appeal", findingId],
    ["manager-queue", findingId],
    ["manager-remediation", findingId],
  ];
  for (const key of exactKeys) {
    const entry = await db.get(key);
    if (entry.versionstamp) {
      await db.delete(key);
      deleted++;
    }
  }

  // Re-populate review queue from the finding's answered questions
  let queued = 0;
  const { getAllAnswersForFinding } = await import("./lib/kv.ts");
  const answers = await getAllAnswersForFinding(findingId);
  if (answers?.length) {
    await populateReviewQueue(findingId, answers);
    queued = answers.filter((q: any) => q.answer === "No").length;
  }

  console.log(`[ADMIN] Reset finding ${findingId}: ${deleted} deleted, ${queued} re-queued`);
  return json({ ok: true, deleted, queued, findingId });
}

async function handleWipeKv(_req: Request): Promise<Response> {
  const db = await Deno.openKv();
  let deleted = 0;
  const iter = db.list({ prefix: [] });
  for await (const entry of iter) {
    await db.delete(entry.key);
    deleted++;
  }
  console.log(`[ADMIN] Wiped ${deleted} KV entries`);
  return new Response(JSON.stringify({ ok: true, deleted }), {
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Health check
  if (url.pathname === "/health") {
    return json({ ok: true, ts: Date.now() });
  }

  // Serve sound files
  if (req.method === "GET" && url.pathname.startsWith("/sounds/")) {
    const name = url.pathname.replace("/sounds/", "");
    if (!/^[\w\-.]+\.mp3$/.test(name)) return json({ error: "bad name" }, 400);
    try {
      const bytes = await Deno.readFile(new URL("./sounds/" + name, import.meta.url));
      return new Response(bytes, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=86400" } });
    } catch { return json({ error: "not found" }, 404); }
  }

  // GET routes
  if (req.method === "GET") {
    const handler = getRoutes[url.pathname];
    if (handler) {
      try {
        const res = await handler(req);
        // Inject reseed button on HTML pages when ?local is present
        if (url.searchParams.has("local") && res.headers.get("content-type")?.includes("text/html")) {
          const body = await res.text();
          const findingId = url.searchParams.get("id") || "";
          const reseedSnippet = `<div id="dev-bar" style="position:fixed;top:0;left:0;right:0;z-index:9999;display:flex;align-items:center;gap:8px;padding:4px 12px;background:rgba(30,39,54,0.95);border-bottom:1px solid #2d333b;font-size:11px;font-family:-apple-system,sans-serif;backdrop-filter:blur(8px);">
<span style="color:#484f58;font-weight:700;letter-spacing:1px;text-transform:uppercase;font-size:9px;">DEV</span>
<button onclick="devReseed()" style="background:#1f6feb;color:#fff;border:none;border-radius:4px;padding:2px 10px;font-size:10px;font-weight:600;cursor:pointer;">Reseed All</button>
${findingId ? `<button onclick="devResetFinding('${findingId.replace(/'/g, "\\\\'")}')" style="background:#8b5cf6;color:#fff;border:none;border-radius:4px;padding:2px 10px;font-size:10px;font-weight:600;cursor:pointer;">Reset This Finding</button>` : ""}
<span id="dev-status" style="color:#6e7681;"></span>
</div>
<script>
function devReseed(){document.getElementById('dev-status').textContent='Reseeding...';fetch('/admin/seed',{method:'POST'}).then(function(r){return r.json()}).then(function(d){document.getElementById('dev-status').textContent='Done: '+d.seeded+' seeded';setTimeout(function(){location.reload()},600)}).catch(function(e){document.getElementById('dev-status').textContent='Error: '+e.message})}
function devResetFinding(id){document.getElementById('dev-status').textContent='Resetting...';fetch('/admin/reset-finding',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({findingId:id})}).then(function(r){return r.json()}).then(function(d){document.getElementById('dev-status').textContent='Reset: '+d.deleted+' deleted, '+d.queued+' re-queued';setTimeout(function(){location.reload()},600)}).catch(function(e){document.getElementById('dev-status').textContent='Error: '+e.message})}
</script>`;
          const injected = body.replace("</body>", reseedSnippet + "</body>");
          return new Response(injected, { status: res.status, headers: res.headers });
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
      // Clone body before handler consumes the stream
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
          const pipelineCfg = await getPipelineConfig();
          const attempt = (bodyForRetry._retry ?? 0) + 1;
          const stepName = url.pathname.replace("/audit/step/", "");
          const fid = bodyForRetry.findingId ?? "unknown";

          // Track error
          trackError(fid, stepName, msg).catch(() => {});

          if (attempt <= pipelineCfg.maxRetries) {
            const is429 = msg.includes("429") || msg.toLowerCase().includes("rate limit");
            const delay = is429 ? pipelineCfg.retryDelaySeconds : undefined;
            console.warn(`[${url.pathname}] Re-enqueuing (attempt ${attempt}/${pipelineCfg.maxRetries})${is429 ? ` [429 delay ${pipelineCfg.retryDelaySeconds}s]` : ""}`);
            trackRetry(fid, stepName, attempt).catch(() => {});
            try {
              const retryBody = { ...bodyForRetry, _retry: attempt };
              await enqueueStep(stepName, retryBody, delay);
            } catch (requeueErr) {
              console.error(`[${url.pathname}] Failed to re-enqueue:`, requeueErr);
            }
          } else {
            console.error(`[${url.pathname}] Max retries (${pipelineCfg.maxRetries}) exhausted for findingId=${fid}`);
            trackCompleted(fid).catch(() => {});
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
          // Return 200 so QStash releases the slot immediately
          return json({ error: msg, retried: attempt <= pipelineCfg.maxRetries, attempt }, 200);
        }

        return json({ error: msg }, 500);
      }
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
