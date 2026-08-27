/** Groq LLM adapter for QA, diarization, feedback. Ported from providers/groq.ts. */
import { withSpan, metric } from "@core/data/datadog-otel/mod.ts";
import { extractDiarizedTranscript } from "@core/business/diarization-validation/mod.ts";
import Groq from "#groq-sdk";
import OpenAI from "#openai";
import type { ChatCompletion } from "#groq-sdk/resources/chat/completions";

/** Test seam: when set, the Groq client routes requests through this fetch
 *  instead of the network, so unit tests can script chat-completion responses
 *  (see test.ts). Production never sets it — the `else` branch below is the
 *  exact same constructor call as before, so prod behavior is unchanged.
 *  Typed loosely because the SDK's `Fetch` signature differs from the global
 *  `fetch` (URLLike vs URL); the cast bridges the two test-only. */
// deno-lint-ignore no-explicit-any
type TestFetch = (input: any, init?: any) => Promise<Response>;
let _testFetch: TestFetch | undefined;
export function __setGroqTestFetch(f: TestFetch | undefined): void { _testFetch = f; }

function getClient() {
  // deno-lint-ignore no-explicit-any
  if (_testFetch) return new Groq({ apiKey: Deno.env.get("GROQ_API_KEY") ?? "test", fetch: _testFetch as any });
  return new Groq({ apiKey: Deno.env.get("GROQ_API_KEY") });
}

function getOpenAiClient() {
  // deno-lint-ignore no-explicit-any
  if (_testFetch) return new OpenAI({ apiKey: Deno.env.get("OPEN_AI_KEY") ?? "test", fetch: _testFetch as any });
  return new OpenAI({ apiKey: Deno.env.get("OPEN_AI_KEY") });
}

/** Both SDKs are OpenAI-shaped for `chat.completions.create`, and every request
 *  we send (messages / response_format / max_tokens / temperature) is accepted
 *  verbatim by both — verified against gpt-4.1-mini before it was added below.
 *  So the OpenAI client is widened to the Groq client's type at this ONE seam
 *  and every call site keeps the types it already had. */
function clientFor(provider: Provider): ReturnType<typeof getClient> {
  return provider === "openai"
    ? getOpenAiClient() as unknown as ReturnType<typeof getClient>
    : getClient();
}

// Each Groq model carries its OWN 300k TPM budget, so the chain is really a
// series of separate quota pools — but only if every entry is a live model.
// `meta-llama/llama-4-scout-17b-16e-instruct` sat here until 2026-07-30 after
// Groq removed it: it 404'd instantly, so the chain was silently only two deep
// (logs 07-23→07-30: 14,579 fallbacks INTO scout, 14,574 straight back out) and
// 858 questions died on a 429 with the raw error stored as their reasoning.
//
// The last entry is deliberately a DIFFERENT VENDOR. Groq's TPM ceiling is
// org-wide, so a busy enough hour throttles every Groq model at once and no
// amount of in-Groq fallback helps; OpenAI is the only rung with a quota that
// can't be exhausted by our own Groq traffic. It is last because it is the only
// metered-by-the-token rung — it should fire rarely, and a spike in
// `[LLM-FALLBACK] … → openai:*` lines means the Groq tier needs raising.
//
// Adding an entry: check Groq ids against GET api.groq.com/openai/v1/models,
// and confirm an OpenAI id accepts `max_tokens` (the gpt-5.x models do NOT —
// they require `max_completion_tokens`, so they are not drop-ins here).
type Provider = "groq" | "openai";
const FALLBACK_MODELS = [
  { provider: "groq", model: "openai/gpt-oss-120b" },
  { provider: "groq", model: "openai/gpt-oss-20b" },
  { provider: "groq", model: "llama-3.3-70b-versatile" },
  { provider: "openai", model: "gpt-4.1-mini" },
] as const satisfies readonly { provider: Provider; model: string }[];

