/** STEP 3: Fetch questions from QuickBase (or Question Lab), populate with record values, enqueue ask-all. */
import { getFinding, saveFinding, getCachedQuestions, cacheQuestions, trackActive, savePopulatedQuestions } from "../lib/kv.ts";
import { enqueueStep, publishStep } from "../lib/queue.ts";
import { getQuestionsForDestination } from "../providers/quickbase.ts";
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
  const { findingId, orgId, adminRetry } = body;

  console.log(`[STEP-PREPARE] ${findingId}: Starting preparation...`);
  trackActive(orgId, findingId, "prepare").catch(() => {});

  try {
    const finding = await getFinding(orgId, findingId);
    if (!finding) return json({ error: "finding not found" }, 404);
    if (finding.findingStatus === "terminated") return json({ ok: true, skipped: true, reason: "terminated" });

    // If transcript is invalid, skip to finalize
    if (finding.rawTranscript?.includes("Invalid Genie") || finding.rawTranscript?.includes("Genie Invalid")) {
      const dispatch = adminRetry ? publishStep : enqueueStep;
      await dispatch("finalize", { findingId, orgId });
      return json({ ok: true, skipped: true });
    }

    console.log(`[STEP-PREPARE] ${findingId}: Saving status...`);
    finding.findingStatus = "populating-questions";
    await saveFinding(orgId, finding);

    // 1. Fetch questions from Question Lab config or QuickBase
    const qlabConfig = finding.qlabConfig;
    let questionSeeds: IQuestionSeed[];

    if (qlabConfig) {
      console.log(`[STEP-PREPARE] ${findingId}: Using Question Lab config "${qlabConfig}"`);
      const qlabSeeds = await serveConfig(orgId, qlabConfig);
      if (qlabSeeds.length === 0) {
        console.warn(`[STEP-PREPARE] ${findingId}: Question Lab config "${qlabConfig}" returned 0 questions, falling back to QuickBase`);
      }
      questionSeeds = qlabSeeds;
    } else {
      const destinationId = String(finding.record?.RelatedDestinationId ?? "");
      console.log(`[STEP-PREPARE] ${findingId}: Checking question cache for destination ${destinationId}...`);
      const cached = await getCachedQuestions(orgId, destinationId);
      if (cached && cached.length > 0) {
        console.log(`[STEP-PREPARE] ${findingId}: Using ${cached.length} cached questions`);
        questionSeeds = cached;
      } else {
        console.log(`[STEP-PREPARE] ${findingId}: Fetching questions from QuickBase for destination ${destinationId}...`);
        const qbQuestions = await getQuestionsForDestination(destinationId);
        console.log(`[STEP-PREPARE] ${findingId}: Got ${qbQuestions.length} questions from QuickBase`);
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

    console.log(`[STEP-PREPARE] ${findingId}: Populating ${questionSeeds.length} questions...`);
    console.log(`[STEP-PREPARE] ${findingId}: record keys=${JSON.stringify(Object.keys(finding.record ?? {}))}`);

    // 2. Populate questions with record values
    const fieldLookup = (id: string, record: Record<string, any>) => record[id] ?? undefined;

    // Sanitize record (truncate large text fields)
    const cleanRecord = { ...finding.record };
    for (const key in cleanRecord) {
      if (typeof cleanRecord[key] === "string" && cleanRecord[key].length > 20000) {
        cleanRecord[key] = cleanRecord[key].substring(0, 1000) + "... [TRUNCATED]";
      }
    }

    const populated = populateQuestions(questionSeeds, cleanRecord, fieldLookup);

    // Log autoYes expressions after population so we can verify field values resolved correctly
    const autoYesPopulated = populated.filter((q) => q.autoYesExp).map((q) => `"${q.header}": ${q.autoYesExp}`);
    if (autoYesPopulated.length > 0) {
      console.log(`[STEP-PREPARE] ${findingId}: autoYes expressions after population:\n  ${autoYesPopulated.join("\n  ")}`);
    }

    console.log(`[STEP-PREPARE] ${findingId}: Saving ${populated.length} populated questions...`);
    finding.unpopulatedQuestions = questionSeeds;
    finding.populatedQuestions = populated;
    await savePopulatedQuestions(orgId, findingId, populated);
    await saveFinding(orgId, finding);

    // 3. Bad word check for package records (off critical path)
    if (finding.rawTranscript && finding.recordingIdField === "GenieNumber") {
      enqueueStep("bad-word-check", { findingId, orgId }).catch((err) =>
        console.error(`[STEP-PREPARE] ${findingId}: Failed to enqueue bad-word-check:`, err)
      );
    }

    if (populated.length === 0) {
      finding.answeredQuestions = [];
      await saveFinding(orgId, finding);
      const dispatch = adminRetry ? publishStep : enqueueStep;
      await dispatch("finalize", { findingId, orgId, totalBatches: 0 });
      return json({ ok: true, questions: 0 });
    }

    finding.findingStatus = "asking-questions";
    await saveFinding(orgId, finding);

    const dispatch = adminRetry ? publishStep : enqueueStep;
    await dispatch("ask-all", { findingId, orgId, adminRetry });

    console.log(`[STEP-PREPARE] ${findingId}: ✅ Enqueued ask-all for ${populated.length} questions`);
    return json({ ok: true, questions: populated.length });
  } catch (err: any) {
    console.error(`[STEP-PREPARE] ${findingId}: ❌ Fatal error:`, err);
    return json({ error: err.message || String(err) }, 500);
  }
}
