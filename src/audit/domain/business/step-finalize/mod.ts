/** STEP 5: Finalize - collect answers, webhook, save to external Deno KV. */
import { getFinding, saveFinding, getAllBatchAnswers, getJob, saveJob } from "@audit/domain/data/audit-repository/mod.ts";
import { trackCompleted, saveChargebackEntry, deleteChargebackEntry, writeAuditDoneIndex, saveWireDeductionEntry } from "@audit/domain/data/stats-repository/mod.ts";
import { getOfficeBypassConfig, getBonusPointsConfig } from "@admin/domain/data/admin-repository/mod.ts";
import { updatePartnerDimensions } from "@admin/domain/data/admin-repository/mod.ts";
import { getBadgeStats, updateBadgeStats, getEarnedBadges, awardBadge, awardXp } from "@gamification/domain/data/gamification-repository/mod.ts";
import { getGameState, saveGameState } from "@gamification/domain/data/gamification-repository/mod.ts";
import { emitEvent, checkAndEmitPrefab } from "@events/domain/data/events-repository/mod.ts";
import { fireWebhook } from "@admin/domain/data/admin-repository/mod.ts";
import { enqueueCleanup } from "@core/data/qstash/mod.ts";

import { generateFeedback } from "@audit/domain/data/groq/mod.ts";
import { answerQuestion } from "@core/dto/types.ts";
import type { IAnsweredQuestion } from "@core/dto/types.ts";
import { populateReviewQueue } from "@review/domain/business/review-queue/mod.ts";
import { populateJudgeQueue, getAppeal, saveAppeal } from "@judge/domain/data/judge-repository/mod.ts";
import { checkBadges } from "@gamification/domain/business/badge-system/mod.ts";

