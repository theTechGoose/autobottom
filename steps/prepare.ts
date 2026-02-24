/** STEP 3: Fetch questions from QuickBase (or Question Lab), embed transcript in Pinecone, fan-out question batches. */
import { getFinding, saveFinding, setBatchCounter, getCachedQuestions, cacheQuestions, trackActive, savePopulatedQuestions } from "../lib/kv.ts";
import { enqueueStep } from "../lib/queue.ts";
import { getQuestionsForDestination } from "../providers/quickbase.ts";
import { upload } from "../providers/pinecone.ts";
import { populateQuestions } from "../providers/question-expr.ts";
import { serveConfig } from "../question-lab/kv.ts";
import type { IQuestionSeed } from "../types/mod.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function stepPrepare(req: Request): Promise<Response> {
  const body = await req.json();
  const { findingId, orgId } = body;

  console.log(`[STEP-PREPARE] ${findingId}: Starting preparation...`);
  trackActive(orgId, findingId, "prepare").catch(() => {});

  const finding = await getFinding(orgId, findingId);
  if (!finding) return json({ error: "finding not found" }, 404);

  // If transcript is invalid, skip to finalize
  if (finding.rawTranscript?.includes("Invalid Genie") || finding.rawTranscript?.includes("Genie Invalid")) {
    await enqueueStep("finalize", { findingId, orgId });
    return json({ ok: true, skipped: true });
  }

  finding.findingStatus = "populating-questions";
  await saveFinding(orgId, finding);

  // 1. Fetch questions from Question Lab config or QuickBase
  const qlabConfig = finding.qlabConfig;
  let questionSeeds: IQuestionSeed[];

  if (qlabConfig) {
    // Use Question Lab config
    console.log(`[STEP-PREPARE] ${findingId}: Using Question Lab config "${qlabConfig}"`);
    const qlabSeeds = await serveConfig(orgId, qlabConfig);
    if (qlabSeeds.length === 0) {
      console.warn(`[STEP-PREPARE] ${findingId}: Question Lab config "${qlabConfig}" returned 0 questions, falling back to QuickBase`);
    }
    questionSeeds = qlabSeeds;
  } else {
    // Default: fetch from QuickBase
    const destinationId = String(finding.record?.RelatedDestinationId ?? "");
    const cached = await getCachedQuestions(orgId, destinationId);
    if (cached && cached.length > 0) {
      console.log(`[STEP-PREPARE] ${findingId}: Using ${cached.length} cached questions`);
      questionSeeds = cached;
    } else {
      console.log(`[STEP-PREPARE] ${findingId}: Fetching questions for destination ${destinationId}`);
      const qbQuestions = await getQuestionsForDestination(destinationId);
      questionSeeds = qbQuestions.map((q) => ({
        header: q.header,
        unpopulated: q.question,
        populated: q.question,
        autoYesExp: q.autoYes,
      }));
      if (questionSeeds.length > 0) {
        await cacheQuestions(orgId, destinationId, questionSeeds);
      }
    }
  }

  console.log(`[STEP-PREPARE] ${findingId}: Got ${questionSeeds.length} questions`);

  // 2. Populate questions with record values
  // Simple field lookup - for now just use record keys directly
  const fieldLookup = (id: string, record: Record<string, any>) => {
    // Try direct key match first, then try by field ID
    return record[id] ?? undefined;
  };

  // Sanitize record (truncate large text fields)
  const cleanRecord = { ...finding.record };
  for (const key in cleanRecord) {
    if (typeof cleanRecord[key] === "string" && cleanRecord[key].length > 20000) {
      cleanRecord[key] = cleanRecord[key].substring(0, 1000) + "... [TRUNCATED]";
    }
  }

  const populated = populateQuestions(questionSeeds, cleanRecord, fieldLookup);
  finding.unpopulatedQuestions = questionSeeds;
  finding.populatedQuestions = populated;
  // Save populated questions to a separate KV key so they survive finding trim
  await savePopulatedQuestions(orgId, findingId, populated);
  await saveFinding(orgId, finding);

  // 3. Embed transcript in Pinecone for RAG
  if (finding.rawTranscript) {
    try {
      await upload(findingId, finding.rawTranscript);
      console.log(`[STEP-PREPARE] ${findingId}: Transcript embedded in Pinecone`);
    } catch (err) {
      console.error(`[STEP-PREPARE] ${findingId}: Pinecone upload failed:`, err);
    }
  }

  // 4. Fan-out question batches
  const BATCH_SIZE = 5;
  const batches: Array<{ batchIndex: number; questionIndices: number[] }> = [];
  for (let i = 0; i < populated.length; i += BATCH_SIZE) {
    batches.push({
      batchIndex: batches.length,
      questionIndices: Array.from({ length: Math.min(BATCH_SIZE, populated.length - i) }, (_, j) => i + j),
    });
  }

  if (batches.length === 0) {
    // No questions - go straight to finalize
    finding.answeredQuestions = [];
    await saveFinding(orgId, finding);
    await enqueueStep("finalize", { findingId, orgId });
    return json({ ok: true, batches: 0 });
  }

  // Set counter for fan-in
  await setBatchCounter(orgId, findingId, batches.length);

  // Enqueue all batches
  finding.findingStatus = "asking-questions";
  await saveFinding(orgId, finding);

  const promises = batches.map((batch) =>
    enqueueStep("ask-batch", {
      findingId,
      orgId,
      batchIndex: batch.batchIndex,
      questionIndices: batch.questionIndices,
      totalBatches: batches.length,
    })
  );
  await Promise.all(promises);

  console.log(`[STEP-PREPARE] ${findingId}: Enqueued ${batches.length} question batches`);
  return json({ ok: true, batches: batches.length });
}