/** Log/label form. Worth the noise because `openai/gpt-oss-120b` is a GROQ-hosted
 *  model whose id starts with "openai/" — without the tag the logs are unreadable. */
function tagOf(entry: { provider: Provider; model: string }): string {
  return `${entry.provider}:${entry.model}`;
}

const MODEL = FALLBACK_MODELS[0].model;
const LLM_TIMEOUT_MS = 35_000;

// ── Token tracking ───────────────────────────────────────────────────────────

let _kv: Deno.Kv | undefined;
async function tokenKv(): Promise<Deno.Kv> {
  if (!_kv) _kv = await Deno.openKv(Deno.env.get("KV_URL") ?? undefined);
  return _kv;
}

async function trackTokens(fn: string, usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined) {
  if (!usage) return;
  try {
    const db = await tokenKv();
    const ts = Date.now();
    await db.set(["token-usage", ts, fn], { fn, model: MODEL, prompt_tokens: usage.prompt_tokens ?? 0, completion_tokens: usage.completion_tokens ?? 0, total_tokens: usage.total_tokens ?? 0, ts }, { expireIn: 24 * 60 * 60 * 1000 });
  } catch { /* don't break pipeline over metrics */ }
}

export async function getTokenUsage(hours = 1) {
  const db = await tokenKv();
  const now = Date.now();
  const cutoff = now - hours * 3_600_000;
  let total_tokens = 0, prompt_tokens = 0, completion_tokens = 0, calls = 0;
  const by_function: Record<string, { total_tokens: number; prompt_tokens: number; completion_tokens: number; calls: number }> = {};
  const iter = db.list<{ fn: string; prompt_tokens: number; completion_tokens: number; total_tokens: number; ts: number }>({ start: ["token-usage", cutoff], end: ["token-usage", now + 1] });
  for await (const entry of iter) {
    const v = entry.value;
    if (!v || v.ts < cutoff) continue;
    total_tokens += v.total_tokens; prompt_tokens += v.prompt_tokens; completion_tokens += v.completion_tokens; calls++;
    if (!by_function[v.fn]) by_function[v.fn] = { total_tokens: 0, prompt_tokens: 0, completion_tokens: 0, calls: 0 };
    by_function[v.fn].total_tokens += v.total_tokens; by_function[v.fn].prompt_tokens += v.prompt_tokens;
    by_function[v.fn].completion_tokens += v.completion_tokens; by_function[v.fn].calls++;
  }
  return { total_tokens, prompt_tokens, completion_tokens, calls, by_function };
}

// ── System prompts ───────────────────────────────────────────────────────────

const QA_SYSTEM_PROMPT = `JSON-Based Quality Assurance with Structured Reasoning

You are a seasoned quality-assurance veteran. Your task is to analyze a transcription and respond to a given question by returning a single JSON object with the following three keys:

1. thinking – Clearly explain your step-by-step reasoning process, including how you interpret the question and what evidence you look for in the transcription.
2. defense – Justify your answer by quoting the relevant parts of the transcription. Support your reasoning with direct excerpts that back up your claims. Include all content in the transcription that is relevant to the question.
3. answer – Provide a concise, direct answer to the question, in the response format requested.

Instructions
* Format your output strictly as a valid JSON object.
* Do not include any text outside of the JSON.
* Be analytical, structured, and transparent in your thought process.
* When asked whether something was said, mentioned, or disclosed — answer Yes if it occurred at ANY point during the call, not just at the beginning. Do not add timing qualifiers ("initially", "at first", "upfront") unless the question explicitly asks for them.`;

