/** STEP 4: Answer a batch of questions via RAG + Groq LLM. */
import { getFinding, getCachedAnswer, cacheAnswer, saveBatchAnswers, decrementBatchCounter, getPopulatedQuestions } from "../src/audit/domain/data/audit-repository/mod.ts";
import { trackActive } from "../src/audit/domain/data/stats-repository/mod.ts";
import { getPipelineConfig } from "../src/admin/domain/data/admin-repository/mod.ts";
import { enqueueStep, publishStep } from "../src/core/domain/data/qstash/mod.ts";
import { askQuestion, summarize } from "../src/audit/domain/data/groq/mod.ts";
import { query as vectorQuery } from "../src/audit/domain/data/pinecone/mod.ts";
import { parseAst, evaluateAutoYes } from "../src/audit/domain/business/question-expr/mod.ts";
import { answerQuestion } from "../src/core/dto/types.ts";
import type { IQuestion, IAnsweredQuestion } from "../src/core/dto/types.ts";
type ILlmQuestionAnswer = { answer: string; thinking: string; defense: string };

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
      console.log(`[STEP-ASK] ${findingId}: Auto-Yes "${question.header}" — ${autoYes.message}`);
      return answerQuestion(question, { answer: "Yes", thinking: autoYes.message, defense: "Auto-Yes" });
    }
  }

  // Check cache
  const cached = await getCachedAnswer(orgId, findingId, question.populated);
  if (cached) return answerQuestion(question, cached);

  // Parse AST
  const questionWithAst = parseAst(question);
  const ast = questionWithAst.astResults?.ast ?? [];

  /** Query vector store, falling back to raw transcript if Pinecone returns empty. */
  async function getContext(q: string): Promise<string> {
    const vectorContext = await vectorQuery(findingId, q);
    if (vectorContext.trim()) return vectorContext;
    console.warn(`[STEP-ASK] ${findingId}: Pinecone empty for "${q.slice(0, 40)}..." — using raw transcript fallback`);
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

export async function stepAskBatch(req: Request): Promise<Response> {
  const body = await req.json();
  const { findingId, orgId, adminRetry, batchIndex, questionIndices, totalBatches, retryCount = 0 } = body;

  const stepStartMs = Date.now();
  console.log(`[STEP-ASK] ${findingId}: Batch ${batchIndex}/${totalBatches} started at ${new Date(stepStartMs).toISOString()} (${questionIndices.length} questions, attempt ${retryCount + 1})`);
  trackActive(orgId, findingId, `ask-batch-${batchIndex}`).catch(() => {});

  const finding = await getFinding(orgId, findingId);
  if (!finding) return json({ error: "finding not found" }, 404);
  if (finding.findingStatus === "terminated" || finding.findingStatus === "finished") {
    console.log(`[STEP-ASK] ${findingId}: Batch ${batchIndex} skipped — finding already ${finding.findingStatus}`);
    return json({ ok: true, skipped: true, reason: finding.findingStatus });
  }

  const pipelineCfg = await getPipelineConfig(orgId);

  // Read from dedicated chunked KV key first (survives finding trim), fall back to finding
  const allPopulated = await getPopulatedQuestions(orgId, findingId) ?? finding.populatedQuestions ?? [];
  const questions: IQuestion[] = allPopulated
    .filter((_: any, i: number) => questionIndices.includes(i));

  const rawTranscript = finding.rawTranscript ?? "";

  // Heartbeat: log every 15s so observability confirms batch hasn't hung
  const batchStart = Date.now();
  const heartbeat = setInterval(() => {
    const elapsed = Math.floor((Date.now() - batchStart) / 1000);
    console.log(`[STEP-ASK-HEARTBEAT] ${findingId} batch ${batchIndex} still running... (${elapsed}s elapsed)`);
  }, 15000);

  // Answer all questions in parallel with 100ms stagger to avoid Groq burst limits
  let batchError: Error | null = null;
  const answers: IAnsweredQuestion[] = await Promise.all(
    questions.map(async (q, index) => {
      await new Promise((r) => setTimeout(r, index * 100));
      try {
        const qStart = Date.now();
        const result = await askLlmOne(q, orgId, findingId, rawTranscript);
        const qDuration = Date.now() - qStart;
        if (qDuration > 10000) {
          console.warn(`[STEP-ASK-SLOW] ${findingId}: Question "${q.header}" took ${qDuration}ms`);
        }
        return result;
      } catch (err: any) {
        const msg = err.message || String(err);
        if (!batchError) batchError = new Error(msg);
        console.error(`[STEP-ASK] ${findingId}: Question "${q.header}" failed:`, err);
        return answerQuestion(q, { answer: "Error", thinking: msg, defense: "N/A" });
      }
    })
  );

  clearInterval(heartbeat);

  // On any error, retry via pipeline config settings (maxRetries, retryDelaySeconds)
  if (batchError) {
    if (retryCount < pipelineCfg.maxRetries) {
      const delay = pipelineCfg.retryDelaySeconds * Math.pow(2, retryCount);
      console.warn(`[STEP-ASK] ${findingId}: Batch ${batchIndex} error (attempt ${retryCount + 1}/${pipelineCfg.maxRetries}), retrying in ${delay}s — ${(batchError as Error).message.slice(0, 100)}`);
      await enqueueStep("ask-batch", { findingId, orgId, adminRetry, batchIndex, questionIndices, totalBatches, retryCount: retryCount + 1 }, delay);
      return json({ ok: true, retrying: true, attempt: retryCount + 1 });
    }
    console.error(`[STEP-ASK] ${findingId}: Batch ${batchIndex} exhausted ${pipelineCfg.maxRetries} retries — saving Error answers`);
  }

  // Save batch answers
  await saveBatchAnswers(orgId, findingId, batchIndex, answers);
  console.log(`[STEP-ASK] ${findingId}: Batch ${batchIndex} done (${answers.length} answers)`);

  // Fan-in: decrement counter
  const remaining = await decrementBatchCounter(orgId, findingId);
  console.log(`[STEP-ASK] ${findingId}: ${remaining} batches remaining`);

  if (remaining <= 0) {
    // Last batch - trigger finalize
    const dispatch = adminRetry ? publishStep : enqueueStep;
    await dispatch("finalize", { findingId, orgId, totalBatches });
  }

  return json({ ok: true, answers: answers.length, remaining });
}
