/** STEP 3: Fetch questions from QuickBase (or Question Lab), populate with record values, enqueue ask-all. */
import { getFinding, saveFinding, getCachedQuestions, cacheQuestions, getLastGoodQuestions, savePopulatedQuestions } from "@audit/domain/data/audit-repository/mod.ts";
import { trackActive } from "@audit/domain/data/stats-repository/mod.ts";
import { enqueueStep, publishStep } from "@core/data/qstash/mod.ts";
import { getQuestionsForDestination } from "@audit/domain/data/quickbase/mod.ts";
import { populateQuestions } from "@audit/domain/business/question-expr/mod.ts";
import { serveConfig, getInternalAssignments, getPartnerAssignments } from "@question-lab/domain/data/question-repository/mod.ts";
import type { IQuestionSeed } from "@core/dto/types.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function stepPrepare(req: Request): Promise<Response> {
  const body = await req.json();
  // rawTranscript carried in the payload by transcribe-cb to survive the
  // QStash isolate hop. Without this, getFinding can race transcribe-cb's
  // saveFinding and read the finding doc with `rawTranscript: undefined`.
  // step-prepare's saveFinding at the end of this handler would then OVERWRITE
  // the persisted value with undefined, destroying the transcript for every
  // downstream step (ask-all, ask-batch) and producing the no-score audit
  // class we've been chasing.
  const { findingId, orgId, adminRetry, rawTranscript: payloadRaw } = body;

  console.log(`[STEP-PREPARE] ${findingId}: Starting preparation...`);
  // Tracking owned by step dispatcher (main.ts) — see step-ask-all for context.

  try {
    const finding = await getFinding(orgId, findingId);
    if (!finding) return json({ error: "finding not found" }, 404);
    if (finding.findingStatus === "terminated") return json({ ok: true, skipped: true, reason: "terminated" });

    // Grep-able tag — see step-transcribe-cb for taxonomy.
    {
      const fromPayload = typeof payloadRaw === "string" && payloadRaw.length > 0;
      const fromFinding = !fromPayload && (finding.rawTranscript?.length ?? 0) > 0;
      const outcome = fromPayload ? "payload-hit" : fromFinding ? "payload-miss-finding-hit" : "BOTH-MISS";
      const log = outcome === "BOTH-MISS" ? console.warn : console.log;
      log(`🔍 [TRANSCRIPT-RACE] step=prepare fid=${findingId} ${outcome} payloadLen=${typeof payloadRaw === "string" ? payloadRaw.length : 0} findingLen=${finding.rawTranscript?.length ?? 0}`);
    }

    // CRITICAL: restore rawTranscript onto the finding from the payload BEFORE
    // any saveFinding below. If the finding doc raced and reads as missing,
    // the saveFinding at line ~190 of this file would persist the missing
    // value, wiping the transcript for downstream steps. Rescue happens here
    // and only when needed — if finding already has it, no-op.
    if (typeof payloadRaw === "string" && payloadRaw.length > 0 && !finding.rawTranscript) {
      finding.rawTranscript = payloadRaw;
      console.warn(`🛟 [TRANSCRIPT-RESCUE] step=prepare fid=${findingId} finding-doc-stale — restored rawTranscript from payload (${payloadRaw.length} chars)`);
    }

    // Resolved transcript value used by every downstream branch in this step.
    const rawTranscript = finding.rawTranscript ?? "";

    // If transcript is invalid, skip to finalize
    if (rawTranscript.includes("Invalid Genie") || rawTranscript.includes("Genie Invalid")) {
      const dispatch = adminRetry ? publishStep : enqueueStep;
      await dispatch("finalize", { findingId, orgId });
      return json({ ok: true, skipped: true });
    }

    console.log(`[STEP-PREPARE] ${findingId}: Saving status...`);
    finding.findingStatus = "populating-questions";
    await saveFinding(orgId, finding);

    // 1. Fetch questions from Question Lab config or QuickBase
    let qlabConfig = finding.qlabConfig;
    let questionSeeds: IQuestionSeed[];

    // For package audits (GenieNumber field), synthesize RelatedDestinationId from RelatedOfficeId
    // using the same office→destination mapping as the legacy auto-bot.
    // This runs before the qlabConfig check so that if qlabConfig is ever set on a package,
    // it still takes precedence (Question Lab migration path preserved).
    if (finding.recordingIdField === "GenieNumber" && !finding.record?.RelatedDestinationId) {
      const officeId = Number(finding.record?.RelatedOfficeId ?? 0);
      let destId: number;
      if (officeId === 127 || officeId === 199) {
        destId = 2701; // ZZZ - ECG
      } else if (
        officeId === 213 || officeId === 1307 ||
        [1291, 1394, 1395, 1396, 1397, 1398, 1399, 1400, 1401, 1402, 1403].includes(officeId)
      ) {
        destId = 2703; // ZZZ - MCC Only
      } else if (officeId === 1435) {
        destId = 2705; // ZZZ - CLW
      } else if (officeId === 1496) {
        destId = 2706; // ZZZ - ES3
      } else {
        destId = 2702; // ZZZ - Generic Package
      }
      finding.record = { ...finding.record, RelatedDestinationId: destId };
      console.log(`[STEP-PREPARE] ${findingId}: Package — mapped officeId=${officeId} → destinationId=${destId}`);
    }

    // If no explicit qlabConfig set, check per-destination / per-office assignments
    if (!qlabConfig) {
      const isPartner = finding.recordingIdField === "GenieNumber";
      if (isPartner) {
        const officeName = String(finding.record?.OfficeName ?? "");
        if (officeName) {
          const assignments = await getPartnerAssignments(orgId);
          // Exact match first
          qlabConfig = assignments[officeName] ?? null;
          // Prefix fallback: "JAY" matches "JAY777", "JAY321", etc. (longest prefix wins)
          if (!qlabConfig) {
            const lower = officeName.toLowerCase();
            let bestKey = "";
            for (const key of Object.keys(assignments)) {
              if (lower.startsWith(key.toLowerCase()) && key.length > bestKey.length) {
                bestKey = key;
              }
            }
            if (bestKey) qlabConfig = assignments[bestKey];
          }
          if (qlabConfig) console.log(`[STEP-PREPARE] ${findingId}: Partner assignment for office "${officeName}" → "${qlabConfig}"`);
        }
      } else {
        const destinationId = String(finding.record?.RelatedDestinationId ?? "");
        if (destinationId) {
          const assignments = await getInternalAssignments(orgId);
          qlabConfig = assignments[destinationId] ?? null;
          if (qlabConfig) console.log(`[STEP-PREPARE] ${findingId}: Internal assignment for dest "${destinationId}" → "${qlabConfig}"`);
        }
      }
    }

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
        try {
          const qbQuestions = await Promise.race([
            getQuestionsForDestination(destinationId),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`QB question fetch timed out after 90s (dest=${destinationId})`)), 90_000)
            ),
          ]);
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
        } catch (qbErr) {
          // QuickBase slow/down: fall back to the last-known-good questions for
          // this destination so a transient QB outage doesn't fatal the audit.
          // Without this, a brief QB slowdown thundering-herds every audit for
          // the dest into the same 90s timeout (5 findings died this way on
          // 2026-06-03). The cache miss above only means the 10-min fresh cache
          // expired — last-known-good has no TTL.
          const lastGood = await getLastGoodQuestions(orgId, destinationId);
          if (lastGood && lastGood.length > 0) {
            console.warn(`[STEP-PREPARE] ${findingId}: ⚠️ QB fetch failed (${(qbErr as Error).message}) — serving ${lastGood.length} last-known-good questions for dest ${destinationId}`);
            questionSeeds = lastGood;
          } else {
            console.error(`[STEP-PREPARE] ${findingId}: ❌ QB fetch failed and no last-known-good cache for dest ${destinationId}`);
            throw qbErr;
          }
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

    // 3. Bad word check for package records (off critical path).
    // Forward rawTranscript so bad-word-check doesn't race-read the finding
    // doc and silently skip (same class of bug as the transcript race).
    if (rawTranscript && finding.recordingIdField === "GenieNumber") {
      const bwPayload: Record<string, unknown> = { findingId, orgId };
      if (rawTranscript.length <= 900_000) bwPayload.rawTranscript = rawTranscript;
      enqueueStep("bad-word-check", bwPayload).catch((err) =>
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

    // Carry rawTranscript forward to ask-all so the grading steps don't have
    // to depend on this isolate's saveFinding propagating before they read.
    const askPayload: Record<string, unknown> = { findingId, orgId, adminRetry };
    if (rawTranscript && rawTranscript.length <= 900_000) askPayload.rawTranscript = rawTranscript;
    const dispatch = adminRetry ? publishStep : enqueueStep;
    await dispatch("ask-all", askPayload);

    console.log(`[STEP-PREPARE] ${findingId}: ✅ Enqueued ask-all for ${populated.length} questions`);
    return json({ ok: true, questions: populated.length });
  } catch (err: any) {
    console.error(`[STEP-PREPARE] ${findingId}: ❌ Fatal error:`, err);
    return json({ error: err.message || String(err) }, 500);
  }
}
