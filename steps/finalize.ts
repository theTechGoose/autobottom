/** STEP 5: Finalize - collect answers, webhook, save to external Deno KV. */
import { getFinding, saveFinding, getAllBatchAnswers, getJob, saveJob, trackCompleted, fireWebhook, getBadgeStats, updateBadgeStats, getEarnedBadges, awardBadge, awardXp, emitEvent, checkAndEmitPrefab } from "../lib/kv.ts";
import { enqueueCleanup } from "../lib/queue.ts";

import { generateFeedback } from "../providers/groq.ts";
import { answerQuestion } from "../types/mod.ts";
import type { IAnsweredQuestion } from "../types/mod.ts";
import { populateReviewQueue } from "../review/kv.ts";
import { populateJudgeQueue, saveAppeal, getAppeal } from "../judge/kv.ts";
import { checkBadges } from "../shared/badges.ts";
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
  const { findingId, orgId, totalBatches } = body;

  console.log(`[STEP-FINALIZE] ${findingId}: Starting finalization...`);

  const finding = await getFinding(orgId, findingId);
  if (!finding) return json({ error: "finding not found" }, 404);
  if (finding.findingStatus === "terminated") return json({ ok: true, skipped: true, reason: "terminated" });

  const appealType = String((finding as Record<string, any>).appealType ?? "");
  // Recording re-audits (different/additional/upload) are treated as normal audits for queue routing
  const RECORDING_REAUDIT_TYPES = ["different-recording", "additional-recording", "upload-recording"];
  const isRecordingReAudit = RECORDING_REAUDIT_TYPES.includes(appealType);
  // Judge appeal re-audits are findings that came from a formal judge appeal (not a recording swap)
  const isJudgeAppealReAudit = !!(finding as Record<string, any>).appealSourceFindingId && !isRecordingReAudit;

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

  const completedAt = Date.now();
  const startedAt = (finding as Record<string, any>).startedAt as number | undefined;
  const durationMs = startedAt ? completedAt - startedAt : undefined;
  const qs = finding.answeredQuestions as any[] | undefined;
  const score = isInvalid ? 0 : (qs?.length ? Math.round((qs.filter((q: any) => q.answer === "Yes").length / qs.length) * 100) : undefined);
  finding.findingStatus = "finished";
  (finding as Record<string, any>).completedAt = completedAt;
  await saveFinding(orgId, finding);
  const isPackage = finding.recordingIdField === "GenieNumber";
  const department = String(isPackage ? (finding.record?.OfficeName ?? "") : (finding.record?.ActivatingOffice ?? "")) || undefined;
  const rawVoName = (finding.record as any)?.VoName as string | undefined;
  const voName = rawVoName
    ? (rawVoName.includes(" - ") ? rawVoName.split(" - ").slice(1).join(" - ").trim() : rawVoName.trim()) || undefined
    : undefined;
  const reason = isInvalid ? "invalid_genie" : (score === 100 ? "perfect_score" : undefined);
  await trackCompleted(orgId, findingId, {
    recordId: String(finding.record?.RecordId ?? "") || undefined,
    isPackage,
    startedAt,
    durationMs,
    score,
    owner: finding.owner,
    department,
    voName,
    reason,
  });
  console.log(`[STEP-FINALIZE] ${findingId}: ✅ trackCompleted saved — score=${score ?? "?"}% owner=${finding.owner ?? "unknown"} dept=${department ?? "unknown"} type=${isPackage ? "package" : "date-leg"}`);

  // Route to review queue — skip Invalid Genie (no recording to review).
  // Formal judge appeals are handled upstream in handleFileAppeal (original finding), not here.
  if (!isInvalid && finding.answeredQuestions?.length) {
    try {
      const recordId = String(finding.record?.RecordId ?? "") || undefined;
      const rec = finding.record as any ?? {};
      const isPackage = finding.recordingIdField === "GenieNumber";
      const recordMeta = isPackage ? {
        guestName: rec.GuestName ? String(rec.GuestName) : undefined,
        maritalStatus: rec["67"] ? String(rec["67"]) : undefined,
        officeName: rec.OfficeName ? String(rec.OfficeName) : undefined,
        totalAmountPaid: rec["145"] ? String(rec["145"]) : undefined,
        hasMCC: rec["345"] ? String(rec["345"]) : undefined,
        mspSubscription: rec["306"] ? String(rec["306"]) : undefined,
      } : {
        guestName: rec.GuestName ? String(rec.GuestName) : (rec["32"] ? String(rec["32"]) : undefined),
        spouseName: rec["33"] ? String(rec["33"]) : undefined,
        maritalStatus: rec["49"] ? String(rec["49"]) : undefined,
        destination: rec.DestinationDisplay ? String(rec.DestinationDisplay) : (rec["314"] ? String(rec["314"]) : undefined),
        arrivalDate: rec["8"] ? String(rec["8"]) : undefined,
        departureDate: rec["10"] ? String(rec["10"]) : undefined,
        totalWGS: rec["460"] ? String(rec["460"]) : undefined,
        totalMCC: rec["594"] ? String(rec["594"]) : undefined,
      };
      await populateReviewQueue(orgId, findingId, finding.answeredQuestions as any[], finding.recordingIdField as string | undefined, recordId, recordMeta);
      console.log(`[STEP-FINALIZE] ${findingId}: → review queue${isRecordingReAudit ? ` (recording re-audit: ${appealType})` : ""}`);
    } catch (err) {
      console.error(`[STEP-FINALIZE] ${findingId}: Queue population failed:`, err);
    }
  } else if (isInvalid) {
    console.log(`[STEP-FINALIZE] ${findingId}: Skipping review queue — Invalid Genie`);
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

  // Post to webhook + external Deno KV concurrently
  const webhookPromise = (async () => {
    const webhook = finding.updateEndpoint;
    if (!webhook || webhook === "none") return;
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
  })();

  await Promise.allSettled([webhookPromise, postToDeno(finding)]);

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

  // Invalid Genie — fire terminate immediately, no review needed
  if (isInvalid) {
    console.log(`[STEP-FINALIZE] ${findingId}: 🔔 Firing terminate webhook (invalid_genie) orgId=${orgId}`);
    await fireWebhook(orgId, "terminate", {
      findingId,
      finding,
      answeredQuestions: finding.answeredQuestions,
      score: 0,
      reason: "invalid_genie",
      terminatedAt: new Date().toISOString(),
    }).catch((err) => console.error(`[STEP-FINALIZE] ${findingId}: Terminate webhook (invalid) failed:`, err));
  }

  // 100% -- no failing questions, fire terminate webhook (includes recording re-audits)
  if (nos === 0 && yeses > 0) {
    console.log(`[STEP-FINALIZE] ${findingId}: 🔔 Firing terminate webhook (perfect_score) orgId=${orgId}`);
    await fireWebhook(orgId, "terminate", {
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
  const CHUNK_SIZE = 25_000; // Deno KV 64KB limit; UTF-16 strings cost 2 bytes/char

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
