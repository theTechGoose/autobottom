/** STEP 5: Finalize - collect answers, bad words, webhook, save to external Deno KV. */
import { getFinding, saveFinding, getAllBatchAnswers, getJob, saveJob, trackCompleted, fireWebhook } from "../lib/kv.ts";
import { enqueueCleanup } from "../lib/queue.ts";
import { checkFinding } from "../providers/bad-words.ts";
import { generateFeedback } from "../providers/groq.ts";
import { answerQuestion } from "../types/mod.ts";
import type { IAnsweredQuestion } from "../types/mod.ts";
import { populateReviewQueue } from "../review/kv.ts";
import { env } from "../env.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function safeFetch(url: string, options: RequestInit) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function stepFinalize(req: Request): Promise<Response> {
  const body = await req.json();
  const { findingId, totalBatches } = body;

  console.log(`[STEP-FINALIZE] ${findingId}: Starting finalization...`);

  const finding = await getFinding(findingId);
  if (!finding) return json({ error: "finding not found" }, 404);

  // Collect batch answers if we have them
  if (totalBatches && totalBatches > 0) {
    const allAnswers = await getAllBatchAnswers(findingId, totalBatches);
    finding.answeredQuestions = allAnswers;
  }

  // Handle invalid recordings - fail all questions
  const isInvalid = finding.rawTranscript?.includes("Invalid Genie") ||
    finding.rawTranscript?.includes("Genie Invalid") ||
    finding.findingStatus === "no recording";

  if (isInvalid && finding.populatedQuestions?.length) {
    const badId = finding.recordingId || "Unknown/Missing";
    finding.answeredQuestions = finding.populatedQuestions.map((q: any) =>
      answerQuestion(q, {
        answer: "No",
        thinking: `The provided Recording ID (${badId}) was invalid, missing, or could not be downloaded.`,
        defense: "N/A - No Audio",
      })
    );
    finding.feedback = {
      heading: "Audit Failed",
      text: `Audit Failed: The recording file for ID ${badId} could not be located.`,
      viewUrl: "",
      disputeUrl: `${env.selfUrl}/audit/appeal?findingId=${findingId}`,
      recordingUrl: `${env.selfUrl}/audit/recording?id=${findingId}`,
    };
  }

  // Bad word detection (only for valid recordings from Genie)
  if (finding.recordingIdField === "Genie" && finding.rawTranscript && !isInvalid) {
    try {
      await checkFinding(finding);
    } catch (err) {
      console.error(`[STEP-FINALIZE] ${findingId}: Bad word check failed:`, err);
    }
  }

  // Generate feedback if not already set
  if (!finding.feedback?.text && finding.answeredQuestions?.length) {
    try {
      const failedQs = (finding.answeredQuestions as IAnsweredQuestion[])
        .filter((a) => String(a.answer ?? "").toLowerCase() === "no")
        .map((a) => `Question: ${a.populated}\nThinking: ${a.thinking}\nDefense: ${a.defense}`)
        .join("\n\n");

      if (failedQs) {
        const feedbackText = await generateFeedback(failedQs);
        finding.feedback = {
          heading: "Audit Feedback",
          text: feedbackText,
          viewUrl: `https://ai-audits.thetechgoose.deno.net/get?id=${findingId}`,
          disputeUrl: `${env.selfUrl}/audit/appeal?findingId=${findingId}`,
          recordingUrl: `${env.selfUrl}/audit/recording?id=${findingId}`,
        };
      }
    } catch (err) {
      console.error(`[STEP-FINALIZE] ${findingId}: Feedback generation failed:`, err);
    }
  }

  finding.findingStatus = "finished";
  await saveFinding(finding);
  await trackCompleted(findingId);

  // Populate review queue with "No" answers
  if (finding.answeredQuestions?.length) {
    try {
      await populateReviewQueue(findingId, finding.answeredQuestions as any[]);
    } catch (err) {
      console.error(`[STEP-FINALIZE] ${findingId}: Review queue population failed:`, err);
    }
  }

  // Post to webhook
  const webhook = finding.updateEndpoint;
  if (webhook && webhook !== "none") {
    try {
      const sanitized = JSON.parse(JSON.stringify(finding));
      if (sanitized.record) {
        for (const key in sanitized.record) {
          if (typeof sanitized.record[key] === "string" && sanitized.record[key].length > 10000) {
            sanitized.record[key] = sanitized.record[key].substring(0, 1000) + "... [TRUNCATED]";
          }
        }
      }
      await safeFetch(webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ findingId, finding: sanitized, emittedAt: new Date().toISOString() }),
      });
      console.log(`[STEP-FINALIZE] ${findingId}: Posted to webhook`);
    } catch (err) {
      console.error(`[STEP-FINALIZE] ${findingId}: Webhook failed:`, err);
    }
  }

  // Post to external Deno KV
  await postToDeno(finding);

  // Update job status
  if (finding.auditJobId) {
    try {
      const job = await getJob(finding.auditJobId);
      if (job) {
        const recordId = finding.record?.RecordId ?? finding.recordingId ?? findingId;
        if (!job.doneAuditIds) job.doneAuditIds = [];
        if (!job.doneAuditIds.some((a: any) => a.auditId === findingId)) {
          job.doneAuditIds.push({ auditId: findingId, auditRecord: String(recordId) });
        }
        if (job.doneAuditIds.length >= (job.recordsToAudit?.length ?? 0)) {
          job.status = "finished";
        }
        await saveJob(job);
      }
    } catch (err) {
      console.error(`[STEP-FINALIZE] ${findingId}: Job update failed:`, err);
    }
  }

  const nos = (finding.answeredQuestions as any[])?.filter((q: any) => q.answer === "No").length ?? 0;
  const yeses = (finding.answeredQuestions as any[])?.filter((q: any) => q.answer === "Yes").length ?? 0;
  console.log(`[STEP-FINALIZE] ${findingId}: Complete - ${yeses} Yes, ${nos} No`);

  // 100% first pass -- audit is terminated, no review needed
  if (nos === 0 && yeses > 0) {
    fireWebhook("terminate", {
      findingId,
      finding,
      answeredQuestions: finding.answeredQuestions,
      score: 100,
      reason: "perfect_score",
      terminatedAt: new Date().toISOString(),
    }).catch((err) => console.error(`[STEP-FINALIZE] ${findingId}: Terminate webhook failed:`, err));
  }

  // Enqueue cleanup in 24 hours
  await enqueueCleanup({ findingId, pineconeNamespace: findingId }, 86400);

  return json({ ok: true, yeses, nos });
}

