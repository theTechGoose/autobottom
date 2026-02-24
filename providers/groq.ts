/** Groq LLM provider for question answering, diarization, and feedback. */
import Groq from "npm:groq-sdk";

function getClient() {
  return new Groq({ apiKey: Deno.env.get("GROQ_API_KEY") });
}

const MODEL = "meta-llama/llama-4-maverick-17b-128e-instruct";

// -- Token tracking --

let _kv: Deno.Kv | undefined;
async function tokenKv(): Promise<Deno.Kv> {
  if (!_kv) _kv = await Deno.openKv();
  return _kv;
}

async function trackTokens(fn: string, usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined) {
  if (!usage) return;
  try {
    const db = await tokenKv();
    const ts = Date.now();
    await db.set(["token-usage", ts, fn], {
      fn,
      model: MODEL,
      prompt_tokens: usage.prompt_tokens ?? 0,
      completion_tokens: usage.completion_tokens ?? 0,
      total_tokens: usage.total_tokens ?? 0,
      ts,
    }, { expireIn: 24 * 60 * 60 * 1000 }); // auto-expire after 24h
  } catch { /* don't break the pipeline over metrics */ }
}

export async function getTokenUsage(hours = 1): Promise<{
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  calls: number;
  by_function: Record<string, { total_tokens: number; prompt_tokens: number; completion_tokens: number; calls: number }>;
}> {
  const db = await tokenKv();
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  let total_tokens = 0, prompt_tokens = 0, completion_tokens = 0, calls = 0;
  const by_function: Record<string, { total_tokens: number; prompt_tokens: number; completion_tokens: number; calls: number }> = {};

  const iter = db.list<{ fn: string; prompt_tokens: number; completion_tokens: number; total_tokens: number; ts: number }>({ prefix: ["token-usage"] });
  for await (const entry of iter) {
    const v = entry.value;
    if (v.ts < cutoff) continue;
    total_tokens += v.total_tokens;
    prompt_tokens += v.prompt_tokens;
    completion_tokens += v.completion_tokens;
    calls++;
    if (!by_function[v.fn]) by_function[v.fn] = { total_tokens: 0, prompt_tokens: 0, completion_tokens: 0, calls: 0 };
    by_function[v.fn].total_tokens += v.total_tokens;
    by_function[v.fn].prompt_tokens += v.prompt_tokens;
    by_function[v.fn].completion_tokens += v.completion_tokens;
    by_function[v.fn].calls++;
  }

  return { total_tokens, prompt_tokens, completion_tokens, calls, by_function };
}

const QA_SYSTEM_PROMPT = `JSON-Based Quality Assurance with Structured Reasoning

You are a seasoned quality-assurance veteran. Your task is to analyze a transcription and respond to a given question by returning a single JSON object with the following three keys:

1. thinking – Clearly explain your step-by-step reasoning process, including how you interpret the question and what evidence you look for in the transcription.
2. defense – Justify your answer by quoting the relevant parts of the transcription. Support your reasoning with direct excerpts that back up your claims. Include all content in the transcription that is relevant to the question.
3. answer – Provide a concise, direct answer to the question, in the response format requested.

Instructions
* Format your output strictly as a valid JSON object.
* Do not include any text outside of the JSON.
* Be analytical, structured, and transparent in your thought process.`;

export function makeUserPrompt(question: string, transcript: string): string {
  return `Question: ${question} \n\n Transcription Fragment(s): ${transcript}\n Notes: \n -If the guest is divorced they are single, if they are separated they are not.`;
}

export interface LlmAnswer {
  answer: string;
  thinking: string;
  defense: string;
}

/** Ask the LLM a single QA question with RAG context. Returns JSON answer. */
export async function askQuestion(question: string, transcript: string): Promise<LlmAnswer> {
  const client = getClient();
  const userPrompt = makeUserPrompt(question, transcript);

  const res = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: QA_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    max_tokens: 8000,
  });

  trackTokens("askQuestion", res.usage);
  const text = res.choices[0]?.message?.content ?? "";
  return parseLlmJson<LlmAnswer>(text, { answer: "Error!", thinking: "Error!", defense: "Error!" });
}

/** Generate feedback summary for failed questions. */
export async function generateFeedback(failedQuestions: string): Promise<string> {
  const client = getClient();
  const res = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content: "The following is a list of questions that failed an audit. Please provide a summary of why the team member failed the audit and what they can do to improve.\n\nSummary:",
      },
      { role: "user", content: failedQuestions },
    ],
    max_tokens: 8000,
  });
  trackTokens("generateFeedback", res.usage);
  return res.choices[0]?.message?.content ?? "";
}

/** Summarize multiple thinking/defense outputs into one. */
export async function summarize(texts: string[]): Promise<string> {
  const client = getClient();
  const res = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: "please give a summary.\n\nsummary:" },
      { role: "user", content: texts.join("\n") },
    ],
    max_tokens: 8000,
  });
  trackTokens("summarize", res.usage);
  return res.choices[0]?.message?.content ?? "";
}

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

/** Diarize a transcript using multi-turn Groq conversation. */
export async function diarize(rawTranscript: string, maxAttempts = 4): Promise<string> {
  const client = getClient();
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: DIARIZATION_SYSTEM },
    { role: "user", content: rawTranscript },
  ];

  for (let j = 0; j < maxAttempts; j++) {
    // Step 1: Diarizer produces labeled transcript (plain text, not JSON)
    const diarizationRes = await client.chat.completions.create({
      model: MODEL,
      messages,
      max_tokens: 8000,
    });
    trackTokens("diarize", diarizationRes.usage);
    const diarized = diarizationRes.choices[0]?.message?.content ?? "";
    messages.push({ role: "assistant", content: diarized });

    // Step 2: Manager reviews (JSON response)
    const managerRes = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: DIARIZATION_MANAGER + "\n\nOriginal transcription:\n" + rawTranscript },
        { role: "user", content: diarized },
      ],
      response_format: { type: "json_object" },
      max_tokens: 8000,
    });
    trackTokens("diarize-manager", managerRes.usage);
    const managerText = managerRes.choices[0]?.message?.content ?? "";
    const manager = parseLlmJson<{ isCorrect: boolean; thinking: string; feedback: string | null }>(managerText, { isCorrect: true, thinking: "", feedback: null });

    // Step 3: QA check
    const qaRes = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: DIARIZATION_QA },
        { role: "user", content: diarized },
      ],
      max_tokens: 100,
    });
    trackTokens("diarize-qa", qaRes.usage);
    const qaAnswer = qaRes.choices[0]?.message?.content?.trim() ?? "";

    if (qaAnswer === "Yes") {
      return diarized;
    }

    // Feed back to diarizer for another attempt
    if (manager.feedback) {
      messages.push({ role: "user", content: manager.feedback });
    }
  }

  // Return last attempt even if QA didn't approve
  const lastAssistant = messages.filter((m) => m.role === "assistant").pop();
  return lastAssistant?.content ?? rawTranscript;
}

function parseLlmJson<T>(text: string, fallback: T): T {
  try {
    // Try to find JSON in the response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}
