/** Reproduce the failure stored on fixtures/api-errors/-TfJnN-anbEb7XfQZD8U6.json:
 *  question 25 ("11% Service Fee") came back answer="Error",
 *  thinking="LLM timed out after 25s (model=openai:gpt-4.1-mini)".
 *
 *  A: mechanism — script the fallback chain so every Groq rung 429s and the
 *     final OpenAI rung hangs, and check the stored answer matches byte-for-byte.
 *  B: live — time the real gpt-4.1-mini call on that exact prompt against the
 *     25s budget.
 *
 *  Run: deno run -A --no-check --config deno.json --env-file=autobottom.env \
 *         fixtures/scripts/repro-llm-timeout.ts [a|b]
 */
import { askQuestion, __setGroqTestFetch } from "@audit/domain/data/groq/mod.ts";

const FIXTURE = "fixtures/api-errors/-TfJnN-anbEb7XfQZD8U6.json";
const finding = JSON.parse(await Deno.readTextFile(FIXTURE));
const q = finding.answeredQuestions[24];

// step-ask-all/mod.ts:61 — transcript is 13,563 chars so the real run used a
// Pinecone chunk; the widest context it could have used is this 8000-char
// fallback (mod.ts:71,79), so it is the upper bound on latency.
const context: string = finding.rawTranscript.slice(0, 8000);
const question: string = q.populated;

/** step-ask-all/mod.ts:263-267 — the catch that wrote the stored row. */
function gradeLikeStepAskAll(err: unknown) {
  const msg = (err as Error)?.message || String(err);
  return { answer: "Error", thinking: msg, defense: "N/A" };
}

async function partA() {
  let groqCalls = 0, openAiCalls = 0;
  __setGroqTestFetch((input: unknown) => {
    const url = String((input as Request)?.url ?? input);
    if (url.includes("openai.com")) {
      openAiCalls++;
      console.log(`  → openai:gpt-4.1-mini call #${openAiCalls} — hanging (no response)`);
      return new Promise<Response>(() => {}); // never settles
    }
    groqCalls++;
    return Promise.resolve(
      new Response(
        JSON.stringify({
          error: {
            message: "Rate limit reached for model on tokens per minute (TPM): Limit 300000. Please try again in 10ms.",
            type: "tokens",
            code: "rate_limit_exceeded",
          },
        }),
        { status: 429, headers: { "content-type": "application/json" } },
      ),
    );
  });

  const t0 = Date.now();
  let stored;
  try {
    stored = await askQuestion(question, context, 0, 0.8);
    console.log("  unexpected success:", stored);
  } catch (err) {
    stored = gradeLikeStepAskAll(err);
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  __setGroqTestFetch(undefined);

  console.log(`\n  groq HTTP calls=${groqCalls}  openai HTTP calls=${openAiCalls}  elapsed=${secs}s`);
  console.log("  reproduced:", JSON.stringify(stored, null, 2));
  console.log("  fixture   :", JSON.stringify({ answer: q.answer, thinking: q.thinking, defense: q.defense }, null, 2));
  const match = stored.answer === q.answer && stored.thinking === q.thinking && stored.defense === q.defense;
  console.log(match ? "\n  ✅ EXACT MATCH with the stored failure" : "\n  ❌ NO MATCH");
}

async function partB(runs = 3) {
  console.log(`  prompt: question=${question.length} chars, context=${context.length} chars`);
  for (let i = 1; i <= runs; i++) {
    const t0 = Date.now();
    try {
      // modelIndex 3 = the last rung, openai:gpt-4.1-mini — the one that timed out.
      const a = await askQuestion(question, context, 3, 0.8);
      const secs = (Date.now() - t0) / 1000;
      console.log(`  run ${i}: ${secs.toFixed(1)}s / 25s budget → answer="${a.answer}"`);
    } catch (err) {
      console.log(`  run ${i}: ${((Date.now() - t0) / 1000).toFixed(1)}s → THREW: ${(err as Error).message}`);
    }
  }
}

const which = (Deno.args[0] ?? "a").toLowerCase();
if (which === "a") { console.log("PART A — scripted cascade (groq 429s → openai hangs)\n"); await partA(); }
else { console.log("PART B — live gpt-4.1-mini on the real prompt\n"); await partB(); }