async function postToDeno(finding: Record<string, any>) {
  const DENO_URL = "https://ai-audits.thetechgoose.deno.net";
  const CHUNK_SIZE = 50_000;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  async function safeFetchLocal(url: string, options: RequestInit) {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  }

  try {
    // Phase 1: Core fields
    const core = {
      id: finding.id,
      auditJobId: finding.auditJobId,
      findingStatus: finding.findingStatus,
      recordingIdField: finding.recordingIdField,
      recordingId: finding.recordingId,
      recordingPath: finding.recordingPath,
      job: finding.job,
      feedback: finding.feedback,
    };

    await safeFetchLocal(`${DENO_URL}/store`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(core),
    });

    // Phase 2: Large chunked fields
    const largeFields: Record<string, string> = {
      rawTranscript: finding.rawTranscript ?? "",
      fixedTranscript: finding.fixedTranscript ?? "",
      diarizedTranscript: finding.diarizedTranscript ?? "",
      answeredQuestions: JSON.stringify(finding.answeredQuestions ?? []),
      populatedQuestions: JSON.stringify(finding.populatedQuestions ?? []),
      unpopulatedQuestions: JSON.stringify(finding.unpopulatedQuestions ?? []),
      record: JSON.stringify(finding.record ?? {}),
    };

    for (const [field, value] of Object.entries(largeFields)) {
      if (!value) continue;
      const chunks: string[] = [];
      for (let i = 0; i < value.length; i += CHUNK_SIZE) {
        chunks.push(value.slice(i, i + CHUNK_SIZE));
      }
      await safeFetchLocal(`${DENO_URL}/store-chunk`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: finding.id, field, chunks }),
      });
    }

    console.log(`[DENO] ${finding.id}: Upload complete`);
  } catch (err) {
    console.error(`[DENO] ${finding.id}: Upload failed:`, err);
  } finally {
    clearTimeout(timeoutId);
  }
}