import { sendEmail } from "@reporting/domain/data/postmark/mod.ts";

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
      disputeUrl: `${Deno.env.get("SELF_URL") ?? "http://localhost:3000"}/audit/appeal?findingId=${findingId}`,
      recordingUrl: `${Deno.env.get("SELF_URL") ?? "http://localhost:3000"}/audit/recording?id=${findingId}`,
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
          viewUrl: `${Deno.env.get("KV_SERVICE_URL") ?? ""}/get?id=${findingId}`,
          disputeUrl: `${Deno.env.get("SELF_URL") ?? "http://localhost:3000"}/audit/appeal?findingId=${findingId}`,
          recordingUrl: `${Deno.env.get("SELF_URL") ?? "http://localhost:3000"}/audit/recording?id=${findingId}`,
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

  // Bonus points: auto-flip eligible "No" answers before scoring (Question Lab audits only)
  if (!isInvalid && qs?.length) {
    try {
      const bonusCfg = await getBonusPointsConfig(orgId);
      const isPackageBp = finding.recordingIdField === "GenieNumber";
      const bonusBudget = isPackageBp ? bonusCfg.partnerBonusPoints : bonusCfg.internalBonusPoints;
      if (bonusBudget > 0) {
        let remaining = bonusBudget;
        let flipped = 0;
        for (const q of qs) {
          if (q.answer !== "No") continue;
          if (q.egregious) continue;
          const weight = q.weight ?? 5;
          if (remaining >= weight) {
            q.answer = "Yes";
            q.bonusFlipped = true;
            remaining -= weight;
            flipped++;
          }
        }
        if (flipped > 0) {
          console.log(`[STEP-FINALIZE] ${findingId}: 🎁 Bonus flipped ${flipped} question(s) (budget=${bonusBudget}, remaining=${remaining})`);
        }
      }
    } catch (err) {
      console.error(`[STEP-FINALIZE] ${findingId}: ⚠️ Bonus points check failed:`, err);
    }
  }

  const score = isInvalid ? 0 : (qs?.length ? Math.round((qs.filter((q: any) => q.answer === "Yes").length / qs.length) * 100) : undefined);
  finding.findingStatus = "finished";
  (finding as Record<string, any>).completedAt = completedAt;
  await saveFinding(orgId, finding);

  // Test audits: skip ALL live writes; send result email; only keep job updated.
  if ((finding as Record<string, any>).isTest) {
    console.log(`[STEP-FINALIZE] ${findingId}: 🧪 Test audit — skipping live writes, sending result email`);
    sendTestAuditEmail(finding, score).catch((err) =>
      console.error(`[STEP-FINALIZE] ${findingId}: ❌ Test email failed:`, err)
    );
    try {
      const job = await getJob(orgId, finding.auditJobId);
      if (job) {
        const recordId = finding.record?.RecordId ?? finding.recordingId ?? findingId;
        if (!job.doneAuditIds) job.doneAuditIds = [];
        if (!job.doneAuditIds.some((a: any) => a.auditId === findingId)) {
          job.doneAuditIds.push({ auditId: findingId, auditRecord: String(recordId) });
        }
        if (job.doneAuditIds.length >= (job.recordsToAudit?.length ?? 0)) job.status = "finished";
        await saveJob(orgId, job);
      }
    } catch {}
    await enqueueCleanup({ findingId, orgId, pineconeNamespace: findingId }, 86400);
    return json({ ok: true, test: true });
  }

  const isPackage = finding.recordingIdField === "GenieNumber";
  const department = String(isPackage ? (finding.record?.OfficeName ?? "") : (finding.record?.ActivatingOffice ?? "")) || undefined;
  const bypassCfg = await getOfficeBypassConfig(orgId);
  const isOfficeBypassed = bypassCfg.patterns.length > 0 && !!department &&
    bypassCfg.patterns.some((p) => department.toLowerCase().includes(p.toLowerCase()));
  if (isOfficeBypassed) console.log(`[STEP-FINALIZE] ${findingId}: ⚠️ Office "${department}" is bypassed — skipping review queue + audit email`);
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
    shift: isPackage ? undefined : String((finding.record as any)?.Shift ?? "") || undefined,
  });
  console.log(`[STEP-FINALIZE] ${findingId}: ✅ trackCompleted saved — score=${score ?? "?"}% owner=${finding.owner ?? "unknown"} dept=${department ?? "unknown"} type=${isPackage ? "package" : "date-leg"}`);

  // Write secondary index entry for email reporting
  try {
    const isAutoComplete = isInvalid || score === 100;
    await writeAuditDoneIndex(orgId, {
      findingId,
      completedAt,
      score: score ?? 0,
      completed: isAutoComplete,
      ...(isAutoComplete ? { doneAt: completedAt, reason: reason! } : {}),
      recordId: String((finding.record as any)?.RecordId ?? "") || undefined,
      isPackage,
      voName,
      owner: finding.owner,
      department,
      shift: isPackage ? undefined : String((finding.record as any)?.Shift ?? "") || undefined,
      startedAt,
      durationMs,
    });
    console.log(`[STEP-FINALIZE] ${findingId}: 📇 audit-done-idx written — completed=${isAutoComplete} reason=${reason ?? "pending-review"}`);
  } catch (err) {
    console.error(`[STEP-FINALIZE] ${findingId}: ❌ audit-done-idx write failed:`, err);
  }

  // Write chargeback/omission report entry for internal (date leg) findings.
  // Invalid genies are included. If a re-audit passes (score 100), the old entry is deleted.
  if (!isPackage && score !== undefined) {
    try {
      const rec = finding.record as any ?? {};
      if (score === 100) {
        // Passing re-audit — remove any existing chargeback entry for this finding
        await deleteChargebackEntry(orgId, findingId);
        console.log(`[STEP-FINALIZE] ${findingId}: 🗑️ chargebackEntry deleted — re-audit passed`);
      } else {
        const failedQs = isInvalid && !(qs?.length)
          ? [{ header: "Invalid Genie / No Recording", egregious: false }]
          : (qs as (IAnsweredQuestion & { egregious?: boolean })[] ?? [])
              .filter((q) => q.answer === "No")
              .map((q) => ({ header: q.header, egregious: !!q.egregious }))
              .filter((q) => q.header);
        const failedQHeaders = failedQs.map((q) => q.header);
        const egregiousHeaders = failedQs.filter((q) => q.egregious).map((q) => q.header);
        const omissionHeaders = failedQs.filter((q) => !q.egregious).map((q) => q.header);
        if (failedQHeaders.length) {
          await saveChargebackEntry(orgId, {
            findingId,
            ts: completedAt,
            voName: voName ?? "",
            destination: String(rec.DestinationDisplay ?? rec["314"] ?? ""),
            revenue: String(rec["706"] ?? ""),
            recordId: String(rec.RecordId ?? ""),
            score: score ?? 0,
            failedQHeaders,
            egregiousHeaders,
            omissionHeaders,
          });
          console.log(`[STEP-FINALIZE] ${findingId}: 💰 chargebackEntry saved — ${egregiousHeaders.length} egregious, ${omissionHeaders.length} omissions${isInvalid ? " (invalid genie)" : ""}`);
        }
      }
    } catch (err) {
      console.error(`[STEP-FINALIZE] ${findingId}: ❌ chargebackEntry update failed:`, err);
    }
  }

  // Write wire deduction entry for partner (package) findings.
  // Skip bypassed offices (e.g. JAY, GUN) — same logic as review queue bypass.
  if (isPackage && score !== undefined && !isOfficeBypassed) {
    try {
      const rec = finding.record as any ?? {};
      const questionsAudited = qs?.length ?? 0;
      const totalSuccess = qs ? (qs as IAnsweredQuestion[]).filter((q) => q.answer === "Yes").length : 0;
      await saveWireDeductionEntry(orgId, {
        findingId,
        ts: completedAt,
        score: score ?? 0,
        questionsAudited,
        totalSuccess,
        recordId: String(rec.RecordId ?? ""),
        office: department ?? "",
        excellenceAuditor: voName ?? "",
        guestName: String(rec.GuestName ?? ""),
      });
      console.log(`[STEP-FINALIZE] ${findingId}: 📋 wireDeductionEntry saved — score=${score}% qs=${questionsAudited}`);
      // Accumulate partner office/GM email dimensions (fire-and-forget)
      if (rec.OfficeName && rec.GmEmail) {
        updatePartnerDimensions(orgId, String(rec.OfficeName), String(rec.GmEmail)).catch(() => {});
      }
    } catch (err) {
      console.error(`[STEP-FINALIZE] ${findingId}: ❌ wireDeductionEntry save failed:`, err);
    }
  }

  // Route to review queue — skip Invalid Genie and bypassed offices.
  // Formal judge appeals are handled upstream in handleFileAppeal (original finding), not here.
  if (!isInvalid && !isOfficeBypassed && finding.answeredQuestions?.length) {
    try {
      const recordId = String(finding.record?.RecordId ?? "") || undefined;
      const rec = finding.record as any ?? {};
      const isPackage = finding.recordingIdField === "GenieNumber";
      const recordMeta = isPackage ? {
        voName: rec.VoName ? String(rec.VoName) : undefined,
        guestName: rec.GuestName ? String(rec.GuestName) : undefined,
        maritalStatus: rec["67"] ? String(rec["67"]) : undefined,
        officeName: rec.OfficeName ? String(rec.OfficeName) : undefined,
        totalAmountPaid: rec["145"] ? String(rec["145"]) : undefined,
        hasMCC: rec["345"] ? String(rec["345"]) : undefined,
        mspSubscription: rec["306"] ? String(rec["306"]) : undefined,
      } : {
        voName: rec.VoName ? String(rec.VoName) : undefined,
        guestName: rec.GuestName ? String(rec.GuestName) : (rec["32"] ? String(rec["32"]) : undefined),
        spouseName: rec["33"] ? String(rec["33"]) : undefined,
        maritalStatus: rec["49"] ? String(rec["49"]) : undefined,
        roomTypeMaxOccupancy: rec["297"] ? String(rec["297"]) : undefined,
        destination: rec.DestinationDisplay ? String(rec.DestinationDisplay) : (rec["314"] ? String(rec["314"]) : undefined),
        arrivalDate: rec["8"] ? String(rec["8"]) : undefined,
        departureDate: rec["10"] ? String(rec["10"]) : undefined,
        totalWGS: rec["460"] ? String(rec["460"]) : undefined,
        totalMCC: rec["594"] ? String(rec["594"]) : undefined,
      };
      await populateReviewQueue(orgId, findingId, finding.answeredQuestions as any[], finding.recordingIdField as string | undefined, recordId, recordMeta, completedAt);
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
      const newBadges = checkBadges("agent", stats as any, earnedSet);

      let badgeXp = 0;
      for (const badge of newBadges) {
        await awardBadge(orgId, finding.owner, badge as any);
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
  if (isInvalid && !isOfficeBypassed) {
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
  if (nos === 0 && yeses > 0 && !isOfficeBypassed) {
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
  const DENO_URL = Deno.env.get("KV_SERVICE_URL") ?? "";
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

function escHtml(str: string) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function sendTestAuditEmail(finding: Record<string, any>, score: number | undefined) {
  const recipients: string[] = finding.testEmailRecipients ?? ["ai@monsterrg.com"];
  const qs = (finding.answeredQuestions ?? []) as any[];
  const total = qs.length;
  const passed = qs.filter((q: any) => q.answer === "Yes").length;
  const pct = total > 0 ? score ?? Math.round((passed / total) * 100) : 0;
  const rid = String(finding.record?.RecordId ?? finding.recordingId ?? "?");
  const configName = escHtml(finding.qlabConfig ?? "Unknown Config");
  const reportUrl = `${Deno.env.get("SELF_URL") ?? "http://localhost:3000"}/audit/report?id=${finding.id}`;
  const scoreColor = pct === 100 ? "#3fb950" : pct >= 80 ? "#d29922" : "#f85149";

  const qRows = qs.map((q: any) => {
    const pass = q.answer === "Yes";
    return `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #30363d;font-size:13px;">${pass ? "✅" : "❌"} ${escHtml(q.header ?? q.populated ?? "")}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #30363d;font-size:13px;color:${pass ? "#3fb950" : "#f85149"};">${escHtml(q.answer)}</td>
    </tr>`}).join("");

  const htmlBody = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;background:#0d1117;color:#e6edf3;padding:24px;border-radius:12px;">
  <h2 style="margin:0 0 8px;font-size:20px;">🧪 Test Audit Complete</h2>
  <p style="color:#8b949e;margin:0 0 20px;font-size:14px;">Config: <strong style="color:#e6edf3;">${configName}</strong> &nbsp;|&nbsp; RID: <strong style="color:#e6edf3;">${escHtml(rid)}</strong></p>
  <div style="background:#21262d;border:1px solid #30363d;border-radius:8px;padding:20px;margin-bottom:20px;text-align:center;">
    <div style="font-size:44px;font-weight:700;color:${scoreColor};">${pct}%</div>
    <div style="font-size:13px;color:#8b949e;margin-top:4px;">${passed} / ${total} questions passed</div>
  </div>
  ${total > 0 ? `<table style="width:100%;border-collapse:collapse;background:#21262d;border:1px solid #30363d;border-radius:8px;overflow:hidden;margin-bottom:20px;"><thead><tr><th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#8b949e;border-bottom:1px solid #30363d;">Question</th><th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#8b949e;border-bottom:1px solid #30363d;">Answer</th></tr></thead><tbody>${qRows}</tbody></table>` : ""}
  <div style="text-align:center;">
    <a href="${reportUrl}" style="display:inline-block;background:#388bfd;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:500;font-size:14px;">View Full Report →</a>
  </div>
  <p style="color:#8b949e;font-size:12px;margin-top:24px;text-align:center;">This is a test audit. No live data was affected.</p>
</div>`;

  await sendEmail({
    to: recipients,
    subject: `[Test Audit] ${finding.qlabConfig ?? "Config"} | RID: ${rid} | Score: ${pct}%`,
    htmlBody,
  });
  console.log(`[STEP-FINALIZE] ${finding.id}: 📧 Test email sent to ${recipients.join(", ")}`);
}
