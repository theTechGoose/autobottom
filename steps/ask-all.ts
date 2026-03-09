/** STEP 4 (alt): Answer ALL questions in a single Promise.all — no fan-out overhead. Like OmniSource's approach. */
import { getFinding, getCachedAnswer, cacheAnswer, saveBatchAnswers, trackActive, getPopulatedQuestions } from "../lib/kv.ts";
import { enqueueStep, publishStep } from "../lib/queue.ts";
import { upload as pineconeUpload } from "../providers/pinecone.ts";
import { askQuestion, summarize } from "../providers/groq.ts";
import { query as vectorQuery } from "../providers/pinecone.ts";
import { parseAst, evaluateAutoYes } from "../providers/question-expr.ts";
import { answerQuestion } from "../types/mod.ts";
import type { IQuestion, IAnsweredQuestion, ILlmQuestionAnswer } from "../types/mod.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function strToBool(s: unknown): boolean | null {
  const lower = String(s ?? "").trim().toLowerCase();
  if (lower.startsWith("yes") || lower === "y" || lower === "true" || lower === "1") return true;
  if (lower.startsWith("no") || lower === "n" || lower === "false" || lower === "0") return false;
  if (lower.includes("yes")) return true;
  if (lower.includes("no")) return false;
  return null;
}

