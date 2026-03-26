/** Question Lab route handlers. */
import {
  listConfigs, getConfig, createConfig, updateConfig, deleteConfig,
  getQuestion, getQuestionsForConfig, createQuestion, updateQuestion, deleteQuestion, restoreVersion,
  getTest, getTestsForQuestion, createTest, updateTest, deleteTest, updateTestResult,
  serveConfig, addTestRun, updateTestEmailRecipients,
} from "./kv.ts";
import { configListPage, configDetailPage, questionEditorPage } from "./page.ts";
import { askQuestion, type LlmAnswer } from "../providers/groq.ts";
import { query as vectorQuery } from "../providers/pinecone.ts";
import { resolveEffectiveAuth } from "../auth/kv.ts";
import type { AuthContext } from "../auth/kv.ts";
import { nanoid } from "npm:nanoid";
import { getDateLegByRid, getPackageByRid } from "../providers/quickbase.ts";
import { saveFinding, saveJob } from "../lib/kv.ts";
import { enqueueStep } from "../lib/queue.ts";
import type { AuditFinding, AuditJob } from "../types/mod.ts";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function html(body: string): Response {
  return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function requireAuth(req: Request): Promise<AuthContext | Response> {
  const auth = await resolveEffectiveAuth(req);
  if (!auth) return json({ error: "unauthorized" }, 401);
  return auth;
}

// ── HTML Pages ───────────────────────────────────────────────────────

export async function handleConfigListPage(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const configs = await listConfigs(auth.orgId);
  return html(configListPage(configs));
}

export async function handleConfigDetailPage(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const id = new URL(req.url).pathname.split("/").pop()!;
  const config = await getConfig(auth.orgId, id);
  if (!config) return json({ error: "config not found" }, 404);
  const questions = await getQuestionsForConfig(auth.orgId, id);
  return html(configDetailPage(config, questions));
}

export async function handleQuestionEditorPage(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const id = new URL(req.url).pathname.split("/").pop()!;
  const question = await getQuestion(auth.orgId, id);
  if (!question) return json({ error: "question not found" }, 404);
  const tests = await getTestsForQuestion(auth.orgId, id);
  return html(questionEditorPage(question, tests));
}

// ── Config API ───────────────────────────────────────────────────────

export async function handleListConfigs(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  return json(await listConfigs(auth.orgId));
}

export async function handleCreateConfig(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const body = await req.json();
  const { name, type } = body;
  if (!name) return json({ error: "name required" }, 400);
  const configType: "internal" | "partner" = type === "partner" ? "partner" : "internal";
  return json(await createConfig(auth.orgId, name, configType));
}

export async function handleUpdateConfig(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const id = new URL(req.url).pathname.split("/").pop()!;
  const body = await req.json();
  const updates: { name?: string; type?: "internal" | "partner"; active?: boolean } = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.type === "internal" || body.type === "partner") updates.type = body.type;
  if (body.active !== undefined) updates.active = Boolean(body.active);
  const result = await updateConfig(auth.orgId, id, updates);
  return result ? json(result) : json({ error: "not found" }, 404);
}

export async function handleDeleteConfig(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const id = new URL(req.url).pathname.split("/").pop()!;
  await deleteConfig(auth.orgId, id);
  return json({ ok: true });
}

// ── Question API ─────────────────────────────────────────────────────

export async function handleGetQuestion(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const id = new URL(req.url).pathname.split("/").pop()!;
  const q = await getQuestion(auth.orgId, id);
  return q ? json(q) : json({ error: "not found" }, 404);
}

export async function handleCreateQuestion(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const parts = new URL(req.url).pathname.split("/");
  // /question-lab/api/configs/:configId/questions -> configId is parts[-2]
  const configId = parts[parts.length - 2];
  const { name, text } = await req.json();
  if (!name || !text) return json({ error: "name and text required" }, 400);
  const result = await createQuestion(auth.orgId, configId, name, text);
  return result ? json(result) : json({ error: "config not found" }, 404);
}

export async function handleUpdateQuestion(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const id = new URL(req.url).pathname.split("/").pop()!;
  const body = await req.json();
  const result = await updateQuestion(auth.orgId, id, body);
  return result ? json(result) : json({ error: "not found" }, 404);
}

export async function handleDeleteQuestion(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const id = new URL(req.url).pathname.split("/").pop()!;
  await deleteQuestion(auth.orgId, id);
  return json({ ok: true });
}

export async function handleRestoreVersion(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const parts = new URL(req.url).pathname.split("/");
  // /question-lab/api/questions/:id/restore/:versionIndex
  const versionIndex = parseInt(parts.pop()!, 10);
  parts.pop(); // "restore"
  const id = parts.pop()!;
  const result = await restoreVersion(auth.orgId, id, versionIndex);
  return result ? json(result) : json({ error: "not found or invalid index" }, 404);
}