const DIARIZATION_SYSTEM = `### Role ###
You are an advanced Speaker Identification and Transcription Formatting Bot.

### Task ###
Your primary task is to accurately transcribe and label the provided conversation. Ensure that every utterance is attributed to the correct speaker, either "[CUSTOMER]" or "[AGENT]".

### Output Format ###
Format the entire transcription strictly as follows:

[CUSTOMER]: [Text spoken by the customer]
[AGENT]: [Text spoken by the agent]

### Critical Instruction ###
It is imperative that the entirety of the provided transcription is processed and included in the formatted output. Do not summarize, condense, or omit any portion of the original text.

### Absolute Output Rules ###
Your ENTIRE reply must be transcript lines and nothing else. Every line must begin with "[CUSTOMER]:" or "[AGENT]:".
Never write: a preamble or sign-off, commentary or analysis, a review of a previous attempt, a list of problems or changes, markdown headings, markdown tables, bullet or numbered lists, bold text, or code fences.
If you are given feedback about a previous attempt, do NOT discuss it — silently produce the corrected transcript and nothing more.`;

const DIARIZATION_MANAGER = `You are a speaker-identifier bot manager. Your job is to review transcriptions and make sure that the customer and agent labels are placed correctly. Your output should be a json object with three keys: "isCorrect" (boolean), "thinking" (string explaining your reasoning), and "feedback" (null if isCorrect is true, otherwise detailed feedback string).`;

const DIARIZATION_QA = `You are an AI Quality Assurance Bot specializing in evaluating speaker diarization tasks. Determine if the diarization meets a "good enough" quality standard. Response MUST be exactly "Yes" or "This is not good enough".`;

// ── Core API ─────────────────────────────────────────────────────────────────

export function makeUserPrompt(question: string, transcript: string): string {
  return `Question: ${question} \n\n Transcription Fragment(s): ${transcript}\n Notes: \n -If the guest is divorced they are single, if they are separated they are not.`;
}

export interface LlmAnswer { answer: string; thinking: string; defense: string; }

/** Parse Groq's "Please try again in NNNms / NNs" hint from the 429 body
 *  so we can sleep exactly the right amount before retrying. Falls back to
 *  500ms if the hint isn't there (rare; usually present on TPM 429s). */
function parseGroqRetryMs(msg: string): number {
  const msMatch = msg.match(/try again in\s+([\d.]+)\s*ms/i);
  if (msMatch) return Math.min(5000, Math.ceil(parseFloat(msMatch[1])) + 50);
  const sMatch = msg.match(/try again in\s+([\d.]+)\s*s\b/i);
  if (sMatch) return Math.min(15_000, Math.ceil(parseFloat(sMatch[1]) * 1000) + 50);
  return 500;
}

function isRateLimitError(msg: string): boolean {
  return msg.includes("429") || msg.includes("rate_limit_exceeded") || msg.includes("over capacity");
}

function isModelDeadError(msg: string): boolean {
  return msg.includes("503") || msg.includes("404") || msg.includes("model_not_found")
    || msg.includes("json_validate_failed")
    // OpenAI returns "out of credit" and "key revoked" as a 429 and a 401, and
    // isRateLimitError() would otherwise burn the full retry budget sleeping on
    // a condition no amount of waiting fixes. Dead, not throttled.
    || msg.includes("insufficient_quota") || msg.includes("invalid_api_key");
}

/** Per-question rate-limit retry budget. TPM 429s are usually <250ms windows;
 *  three retries with the suggested delay (+ exponential bump if the hint is
 *  missing) is plenty to ride them out without thrashing. */
const MAX_RATE_LIMIT_RETRIES = 3;