/** Strip backtick note blocks and +: prefix so Pinecone gets a clean semantic query. */
function toQueryText(q: string): string {
  return q.replace(/```[^`]*```/g, "").replace(/^\+:/, "").trim();
}

async function askLlmOne(
  question: IQuestion,
  orgId: string,
  findingId: string,
  rawTranscript: string,
): Promise<IAnsweredQuestion> {
  // Auto-yes: skip Groq entirely if the expression matches populated field values
  if (question.autoYesExp) {
    const autoYes = evaluateAutoYes(question.autoYesExp);
    if (autoYes.applies) {
      console.log(`[STEP-ASK-ALL] ${findingId}: Auto-Yes "${question.header}" — ${autoYes.message}`);
      return answerQuestion(question, { answer: "Yes", thinking: autoYes.message, defense: "Auto-Yes" });
    }
  }

  // Check cache
  const cached = await getCachedAnswer(orgId, findingId, question.populated);
  if (cached) return answerQuestion(question, cached);

  // Parse AST
  const questionWithAst = parseAst(question);
  const ast = questionWithAst.astResults.ast ?? [];

  /** Query vector store using a clean query (no instruction notes), falling back to raw transcript. */
  async function getContext(q: string): Promise<string> {
    const query = toQueryText(q) || q;
    const vectorContext = await vectorQuery(findingId, query);
    if (vectorContext.trim()) return vectorContext;
    console.warn(`[STEP-ASK-ALL] ${findingId}: Pinecone empty for "${query.slice(0, 40)}..." — using raw transcript fallback`);
    return rawTranscript.substring(0, 4000);
  }

  // If no AST (simple question), use vector search + LLM
  if (ast.length === 0 || (ast.length === 1 && ast[0].length === 1 && !ast[0][0].flip)) {
    const context = await getContext(question.populated);
    const answer = await askQuestion(question.populated, context);
    await cacheAnswer(orgId, findingId, question.populated, answer);
    const answered = answerQuestion(question, answer);
    answered.snippet = context;
    return answered;
  }

  // Resolve compound AST
  const orResults: Array<Array<{ answer: boolean; thinking: string; defense: string; snippet: string }>> = [];

  for (const andNodes of ast) {
    const andResults: Array<{ answer: boolean; thinking: string; defense: string; snippet: string }> = [];

    // Build a combined Pinecone query from transcript-lookup nodes only.
    // Logical/semantic nodes ("Does 'X' include 'Y'?") don't need specific transcript context
    // and contaminate the combined query, pulling Pinecone toward the wrong section.
    // Transcript-lookup nodes reliably contain "team member" in this question corpus.
    // If no transcript nodes exist in the group, fall back to using all nodes.
    const transcriptNodes = andNodes.filter((n) =>
      toQueryText(n.question).toLowerCase().includes("team member")
    );
    const queryNodes = transcriptNodes.length > 0 ? transcriptNodes : andNodes;
    const combinedQuery = queryNodes.map((n) => toQueryText(n.question)).filter(Boolean).join(" ");
    const sharedContext = await getContext(combinedQuery || andNodes[0].question);

    for (const node of andNodes) {
      const llmAnswer = await askQuestion(node.question, sharedContext);
      const boolAnswer = strToBool(llmAnswer.answer);

      if (boolAnswer === null) {
        // LLM returned ambiguous text — with the lenient strToBool above this should be rare.
        // Log and treat as No so compound evaluation can proceed rather than silently bailing.
        console.warn(`[STEP-ASK-ALL] ${findingId}: "${question.header}" node returned ambiguous answer "${llmAnswer.answer}", treating as No`);
        andResults.push({ answer: false, thinking: llmAnswer.thinking, defense: llmAnswer.defense, snippet: sharedContext });
        continue;
      }

      const finalBool = node.flip ? !boolAnswer : boolAnswer;
      console.log(`[STEP-ASK-ALL] ${findingId}: "${question.header}" node="${node.question.slice(0, 60)}..." → ${llmAnswer.answer}${node.flip ? ` (flipped→${finalBool})` : ""}`);
      andResults.push({ answer: finalBool, thinking: llmAnswer.thinking, defense: llmAnswer.defense, snippet: sharedContext });
    }

    orResults.push(andResults);
  }

  // Evaluate: AND within groups, OR across groups
  const andBoolResults = orResults.map((group) => group.every((r) => r.answer));
  const orResult = andBoolResults.some((r) => r);

  // Collect thinking/defense/snippets from all nodes
  const allThinking = orResults.flat().map((r) => r.thinking);
  const allDefense = orResults.flat().map((r) => r.defense);
  const allSnippets = orResults.flat().map((r) => r.snippet);

  // For compound questions (multiple AST nodes), summarize thinking/defense into one coherent output
  let thinking: string;
  let defense: string;
  if (allThinking.length === 1) {
    thinking = allThinking[0];
    defense = allDefense[0];
  } else {
    [thinking, defense] = await Promise.all([summarize(allThinking), summarize(allDefense)]);
  }

  const finalAnswer: ILlmQuestionAnswer = {
    answer: orResult ? "Yes" : "No",
    thinking,
    defense,
  };

  await cacheAnswer(orgId, findingId, question.populated, finalAnswer);
  const answered = answerQuestion(question, finalAnswer);
  answered.snippet = allSnippets.length === 1 ? allSnippets[0] : allSnippets.join("\n---\n");
  return answered;
}

export async function stepAskAll(req: Request): Promise<Response> {
  const body = await req.json();
  const { findingId, orgId, adminRetry } = body;

  const stepStart = Date.now();
  console.log(`[STEP-ASK-ALL] ${findingId}: 🚀 Starting...`);
  trackActive(orgId, findingId, "ask-all").catch(() => {});

  const finding = await getFinding(orgId, findingId);
  if (!finding) return json({ error: "finding not found" }, 404);
  if (finding.findingStatus === "terminated" || finding.findingStatus === "finished") {
    console.log(`[STEP-ASK-ALL] ${findingId}: Skipped — finding already ${finding.findingStatus}`);
    return json({ ok: true, skipped: true, reason: finding.findingStatus });
  }

  // Read from dedicated chunked KV key first (survives finding trim), fall back to finding
  const allPopulated = await getPopulatedQuestions(orgId, findingId) ?? finding.populatedQuestions ?? [];
  const questions: IQuestion[] = allPopulated;
  const rawTranscript = finding.rawTranscript ?? "";

  if (questions.length === 0) {
    console.log(`[STEP-ASK-ALL] ${findingId}: No questions, going straight to finalize`);
    const dispatch = adminRetry ? publishStep : enqueueStep;
    await dispatch("finalize", { findingId, orgId, totalBatches: 0 });
    return json({ ok: true, answers: 0 });
  }

  // Upload transcript to Pinecone in the background — questions already fall back to rawTranscript
  // if Pinecone is empty, so the critical path never waits on this.
  if (rawTranscript && !rawTranscript.includes("Invalid Genie") && !rawTranscript.includes("Genie Invalid")) {
    const uploadStart = Date.now();
    console.log(`[STEP-ASK-ALL] ${findingId}: 🔼 Pinecone upload started (background)`);
    Promise.race([
      pineconeUpload(findingId, rawTranscript),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timed out after 60s")), 60_000)),
    ]).then(() => {
      console.log(`[STEP-ASK-ALL] ${findingId}: ✅ Pinecone upload done in ${Date.now() - uploadStart}ms`);
    }).catch((err) => {
      console.error(`[STEP-ASK-ALL] ${findingId}: ⚠️ Pinecone upload failed (questions using raw transcript):`, err);
    });
  }

  // Hard ceiling: 15 minutes for all questions. Per-call timeouts in groq/pinecone should
  // catch hangs first, but this is the last line of defense so the step never runs forever.
  const STEP_TIMEOUT_MS = 15 * 60 * 1000;
  const stepController = new AbortController();
  const stepTimeoutId = setTimeout(() => stepController.abort(), STEP_TIMEOUT_MS);

  console.log(`[STEP-ASK-ALL] ${findingId}: Answering ${questions.length} questions in parallel (100ms stagger)`);

  // Answer all questions in parallel with 100ms stagger to avoid Groq burst limits.
  // Each question waits index*100ms before firing (q0=0ms, q1=100ms, q2=200ms...).
  // Promise.all means they all run concurrently — no waiting for previous to finish.
  const answers: IAnsweredQuestion[] = await Promise.race([
    Promise.all(
      questions.map(async (q, index) => {
        await new Promise((r) => setTimeout(r, index * 100));
        try {
          const qStart = Date.now();
          const result = await askLlmOne(q, orgId, findingId, rawTranscript);
          const qDuration = Date.now() - qStart;
          if (qDuration > 10000) {
            console.warn(`[STEP-ASK-ALL] ${findingId}: ⚠️ Slow question "${q.header}" took ${qDuration}ms`);
          }
          return result;
        } catch (err: any) {
          const msg = err.message || String(err);
          console.error(`[STEP-ASK-ALL] ${findingId}: ❌ Question "${q.header}" failed:`, err);
          return answerQuestion(q, { answer: "Error", thinking: msg, defense: "N/A" });
        }
      })
    ),
    new Promise<never>((_, reject) =>
      stepController.signal.addEventListener("abort", () =>
        reject(new Error(`step exceeded ${STEP_TIMEOUT_MS / 60000} minute ceiling`))
      )
    ),
  ]).finally(() => clearTimeout(stepTimeoutId));

  const elapsedSec = ((Date.now() - stepStart) / 1000).toFixed(1);
  const yeses = answers.filter((a) => a.answer === "Yes").length;
  const nos = answers.filter((a) => a.answer === "No").length;
  console.log(`[STEP-ASK-ALL] ${findingId}: ✅ All ${answers.length} questions done in ${elapsedSec}s — ${yeses} Yes, ${nos} No`);

  // Save answers as batch 0, totalBatches=1 (compatible with finalize's getAllBatchAnswers)
  await saveBatchAnswers(orgId, findingId, 0, answers);

  const dispatch = adminRetry ? publishStep : enqueueStep;
  await dispatch("finalize", { findingId, orgId, totalBatches: 1 });

  return json({ ok: true, answers: answers.length, yeses, nos, elapsedSec });
}
