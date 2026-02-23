/** Question Lab route handlers. */
import {
  listConfigs, getConfig, createConfig, updateConfig, deleteConfig,
  getQuestion, getQuestionsForConfig, createQuestion, updateQuestion, deleteQuestion, restoreVersion,
  getTest, getTestsForQuestion, createTest, updateTest, deleteTest, updateTestResult,
  serveConfig,
} from "./kv.ts";
import { configListPage, configDetailPage, questionEditorPage } from "./page.ts";
import { askQuestion, type LlmAnswer } from "../providers/groq.ts";
import { query as vectorQuery } from "../providers/pinecone.ts";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function html(body: string): Response {
  return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

// ── HTML Pages ───────────────────────────────────────────────────────

export async function handleConfigListPage(_req: Request): Promise<Response> {
  const configs = await listConfigs();
  return html(configListPage(configs));
}

export async function handleConfigDetailPage(req: Request): Promise<Response> {
  const id = new URL(req.url).pathname.split("/").pop()!;
  const config = await getConfig(id);
  if (!config) return json({ error: "config not found" }, 404);
  const questions = await getQuestionsForConfig(id);
  return html(configDetailPage(config, questions));
}

export async function handleQuestionEditorPage(req: Request): Promise<Response> {
  const id = new URL(req.url).pathname.split("/").pop()!;
  const question = await getQuestion(id);
  if (!question) return json({ error: "question not found" }, 404);
  const tests = await getTestsForQuestion(id);
  return html(questionEditorPage(question, tests));
}

// ── Config API ───────────────────────────────────────────────────────

export async function handleListConfigs(_req: Request): Promise<Response> {
  return json(await listConfigs());
}

export async function handleCreateConfig(req: Request): Promise<Response> {
  const { name } = await req.json();
  if (!name) return json({ error: "name required" }, 400);
  return json(await createConfig(name));
}

export async function handleUpdateConfig(req: Request): Promise<Response> {
  const id = new URL(req.url).pathname.split("/").pop()!;
  const { name } = await req.json();
  if (!name) return json({ error: "name required" }, 400);
  const result = await updateConfig(id, name);
  return result ? json(result) : json({ error: "not found" }, 404);
}

export async function handleDeleteConfig(req: Request): Promise<Response> {
  const id = new URL(req.url).pathname.split("/").pop()!;
  await deleteConfig(id);
  return json({ ok: true });
}

// ── Question API ─────────────────────────────────────────────────────

export async function handleGetQuestion(req: Request): Promise<Response> {
  const id = new URL(req.url).pathname.split("/").pop()!;
  const q = await getQuestion(id);
  return q ? json(q) : json({ error: "not found" }, 404);
}

export async function handleCreateQuestion(req: Request): Promise<Response> {
  const parts = new URL(req.url).pathname.split("/");
  // /question-lab/api/configs/:configId/questions -> configId is parts[-2]
  const configId = parts[parts.length - 2];
  const { name, text } = await req.json();
  if (!name || !text) return json({ error: "name and text required" }, 400);
  const result = await createQuestion(configId, name, text);
  return result ? json(result) : json({ error: "config not found" }, 404);
}

export async function handleUpdateQuestion(req: Request): Promise<Response> {
  const id = new URL(req.url).pathname.split("/").pop()!;
  const body = await req.json();
  const result = await updateQuestion(id, body);
  return result ? json(result) : json({ error: "not found" }, 404);
}

export async function handleDeleteQuestion(req: Request): Promise<Response> {
  const id = new URL(req.url).pathname.split("/").pop()!;
  await deleteQuestion(id);
  return json({ ok: true });
}

export async function handleRestoreVersion(req: Request): Promise<Response> {
  const parts = new URL(req.url).pathname.split("/");
  // /question-lab/api/questions/:id/restore/:versionIndex
  const versionIndex = parseInt(parts.pop()!, 10);
  parts.pop(); // "restore"
  const id = parts.pop()!;
  const result = await restoreVersion(id, versionIndex);
  return result ? json(result) : json({ error: "not found or invalid index" }, 404);
}

// ── Test API ─────────────────────────────────────────────────────────

export async function handleCreateTest(req: Request): Promise<Response> {
  const parts = new URL(req.url).pathname.split("/");
  // /question-lab/api/questions/:questionId/tests -> questionId is parts[-2]
  const questionId = parts[parts.length - 2];
  const { snippet, expected } = await req.json();
  if (!snippet || !expected) return json({ error: "snippet and expected required" }, 400);
  const result = await createTest(questionId, snippet, expected);
  return result ? json(result) : json({ error: "question not found" }, 404);
}

export async function handleUpdateTest(req: Request): Promise<Response> {
  const id = new URL(req.url).pathname.split("/").pop()!;
  const body = await req.json();
  const result = await updateTest(id, body);
  return result ? json(result) : json({ error: "not found" }, 404);
}

export async function handleDeleteTest(req: Request): Promise<Response> {
  const id = new URL(req.url).pathname.split("/").pop()!;
  await deleteTest(id);
  return json({ ok: true });
}

// ── Simulate (SSE) ──────────────────────────────────────────────────

export async function handleSimulate(req: Request): Promise<Response> {
  const { questionText, testIds } = await req.json() as { questionText: string; testIds: string[] };

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const write = (data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

      const promises = testIds.map(async (testId) => {
        try {
          const test = await getTest(testId);
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

          await updateTestResult(testId, status, answerStr, thinkingStr, defenseStr);
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

// ── Serve Config ─────────────────────────────────────────────────────

export async function handleServeConfig(req: Request): Promise<Response> {
  const configNameOrId = new URL(req.url).pathname.split("/").pop()!;
  return json(await serveConfig(configNameOrId));
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
];

export async function routeQuestionLab(req: Request): Promise<Response> {
  const url = new URL(req.url);
  for (const r of routes) {
    if (r.method !== req.method) continue;
    if (r.pattern.test(url)) return await r.handler(req);
  }
  return json({ error: "not found" }, 404);
}