// ── Test API ─────────────────────────────────────────────────────────

export async function handleCreateTest(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const parts = new URL(req.url).pathname.split("/");
  // /question-lab/api/questions/:questionId/tests -> questionId is parts[-2]
  const questionId = parts[parts.length - 2];
  const { snippet, expected } = await req.json();
  if (!snippet || !expected) return json({ error: "snippet and expected required" }, 400);
  const result = await createTest(auth.orgId, questionId, snippet, expected);
  return result ? json(result) : json({ error: "question not found" }, 404);
}

export async function handleUpdateTest(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const id = new URL(req.url).pathname.split("/").pop()!;
  const body = await req.json();
  const result = await updateTest(auth.orgId, id, body);
  return result ? json(result) : json({ error: "not found" }, 404);
}

export async function handleDeleteTest(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const id = new URL(req.url).pathname.split("/").pop()!;
  await deleteTest(auth.orgId, id);
  return json({ ok: true });
}

// ── Simulate (SSE) ──────────────────────────────────────────────────

export async function handleSimulate(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const { questionText, testIds } = await req.json() as { questionText: string; testIds: string[] };

  const orgId = auth.orgId;
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const write = (data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

      const promises = testIds.map(async (testId) => {
        try {
          const test = await getTest(orgId, testId);
          if (!test) return;

          const answer: LlmAnswer = await askQuestion(questionText, test.snippet);
          const answerStr = String(answer.answer ?? "");
          const thinkingStr = String(answer.thinking ?? "");
          const defenseStr = String(answer.defense ?? "");
          const answerNorm = answerStr.trim().toLowerCase();
          const isYes = answerNorm.startsWith("yes") || answerNorm === "true" || answerNorm === "y" || answerNorm === "1";
          const status = (isYes && test.expected === "yes") || (!isYes && test.expected === "no")
            ? "pass" as const
            : "fail" as const;

          await updateTestResult(orgId, testId, status, answerStr, thinkingStr, defenseStr);
          write({ testId, status, answer: answerStr, thinking: thinkingStr, defense: defenseStr });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[QuestionLab] Simulate error for test ${testId}: ${msg}`);
          write({ testId, status: "fail", answer: "Error: " + msg, thinking: "", defense: "" });
        }
      });

      await Promise.all(promises);
      write({ done: true });
      controller.close();
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

// ── Snippet Retrieval ────────────────────────────────────────────────

export async function handleGetSnippet(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const url = new URL(req.url);
  const findingId = url.searchParams.get("findingId");
  const questionText = url.searchParams.get("questionText");
  if (!findingId || !questionText) return json({ error: "findingId and questionText required" }, 400);
  try {
    const snippet = await vectorQuery(findingId, questionText);
    return json({ snippet });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg });
  }
}

// ── Test Audit ───────────────────────────────────────────────────────

export async function handleRunTestAudit(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const { configId, rid, type } = await req.json() as { configId: string; rid: string; type: "internal" | "partner" };
  if (!configId || !rid || !type) return json({ error: "configId, rid, type required" }, 400);

  const config = await getConfig(auth.orgId, configId);
  if (!config) return json({ error: "config not found" }, 404);

  const recipients = config.testEmailRecipients ?? ["ai@monsterrg.com"];
  const record = type === "partner"
    ? (await getPackageByRid(rid) ?? { RecordId: rid })
    : (await getDateLegByRid(rid) ?? { RecordId: rid });
  const recordingIdField = type === "partner" ? "GenieNumber" : "VoGenie";

  const jobId = nanoid();
  const job: AuditJob = {
    id: jobId,
    doneAuditIds: [],
    status: "running",
    timestamp: new Date().toISOString(),
    owner: "question-lab-test",
    updateEndpoint: "none",
    recordsToAudit: [rid],
  };
  await saveJob(auth.orgId, job);

  const findingId = nanoid();
  const rawRecordingId = record[recordingIdField] ? String(record[recordingIdField]) : undefined;
  const finding: AuditFinding = {
    id: findingId,
    auditJobId: jobId,
    findingStatus: "pending",
    feedback: { heading: "", text: "", viewUrl: "" },
    job,
    record,
    recordingIdField,
    recordingId: rawRecordingId,
    owner: "question-lab-test",
    updateEndpoint: "none",
    qlabConfig: config.name,
    isTest: true,
    testEmailRecipients: recipients,
  };
  await saveFinding(auth.orgId, finding);
  await enqueueStep("init", { findingId, orgId: auth.orgId });

  await addTestRun(auth.orgId, configId, {
    findingId,
    rid,
    type,
    startedAt: new Date().toISOString(),
  });

  console.log(`[QLAB] Test audit started: config=${config.name} rid=${rid} type=${type} finding=${findingId}`);
  return json({ findingId });
}

export async function handleGetTestRuns(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const parts = new URL(req.url).pathname.split("/");
  const configId = parts[parts.length - 1];
  const config = await getConfig(auth.orgId, configId);
  if (!config) return json({ error: "not found" }, 404);
  return json(config.testRuns ?? []);
}

export async function handleUpdateTestEmails(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const parts = new URL(req.url).pathname.split("/");
  // /question-lab/api/configs/:id/test-emails → id is parts[-2]
  const configId = parts[parts.length - 2];
  const { emails } = await req.json() as { emails: string[] };
  if (!Array.isArray(emails)) return json({ error: "emails array required" }, 400);
  const result = await updateTestEmailRecipients(auth.orgId, configId, emails);
  return result ? json(result) : json({ error: "not found" }, 404);
}

// ── CSV Import ──────────────────────────────────────────────────────

interface ImportConfig {
  name: string;
  type: "internal" | "partner";
  questions: Array<{ name: string; text: string; autoYesExp: string }>;
}

export async function handleImport(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const { configs } = await req.json() as { configs: ImportConfig[] };
  if (!Array.isArray(configs) || configs.length === 0) return json({ error: "configs array required" }, 400);

  let configCount = 0;
  let questionCount = 0;

  for (const cfg of configs) {
    if (!cfg.name || !Array.isArray(cfg.questions)) continue;
    const configType: "internal" | "partner" = cfg.type === "partner" ? "partner" : "internal";
    const config = await createConfig(auth.orgId, cfg.name, configType);
    configCount++;

    for (const q of cfg.questions) {
      if (!q.name || !q.text) continue;
      const question = await createQuestion(auth.orgId, config.id, q.name, q.text);
      if (question && q.autoYesExp) {
        await updateQuestion(auth.orgId, question.id, { autoYesExp: q.autoYesExp });
      }
      if (question) questionCount++;
    }
  }

  console.log(`[QLAB] 📦 CSV import: ${configCount} configs, ${questionCount} questions by ${auth.orgId}`);
  return json({ ok: true, created: { configs: configCount, questions: questionCount } });
}

// ── Serve Config ─────────────────────────────────────────────────────

export async function handleServeConfig(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const configNameOrId = new URL(req.url).pathname.split("/").pop()!;
  return json(await serveConfig(auth.orgId, configNameOrId));
}

// ── Router ───────────────────────────────────────────────────────────

type Route = { pattern: URLPattern; handler: (req: Request) => Promise<Response> };

function route(method: string, path: string, handler: (req: Request) => Promise<Response>): Route & { method: string } {
  return { method, pattern: new URLPattern({ pathname: path }), handler };
}

const routes = [
  // HTML pages
  route("GET", "/question-lab", handleConfigListPage),
  route("GET", "/question-lab/config/:id", handleConfigDetailPage),
  route("GET", "/question-lab/question/:id", handleQuestionEditorPage),

  // Config API
  route("GET", "/question-lab/api/configs", handleListConfigs),
  route("POST", "/question-lab/api/configs", handleCreateConfig),
  route("PUT", "/question-lab/api/configs/:id", handleUpdateConfig),
  route("DELETE", "/question-lab/api/configs/:id", handleDeleteConfig),

  // Question API
  route("GET", "/question-lab/api/questions/:id", handleGetQuestion),
  route("POST", "/question-lab/api/configs/:configId/questions", handleCreateQuestion),
  route("PUT", "/question-lab/api/questions/:id", handleUpdateQuestion),
  route("DELETE", "/question-lab/api/questions/:id", handleDeleteQuestion),
  route("POST", "/question-lab/api/questions/:id/restore/:versionIndex", handleRestoreVersion),

  // Test API
  route("POST", "/question-lab/api/questions/:questionId/tests", handleCreateTest),
  route("PUT", "/question-lab/api/tests/:id", handleUpdateTest),
  route("DELETE", "/question-lab/api/tests/:id", handleDeleteTest),

  // Simulate
  route("POST", "/question-lab/api/simulate", handleSimulate),

  // Snippet + Serve
  route("GET", "/question-lab/api/snippet", handleGetSnippet),
  route("GET", "/question-lab/api/serve/:configNameOrId", handleServeConfig),

  // Import
  route("POST", "/question-lab/api/import", handleImport),

  // Test Audit
  route("POST", "/question-lab/api/run-test-audit", handleRunTestAudit),
  route("GET", "/question-lab/api/test-runs/:configId", handleGetTestRuns),
  route("PUT", "/question-lab/api/configs/:id/test-emails", handleUpdateTestEmails),
];

export async function routeQuestionLab(req: Request): Promise<Response> {
  const url = new URL(req.url);
  for (const r of routes) {
    if (r.method !== req.method) continue;
    if (r.pattern.test(url)) return await r.handler(req);
  }
  return json({ error: "not found" }, 404);
}
