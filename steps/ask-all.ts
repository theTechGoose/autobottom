/** STEP 4 (alt): Answer ALL questions in a single Promise.all — no fan-out overhead. Like OmniSource's approach. */
import { getFinding, getCachedAnswer, cacheAnswer, saveBatchAnswers, trackActive, getPopulatedQuestions } from "../lib/kv.ts";
import { enqueueStep, publishStep } from "../lib/queue.ts";
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

function strToBool(s: string): boolean | null {
  const lower = s.trim().toLowerCase();
  if (["yes", "y", "true", "1"].includes(lower)) return true;
  if (["no", "n", "false", "0"].includes(lower)) return false;
  return null;
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

  /** Query vector store, falling back to raw transcript if Pinecone returns empty. */
  async function getContext(q: string): Promise<string> {
    const vectorContext = await vectorQuery(findingId, q);
    if (vectorContext.trim()) return vectorContext;
    console.warn(`[STEP-ASK-ALL] ${findingId}: Pinecone empty for "${q.slice(0, 40)}..." — using raw transcript fallback`);
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

    for (const node of andNodes) {
      const context = await getContext(node.question);
      const llmAnswer = await askQuestion(node.question, context);
      const boolAnswer = strToBool(llmAnswer.answer);

      if (boolAnswer === null) {
        // Fallback: ask LLM with full question
        const fullContext = await getContext(question.populated);
        const fallbackAnswer = await askQuestion(question.populated, fullContext);
        await cacheAnswer(orgId, findingId, question.populated, fallbackAnswer);
        const answered = answerQuestion(question, fallbackAnswer);
        answered.snippet = fullContext;
        return answered;
      }

      const finalBool = node.flip ? !boolAnswer : boolAnswer;
      andResults.push({ answer: finalBool, thinking: llmAnswer.thinking, defense: llmAnswer.defense, snippet: context });
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

  console.log(`[STEP-ASK-ALL] ${findingId}: Answering ${questions.length} questions in parallel (100ms stagger)`);

  // Answer all questions in parallel with 100ms stagger to avoid Groq burst limits.
  // Each question waits index*100ms before firing (q0=0ms, q1=100ms, q2=200ms...).
  // Promise.all means they all run concurrently — no waiting for previous to finish.
  const answers: IAnsweredQuestion[] = await Promise.all(
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
  );

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