async function askQuestionInner(
  question: string,
  transcript: string,
  modelIndex = 0,
  temperature = 0.8,
  rateLimitRetries = 0,
): Promise<LlmAnswer> {
  const entry = FALLBACK_MODELS[modelIndex] ?? FALLBACK_MODELS[0];
  const { model } = entry;
  const tag = tagOf(entry);
  const client = clientFor(entry.provider);
  const userPrompt = makeUserPrompt(question, transcript);

  let timerId: ReturnType<typeof setTimeout>;
  const timeoutP = new Promise<never>((_, reject) => { timerId = setTimeout(() => reject(new Error(`LLM timed out after ${LLM_TIMEOUT_MS / 1000}s (model=${tag})`)), LLM_TIMEOUT_MS); });

  try {
    const res = await Promise.race([
      client.chat.completions.create({ model, messages: [{ role: "system", content: QA_SYSTEM_PROMPT }, { role: "user", content: userPrompt }], response_format: { type: "json_object" }, max_tokens: 8000, temperature }),
      timeoutP,
    ]);
    clearTimeout(timerId!);
    trackTokens("askQuestion", res.usage);
    const text = res.choices[0]?.message?.content ?? "";
    const parsed = parseLlmJson<LlmAnswer>(text, { answer: "Error!", thinking: "Error!", defense: "Error!" });
    if (typeof parsed.answer !== "string") parsed.answer = JSON.stringify(parsed.answer) ?? "Error!";
    return parsed;
  } catch (e: any) {
    clearTimeout(timerId!);
    const msg = String(e?.message ?? e);
    const isTimeout = msg.includes("timed out") || msg.includes("aborted") || msg.includes("AbortError");
    const isRateLimit = isRateLimitError(msg);
    const isModelDead = isTimeout || isModelDeadError(msg);

    // INTRA-MODEL retry for TPM 429s. Groq's own response says "try again in
    // Nms" — when we get that, retry the SAME model after that delay instead
    // of skipping to the next one. Prevents this incident on
    // yP_77CRE0kNRiuTRvMqM2 q[12]: TPM cap hit at 298687/300000, retry would
    // have succeeded after 152.4ms but we instead returned answer="Error"
    // with the raw 429 JSON as the question's reasoning text.
    if (isRateLimit && !isModelDead && rateLimitRetries < MAX_RATE_LIMIT_RETRIES) {
      const waitMs = parseGroqRetryMs(msg);
      console.warn(`[LLM-RATE-LIMIT] ${tag} retry ${rateLimitRetries + 1}/${MAX_RATE_LIMIT_RETRIES} after ${waitMs}ms — TPM throttle, will not fall back yet`);
      await new Promise((r) => setTimeout(r, waitMs));
      return askQuestionInner(question, transcript, modelIndex, temperature, rateLimitRetries + 1);
    }

    if (isTimeout) console.error(`[LLM-TIMEOUT] ⚠️ ${tag} no response after ${LLM_TIMEOUT_MS / 1000}s — trying next model`);
    const nextIndex = modelIndex + 1;
    if ((isRateLimit || isModelDead) && nextIndex < FALLBACK_MODELS.length) {
      console.warn(`[LLM-FALLBACK] ${tag} → trying ${tagOf(FALLBACK_MODELS[nextIndex])}`);
      await new Promise((r) => setTimeout(r, 1000));
      return askQuestionInner(question, transcript, nextIndex, temperature, 0);
    }
    throw e;
  }
}

export async function askQuestion(question: string, transcript: string, modelIndex = 0, temperature = 0.8): Promise<LlmAnswer> {
  return withSpan("groq.askQuestion", async (span) => {
    span.setAttribute("groq.model_index", modelIndex);
    const result = await askQuestionInner(question, transcript, modelIndex, temperature);
    metric("autobottom.groq.ask", 1);
    return result;
  }, {}, "client");
}

export async function generateFeedback(failedQuestions: string): Promise<string> {
  return withSpan("groq.generateFeedback", async () => {
    const result = await groqCallWithRetry({ model: MODEL, messages: [{ role: "system", content: "The following is a list of questions that failed an audit. Please provide a summary of why the team member failed the audit and what they can do to improve.\n\nSummary:" }, { role: "user", content: failedQuestions }], max_tokens: 8000 }, "generateFeedback");
    metric("autobottom.groq.feedback", 1);
    return result;
  }, {}, "client");
}

export async function summarize(texts: string[]): Promise<string> {
  return withSpan("groq.summarize", async () => {
    const result = await groqCallWithRetry({ model: MODEL, messages: [{ role: "system", content: "please give a summary.\n\nsummary:" }, { role: "user", content: texts.join("\n") }], max_tokens: 8000 }, "summarize");
    metric("autobottom.groq.summarize", 1);
    return result;
  }, {}, "client");
}

