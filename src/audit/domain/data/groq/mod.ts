/** Groq LLM adapter for QA, diarization, feedback. Ported from providers/groq.ts. */
import Groq from "#groq-sdk";
import type { ChatCompletion } from "npm:groq-sdk/resources/chat/completions";

function getClient() { return new Groq({ apiKey: Deno.env.get("GROQ_API_KEY") }); }

const FALLBACK_MODELS = [
  "openai/gpt-oss-120b",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "llama-3.3-70b-versatile",
] as const;

type GroqModel = typeof FALLBACK_MODELS[number];
const MODEL = FALLBACK_MODELS[0];
const LLM_TIMEOUT_MS = 25_000;

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
It is imperative that the entirety of the provided transcription is processed and included in the formatted output. Do not summarize, condense, or omit any portion of the original text.`;

const DIARIZATION_MANAGER = `You are a speaker-identifier bot manager. Your job is to review transcriptions and make sure that the customer and agent labels are placed correctly. Your output should be a json object with three keys: "isCorrect" (boolean), "thinking" (string explaining your reasoning), and "feedback" (null if isCorrect is true, otherwise detailed feedback string).`;

const DIARIZATION_QA = `You are an AI Quality Assurance Bot specializing in evaluating speaker diarization tasks. Determine if the diarization meets a "good enough" quality standard. Response MUST be exactly "Yes" or "This is not good enough".`;

// ── Core API ─────────────────────────────────────────────────────────────────

export function makeUserPrompt(question: string, transcript: string): string {
  return `Question: ${question} \n\n Transcription Fragment(s): ${transcript}\n Notes: \n -If the guest is divorced they are single, if they are separated they are not.`;
}

export interface LlmAnswer { answer: string; thinking: string; defense: string; }

export async function askQuestion(question: string, transcript: string, modelIndex = 0, temperature = 0.8): Promise<LlmAnswer> {
  const model: GroqModel = FALLBACK_MODELS[modelIndex] ?? FALLBACK_MODELS[0];
  const client = getClient();
  const userPrompt = makeUserPrompt(question, transcript);

  let timerId: ReturnType<typeof setTimeout>;
  const timeoutP = new Promise<never>((_, reject) => { timerId = setTimeout(() => reject(new Error(`LLM timed out after ${LLM_TIMEOUT_MS / 1000}s (model=${model})`)), LLM_TIMEOUT_MS); });

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
    if (isTimeout) console.error(`[LLM-TIMEOUT] ⚠️ ${model} no response after ${LLM_TIMEOUT_MS / 1000}s — trying next model`);
    const isRateLimit = isTimeout || msg.includes("429") || msg.includes("503") || msg.includes("404") || msg.includes("rate_limit_exceeded") || msg.includes("over capacity") || msg.includes("json_validate_failed") || msg.includes("model_not_found");
    const nextIndex = modelIndex + 1;
    if (isRateLimit && nextIndex < FALLBACK_MODELS.length) {
      console.warn(`[LLM-FALLBACK] ${model} → trying ${FALLBACK_MODELS[nextIndex]}`);
      await new Promise((r) => setTimeout(r, 1000));
      return askQuestion(question, transcript, nextIndex, temperature);
    }
    throw e;
  }
}

export async function generateFeedback(failedQuestions: string): Promise<string> {
  return groqCallWithRetry({ model: MODEL, messages: [{ role: "system", content: "The following is a list of questions that failed an audit. Please provide a summary of why the team member failed the audit and what they can do to improve.\n\nSummary:" }, { role: "user", content: failedQuestions }], max_tokens: 8000 }, "generateFeedback");
}

export async function summarize(texts: string[]): Promise<string> {
  return groqCallWithRetry({ model: MODEL, messages: [{ role: "system", content: "please give a summary.\n\nsummary:" }, { role: "user", content: texts.join("\n") }], max_tokens: 8000 }, "summarize");
}

async function groqCallWithRetry(params: Parameters<ReturnType<typeof getClient>["chat"]["completions"]["create"]>[0], trackLabel: string, modelIndex = 0): Promise<string> {
  const model = FALLBACK_MODELS[modelIndex] ?? FALLBACK_MODELS[0];
  const client = getClient();
  let timerId: ReturnType<typeof setTimeout>;
  const timeoutP = new Promise<never>((_, reject) => { timerId = setTimeout(() => reject(new Error(`LLM timed out after ${LLM_TIMEOUT_MS / 1000}s (${trackLabel}/${model})`)), LLM_TIMEOUT_MS); });
  try {
    const res = await Promise.race([client.chat.completions.create({ ...params, model }), timeoutP]) as ChatCompletion;
    clearTimeout(timerId!);
    trackTokens(trackLabel, res.usage);
    return res.choices[0]?.message?.content ?? "";
  } catch (e: any) {
    clearTimeout(timerId!);
    const msg = String(e?.message ?? e);
    const isTimeout = msg.includes("timed out") || msg.includes("aborted") || msg.includes("AbortError");
    if (isTimeout) console.error(`[LLM-TIMEOUT] ⚠️ ${trackLabel}/${model} no response after ${LLM_TIMEOUT_MS / 1000}s — trying next model`);
    const isRateLimit = isTimeout || msg.includes("429") || msg.includes("503") || msg.includes("404") || msg.includes("rate_limit_exceeded") || msg.includes("over capacity") || msg.includes("model_not_found");
    const nextIndex = modelIndex + 1;
    if (isRateLimit && nextIndex < FALLBACK_MODELS.length) {
      console.warn(`[LLM-FALLBACK] ${trackLabel}: ${model} → trying ${FALLBACK_MODELS[nextIndex]}`);
      await new Promise((r) => setTimeout(r, 1000));
      return groqCallWithRetry(params, trackLabel, nextIndex);
    }
    throw e;
  }
}

export async function diarize(rawTranscript: string, maxAttempts = 4): Promise<string> {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: DIARIZATION_SYSTEM },
    { role: "user", content: rawTranscript },
  ];
  for (let j = 0; j < maxAttempts; j++) {
    const diarized = await groqCallWithRetry({ model: MODEL, messages, max_tokens: 8000 }, "diarize");
    messages.push({ role: "assistant", content: diarized });
    const [managerText, qaAnswer] = await Promise.all([
      groqCallWithRetry({ model: MODEL, messages: [{ role: "system", content: DIARIZATION_MANAGER }, { role: "user", content: diarized }], response_format: { type: "json_object" }, max_tokens: 8000 }, "diarize-manager"),
      groqCallWithRetry({ model: MODEL, messages: [{ role: "system", content: DIARIZATION_QA }, { role: "user", content: diarized }], max_tokens: 100 }, "diarize-qa"),
    ]);
    if (qaAnswer.trim() === "Yes") return diarized;
    const manager = parseLlmJson<{ isCorrect: boolean; thinking: string; feedback: string | null }>(managerText, { isCorrect: true, thinking: "", feedback: null });
    if (manager.feedback) messages.push({ role: "user", content: manager.feedback });
  }
  const lastAssistant = messages.filter((m) => m.role === "assistant").pop();
  return lastAssistant?.content ?? rawTranscript;
}

function parseLlmJson<T>(text: string, fallback: T): T {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return JSON.parse(text);
  } catch { return fallback; }
}
