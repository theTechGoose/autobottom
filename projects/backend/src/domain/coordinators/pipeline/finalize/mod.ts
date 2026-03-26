/** STEP 5: Finalize - collect answers, webhook, save to external Deno KV. */
import { getFinding, saveFinding, getAllBatchAnswers, getJob, saveJob, trackCompleted, fireWebhook, getBadgeStats, updateBadgeStats, getEarnedBadges, awardBadge, awardXp, emitEvent, checkAndEmitPrefab } from "../../../data/kv/mod.ts";
import { enqueueCleanup } from "../../../data/queue/mod.ts";

import { generateFeedback } from "../../../data/groq/mod.ts";
import { answerQuestion } from "../../../../../types/mod.ts";
import type { IAnsweredQuestion } from "../../../../../types/mod.ts";
import { populateReviewQueue } from "../../review/mod.ts";
import { populateJudgeQueue, saveAppeal } from "../../judge/mod.ts";
import { checkBadges } from "../../../business/gamification/badges/mod.ts";
import { env } from "../../../../../env.ts";

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
  const { findingId, orgId, totalBatches } = body;

  console.log(`[STEP-FINALIZE] ${findingId}: Starting finalization...`);

  const finding = await getFinding(orgId, findingId);
  if (!finding) return json({ error: "finding not found" }, 404);

  const isAppealReAudit = !!(finding as Record<string, any>).appealSourceFindingId;

  // Collect batch answers if we have them
  if (totalBatches && totalBatches > 0) {
    const allAnswers = await getAllBatchAnswers(orgId, findingId, totalBatches);
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
          viewUrl: `${env.denoKvUrl}/get?id=${findingId}`,
          disputeUrl: `${env.selfUrl}/audit/appeal?findingId=${findingId}`,
          recordingUrl: `${env.selfUrl}/audit/recording?id=${findingId}`,
        };
      }
    } catch (err) {
      console.error(`[STEP-FINALIZE] ${findingId}: Feedback generation failed:`, err);
    }
  }

  finding.findingStatus = "finished";
  await saveFinding(orgId, finding);
  await trackCompleted(orgId, findingId);

  // Route to appropriate queue
  if (finding.answeredQuestions?.length) {
    try {
      if (isAppealReAudit) {
        // Appeal re-audits go to judge queue (ALL questions, not just "No")
        const f = finding as Record<string, any>;
        await populateJudgeQueue(orgId, findingId, finding.answeredQuestions as any[], f.appealType);
        await saveAppeal(orgId, {
          findingId,
          appealedAt: Date.now(),
          status: "pending",
          auditor: finding.owner,
          comment: f.appealComment,
        });
        console.log(`[STEP-FINALIZE] ${findingId}: Appeal re-audit routed to judge queue`);
      } else {
        // Normal audits go to review queue with "No" answers
        await populateReviewQueue(orgId, findingId, finding.answeredQuestions as any[]);
      }
    } catch (err) {
      console.error(`[STEP-FINALIZE] ${findingId}: Queue population failed:`, err);
    }
  }

  // Emit audit-completed event for the agent
  if (finding.owner) {
    const score = finding.answeredQuestions?.length
      ? Math.round((finding.answeredQuestions.filter((q: any) => q.answer === "Yes").length / finding.answeredQuestions.length) * 100)
      : 0;
    emitEvent(orgId, finding.owner, "audit-completed", {
      findingId,
      score,
      recordingId: finding.recordingId,
    }).catch((err) => console.error(`[STEP-FINALIZE] ${findingId}: emitEvent failed:`, err));
  }

  // Award agent XP + check badges
  if (finding.owner && finding.answeredQuestions?.length) {
    try {
      const qs = finding.answeredQuestions as any[];
      const totalQ = qs.length;
      const passedQ = qs.filter((q: any) => q.answer === "Yes").length;
      const score = totalQ > 0 ? Math.round((passedQ / totalQ) * 100) : 0;

      // XP formula: floor(score * 0.3) + bonuses
      let xp = Math.floor(score * 0.3);
      if (score === 100) xp += 50;       // perfect bonus
      else if (score >= 90) xp += 20;    // high bonus

      // Update badge stats
      const stats = await getBadgeStats(orgId, finding.owner);
      stats.totalAudits++;
      if (score === 100) stats.perfectScoreCount++;

      // Running average score
      const prevTotal = stats.avgScore * stats.auditsForAvg;
      stats.auditsForAvg++;
      stats.avgScore = Math.round((prevTotal + score) / stats.auditsForAvg * 100) / 100;

      // Update streak
      const today = new Date().toISOString().slice(0, 10);
      if (stats.lastActiveDate !== today) {
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        stats.dayStreak = stats.lastActiveDate === yesterday ? stats.dayStreak + 1 : 1;
        stats.lastActiveDate = today;
      }

      await updateBadgeStats(orgId, finding.owner, stats);

      const earned = await getEarnedBadges(orgId, finding.owner);
      const earnedSet = new Set(earned.map((b) => b.badgeId));
      const newBadges = checkBadges("agent", stats, earnedSet);

      let badgeXp = 0;
      for (const badge of newBadges) {
        await awardBadge(orgId, finding.owner, badge);
        badgeXp += badge.xpReward;
      }

      const awardResult = await awardXp(orgId, finding.owner, xp + badgeXp, "agent");
      if (newBadges.length) {
        console.log(`[STEP-FINALIZE] ${findingId}: Agent ${finding.owner} earned ${newBadges.length} badge(s)`);
        for (const badge of newBadges) {
          checkAndEmitPrefab(orgId, "badge_earned", finding.owner, `${finding.owner.split("@")[0]} earned ${badge.name}!`)
            .catch(() => {});
        }
      }

      // Broadcast: sale_completed
      checkAndEmitPrefab(orgId, "sale_completed", finding.owner, `${finding.owner.split("@")[0]} completed an audit!`)
        .catch(() => {});

      // Broadcast: perfect_score
      if (score === 100) {
        checkAndEmitPrefab(orgId, "perfect_score", finding.owner, `${finding.owner.split("@")[0]} got a perfect score!`)
          .catch(() => {});
      }

      // Broadcast: streak milestones
      if (awardResult.state.dayStreak === 7 || awardResult.state.dayStreak === 14 || awardResult.state.dayStreak === 30) {
        checkAndEmitPrefab(orgId, "streak_milestone", finding.owner, `${finding.owner.split("@")[0]} hit a ${awardResult.state.dayStreak}-day streak!`)
          .catch(() => {});
      }
    } catch (err) {
      console.error(`[STEP-FINALIZE] ${findingId}: Agent XP/badge error:`, err);
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
      const job = await getJob(orgId, finding.auditJobId);
      if (job) {
        const recordId = finding.record?.RecordId ?? finding.recordingId ?? findingId;
        if (!job.doneAuditIds) job.doneAuditIds = [];
        if (!job.doneAuditIds.some((a: any) => a.auditId === findingId)) {
          job.doneAuditIds.push({ auditId: findingId, auditRecord: String(recordId) });
        }
        if (job.doneAuditIds.length >= (job.recordsToAudit?.length ?? 0)) {
          job.status = "finished";
        }
        await saveJob(orgId, job);
      }
    } catch (err) {
      console.error(`[STEP-FINALIZE] ${findingId}: Job update failed:`, err);
    }
  }

  const nos = (finding.answeredQuestions as any[])?.filter((q: any) => q.answer === "No").length ?? 0;
  const yeses = (finding.answeredQuestions as any[])?.filter((q: any) => q.answer === "Yes").length ?? 0;
  console.log(`[STEP-FINALIZE] ${findingId}: Complete - ${yeses} Yes, ${nos} No`);

  // 100% first pass -- audit is terminated, no review needed (but appeal re-audits always go to judge)
  if (nos === 0 && yeses > 0 && !isAppealReAudit) {
    fireWebhook(orgId, "terminate", {
      findingId,
      finding,
      answeredQuestions: finding.answeredQuestions,
      score: 100,
      reason: "perfect_score",
      terminatedAt: new Date().toISOString(),
    }).catch((err) => console.error(`[STEP-FINALIZE] ${findingId}: Terminate webhook failed:`, err));
  }

  // Enqueue cleanup in 24 hours
  await enqueueCleanup({ findingId, orgId, pineconeNamespace: findingId }, 86400);

  return json({ ok: true, yeses, nos });
}

async function postToDeno(finding: Record<string, any>) {
  const DENO_URL = env.denoKvUrl;
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