async function groqCallWithRetry(params: Parameters<ReturnType<typeof getClient>["chat"]["completions"]["create"]>[0], trackLabel: string, modelIndex = 0, rateLimitRetries = 0): Promise<string> {
  const entry = FALLBACK_MODELS[modelIndex] ?? FALLBACK_MODELS[0];
  const { model } = entry;
  const tag = tagOf(entry);
  const client = clientFor(entry.provider);
  let timerId: ReturnType<typeof setTimeout>;
  const timeoutP = new Promise<never>((_, reject) => { timerId = setTimeout(() => reject(new Error(`LLM timed out after ${LLM_TIMEOUT_MS / 1000}s (${trackLabel}/${tag})`)), LLM_TIMEOUT_MS); });
  try {
    const res = await Promise.race([client.chat.completions.create({ ...params, model }), timeoutP]) as ChatCompletion;
    clearTimeout(timerId!);
    trackTokens(trackLabel, res.usage);
    return res.choices[0]?.message?.content ?? "";
  } catch (e: any) {
    clearTimeout(timerId!);
    const msg = String(e?.message ?? e);
    const isTimeout = msg.includes("timed out") || msg.includes("aborted") || msg.includes("AbortError");
    const isRateLimit = isRateLimitError(msg);
    const isModelDead = isTimeout || isModelDeadError(msg);

    // Same intra-model retry as askQuestionInner — see comment there.
    if (isRateLimit && !isModelDead && rateLimitRetries < MAX_RATE_LIMIT_RETRIES) {
      const waitMs = parseGroqRetryMs(msg);
      console.warn(`[LLM-RATE-LIMIT] ${trackLabel}/${tag} retry ${rateLimitRetries + 1}/${MAX_RATE_LIMIT_RETRIES} after ${waitMs}ms`);
      await new Promise((r) => setTimeout(r, waitMs));
      return groqCallWithRetry(params, trackLabel, modelIndex, rateLimitRetries + 1);
    }

    if (isTimeout) console.error(`[LLM-TIMEOUT] ⚠️ ${trackLabel}/${tag} no response after ${LLM_TIMEOUT_MS / 1000}s — trying next model`);
    const nextIndex = modelIndex + 1;
    if ((isRateLimit || isModelDead) && nextIndex < FALLBACK_MODELS.length) {
      console.warn(`[LLM-FALLBACK] ${trackLabel}: ${tag} → trying ${tagOf(FALLBACK_MODELS[nextIndex])}`);
      await new Promise((r) => setTimeout(r, 1000));
      return groqCallWithRetry(params, trackLabel, nextIndex, 0);
    }
    throw e;
  }
}

export async function diarize(rawTranscript: string, maxAttempts = 4): Promise<string> {
  return withSpan("groq.diarize", async (span) => {
    span.setAttribute("groq.max_attempts", maxAttempts);

    // Every attempt is a FRESH two-message conversation.
    //
    // The old loop accumulated each attempt as an `assistant` turn and the
    // manager bot's critique as a `user` turn, which silently changed the task
    // from "transcribe this" to "respond to this critique" — and the model
    // answered in kind: a markdown review table, a "## Corrected transcription"
    // heading, the transcript in a code fence, and a "what was changed"
    // changelog. All of it was stored as the audit transcript and shown to the
    // reviewer (report 4oL3fw_Coxvzpx7El_qip). Feedback now rides INSIDE the
    // user message together with a re-assertion of the output contract, so
    // every attempt is still a transcription request.
    let feedback: string | null = null;
    // First attempt that came back as a real transcript, and the best salvage
    // we managed to carve out of a commentary reply. Both are captured BEFORE
    // the QA round-trip so a QA flake can never lose a good attempt.
    let firstClean: string | null = null;
    let bestSalvage: string | null = null;

    for (let j = 0; j < maxAttempts; j++) {
      const userContent = feedback
        ? `${rawTranscript}\n\n### Problems with the previous attempt ###\n${feedback}\n\n` +
          `Produce the corrected transcription. Output ONLY the labeled transcript lines — ` +
          `no preamble, no commentary, no markdown, no code fences, no summary of changes.`
        : rawTranscript;

      const diarized = await groqCallWithRetry({
        model: MODEL,
        messages: [{ role: "system", content: DIARIZATION_SYSTEM }, { role: "user", content: userContent }],
        max_tokens: 8000,
      }, "diarize");

      const { text: candidate, method } = extractDiarizedTranscript(diarized, rawTranscript);
      if (method === "clean" && firstClean === null) firstClean = candidate;
      if (method === "fenced" || method === "filtered") {
        if (bestSalvage === null) bestSalvage = candidate;
        console.warn(`⚠️ [DIARIZE-COMMENTARY] attempt ${j + 1}/${maxAttempts} returned commentary — salvaged via ${method}`);
        metric("autobottom.groq.diarize.commentary", 1);
      }

      // The manager/QA round-trip on the final attempt can't influence anything
      // (there is no next attempt to feed, and a clean candidate is already
      // captured in firstClean) — skip it and save two Groq calls.
      if (j === maxAttempts - 1) break;

      const [managerText, qaAnswer] = await Promise.all([
        groqCallWithRetry({ model: MODEL, messages: [{ role: "system", content: DIARIZATION_MANAGER }, { role: "user", content: candidate }], response_format: { type: "json_object" }, max_tokens: 8000 }, "diarize-manager"),
        groqCallWithRetry({ model: MODEL, messages: [{ role: "system", content: DIARIZATION_QA }, { role: "user", content: candidate }], max_tokens: 100 }, "diarize-qa"),
      ]);
      // A "Yes" from the QA bot is NOT sufficient on its own. The commentary
      // reply closed by asserting it "satisfied the required transcription
      // format" — precisely what talks a free-text QA bot into "Yes" — and the
      // old code let that short-circuit past a clean attempt already sitting in
      // firstValid. Only a `clean` classification may short-circuit.
      if (qaAnswer.trim() === "Yes" && method === "clean") { metric("autobottom.groq.diarize", 1); return candidate; }

      const manager = parseLlmJson<{ isCorrect: boolean; thinking: string; feedback: string | null }>(managerText, { isCorrect: true, thinking: "", feedback: null });
      feedback = manager.feedback ?? null;
    }

    metric("autobottom.groq.diarize", 1);
    // Never return a QA-rejected attempt (regression: 76UGB0… returned the
    // refusal itself). Prefer a clean but QA-unconfirmed attempt; a distinct
    // counter makes this path visible — a rising first_valid rate flags the QA
    // bot mis-rejecting good output before it degrades into raw fallbacks.
    if (firstClean !== null) {
      metric("autobottom.groq.diarize.first_valid", 1);
      return firstClean;
    }
    // Then a transcript salvaged out of a commentary reply — labels preserved,
    // commentary stripped, and already fidelity-checked against the raw text.
    if (bestSalvage !== null) {
      console.warn(`[GROQ-DIARIZE] all ${maxAttempts} attempts returned commentary — using salvaged transcript`);
      metric("autobottom.groq.diarize.salvaged", 1);
      return bestSalvage;
    }
    // Otherwise fall back to the raw transcript — readable, label-free, the
    // report's existing fallback path.
    console.warn(`[GROQ-DIARIZE] all ${maxAttempts} attempts failed validation — falling back to raw transcript`);
    metric("autobottom.groq.diarize.fallback_raw", 1);
    return rawTranscript;
  }, {}, "client");
}

function parseLlmJson<T>(text: string, fallback: T): T {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return JSON.parse(text);
  } catch { return fallback; }
}
