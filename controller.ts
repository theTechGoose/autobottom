/** API controller - creates audit jobs and kicks off the QStash pipeline. */
import * as icons from "./shared/icons.ts";
import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import { saveFinding, saveJob, getFinding, getAllAnswersForFinding, getTranscript, getStats, fireWebhook, getWebhookConfig } from "./lib/kv.ts";
import { enqueueStep } from "./lib/queue.ts";
import { getDateLegByRid, getPackageByRid } from "./providers/quickbase.ts";
import { S3Ref } from "./lib/s3.ts";
import { env } from "./env.ts";
import { populateJudgeQueue, saveAppeal, getAppeal } from "./judge/kv.ts";
import type { AuditFinding, AuditJob } from "./types/mod.ts";
import { createJob } from "./types/mod.ts";
import type { OrgId } from "./lib/org.ts";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * POST /audit/test-by-rid?rid=X&callback_url=Y&override=Z&audit_id=W&qlab_config=C
 * Creates an audit job for a standard date leg record.
 * Pass qlab_config to use Question Lab questions instead of QuickBase.
 */
export async function handleAuditByRid(orgId: OrgId, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const rid = url.searchParams.get("rid");
  const callbackUrl = url.searchParams.get("callback_url") ?? "none";
  const override = url.searchParams.get("override");
  const auditId = url.searchParams.get("audit_id");
  const qlabConfig = url.searchParams.get("qlab_config");

  if (!rid) return json({ error: "rid parameter required" }, 400);

  let body: Record<string, any> = {};
  try {
    body = await req.json();
  } catch {
    // No body is fine
  }

  // Always fetch from QuickBase — body.record from QB triggers lacks autoYes expression fields.
  // Fall back to body.record only if QB fetch fails.
  const record = await getDateLegByRid(rid) ?? body.record ?? { RecordId: rid };
  const recordingIdField = body.recordingIdField ?? "VoGenie";

  // Create job
  const jobId = auditId ?? nanoid();
  const job: AuditJob = {
    id: jobId,
    doneAuditIds: [],
    status: "running",
    timestamp: new Date().toISOString(),
    owner: body.owner ?? "api",
    updateEndpoint: callbackUrl,
    recordsToAudit: [rid],
  };
  await saveJob(orgId, job);

  // Create finding
  const findingId = nanoid();
  // Parse comma-separated genie IDs (e.g. "27480192,27480195") into genieIds array
  const rawRecordingId = record[recordingIdField] ? String(record[recordingIdField]) : undefined;
  const genieIdList = rawRecordingId ? rawRecordingId.split(",").map((s: string) => s.trim()).filter(Boolean) : [];
  const finding: AuditFinding = {
    id: findingId,
    auditJobId: jobId,
    findingStatus: "pending",
    feedback: { heading: "", text: "", viewUrl: "" },
    job,
    record,
    recordingIdField,
    recordingId: genieIdList[0] ?? rawRecordingId,
    genieIds: genieIdList.length > 1 ? genieIdList : undefined,
    owner: job.owner,
    updateEndpoint: callbackUrl,
    qlabConfig: qlabConfig ?? body.qlabConfig,
  };

  if (override) {
    finding.recordingId = override;
    finding.genieIds = undefined;
  }

  await saveFinding(orgId, finding);

  // Kick off pipeline
  await enqueueStep("init", { findingId, orgId });

  console.log(`[CONTROLLER] Audit started: job=${jobId} finding=${findingId} rid=${rid}`);
  return json({ jobId, findingId, status: "queued" });
}

/**
 * POST /audit/package-by-rid?rid=X&callback_url=Y
 * Creates an audit job for a package record.
 */
export async function handlePackageByRid(orgId: OrgId, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const rid = url.searchParams.get("rid");
  const callbackUrl = url.searchParams.get("callback_url") ?? "none";
  const qlabConfig = url.searchParams.get("qlab_config");

  if (!rid) return json({ error: "rid parameter required" }, 400);

  let body: Record<string, any> = {};
  try {
    body = await req.json();
  } catch {
    // No body is fine
  }

  // Always fetch from QuickBase — body.record from QB triggers lacks autoYes expression fields.
  // Fall back to body.record only if QB fetch fails.
  const record = await getPackageByRid(rid) ?? body.record ?? { RecordId: rid };
  const recordingIdField = body.recordingIdField ?? "GenieNumber";

  const jobId = nanoid();
  const job: AuditJob = {
    id: jobId,
    doneAuditIds: [],
    status: "running",
    timestamp: new Date().toISOString(),
    owner: body.owner ?? "api",
    updateEndpoint: callbackUrl,
    recordsToAudit: [rid],
  };
  await saveJob(orgId, job);

  const findingId = nanoid();
  // Parse comma-separated genie IDs (e.g. "27480192,27480195") into genieIds array
  const rawRecordingIdPkg = record[recordingIdField] ? String(record[recordingIdField]) : undefined;
  const genieIdListPkg = rawRecordingIdPkg ? rawRecordingIdPkg.split(",").map((s: string) => s.trim()).filter(Boolean) : [];
  const finding: AuditFinding = {
    id: findingId,
    auditJobId: jobId,
    findingStatus: "pending",
    feedback: { heading: "", text: "", viewUrl: "" },
    job,
    record,
    recordingIdField,
    recordingId: genieIdListPkg[0] ?? rawRecordingIdPkg,
    genieIds: genieIdListPkg.length > 1 ? genieIdListPkg : undefined,
    owner: job.owner,
    updateEndpoint: callbackUrl,
    qlabConfig: qlabConfig ?? body.qlabConfig,
  };

  await saveFinding(orgId, finding);
  await enqueueStep("init", { findingId, orgId });

  console.log(`[CONTROLLER] Package audit started: job=${jobId} finding=${findingId} rid=${rid}`);
  return json({ jobId, findingId, status: "queued" });
}

/**
 * GET /audit/finding?id=X
 * Retrieve a finding by ID.
 */
export async function handleGetFinding(orgId: OrgId, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return json({ error: "id parameter required" }, 400);

  const finding = await getFinding(orgId, id);
  if (!finding) return json({ error: "not found" }, 404);

  return json(finding);
}

/**
 * GET /audit/stats
 * Real-time pipeline stats (JSON).
 */
export async function handleGetStats(orgId: OrgId, _req: Request): Promise<Response> {
  const stats = await getStats(orgId);

  return json({
    inPipe: stats.active.length,
    active: stats.active,
    completed24h: stats.completedCount,
    errors24h: stats.errors.length,
    errors: stats.errors,
    retries24h: stats.retries.length,
    retries: stats.retries,
  });
}

/**
 * GET /audit/recording?id=X
 * Streams the recording audio from S3 as audio/mpeg.
 */
export async function handleGetRecording(orgId: OrgId, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return json({ error: "id parameter required" }, 400);

  const finding = await getFinding(orgId, id);
  if (!finding) return json({ error: "finding not found" }, 404);

  const recordingPath = (finding as Record<string, any>).recordingPath;
  if (!recordingPath) return json({ error: "no recording path" }, 404);

  const s3 = new S3Ref(env.s3Bucket, recordingPath);
  const bytes = await s3.get();
  if (!bytes) return json({ error: "recording not found in S3" }, 404);

  const total = (bytes as Uint8Array).byteLength;
  const rangeHeader = req.headers.get("Range");

  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
    if (match) {
      const start = match[1] ? parseInt(match[1]) : 0;
      const end = match[2] ? Math.min(parseInt(match[2]), total - 1) : total - 1;
      const chunk = (bytes as Uint8Array).slice(start, end + 1);
      return new Response(chunk, {
        status: 206,
        headers: {
          "Content-Type": "audio/mpeg",
          "Content-Range": `bytes ${start}-${end}/${total}`,
          "Content-Length": String(chunk.byteLength),
          "Accept-Ranges": "bytes",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }
  }

  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(total),
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=3600",
    },
  });
}


/**
 * POST /audit/appeal
 * File an appeal for a finding - queues ALL questions for judge review.
 */
export async function handleFileAppeal(orgId: OrgId, req: Request): Promise<Response> {
  let body: Record<string, any> = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const findingId = body.findingId;
  const comment = body.comment;
  const appealedQuestions: string[] = Array.isArray(body.appealedQuestions) ? body.appealedQuestions : [];
  if (!findingId) return json({ error: "findingId required" }, 400);

  // Check if appeal already exists
  const existing = await getAppeal(orgId, findingId);
  if (existing) return json({ error: "appeal already filed", status: existing.status }, 409);

  const finding = await getFinding(orgId, findingId);
  if (!finding) return json({ error: "finding not found" }, 404);

  const f = finding as Record<string, any>;
  const allAnswers = await getAllAnswersForFinding(orgId, findingId);
  const questions = allAnswers.length > 0 ? allAnswers : (f.answeredQuestions ?? []);

  if (questions.length === 0) {
    return json({ error: "no answered questions to appeal" }, 400);
  }

  // Populate judge queue with only the disputed questions.
  // If none specified, fall back to failed (No) questions only — agents don't appeal questions they passed.
  // Preserve original indices before filtering so populateJudgeQueue stores the correct questionIndex.
  const questionsWithIdx = questions.map((q: any, i: number) => ({ ...q, _origIdx: i }));
  const questionsToQueue = appealedQuestions.length > 0
    ? questionsWithIdx.filter((q: any) => appealedQuestions.includes(q.header ?? "") && String(q.answer ?? "").toLowerCase() === "no")
    : questionsWithIdx.filter((q: any) => String(q.answer ?? "").toLowerCase() === "no");
  if (questionsToQueue.length === 0) {
    return json({ error: "no failed questions to appeal" }, 400);
  }
  await populateJudgeQueue(orgId, findingId, questionsToQueue, "redo", f.recordingIdField as string | undefined, f.recordingId ? String(f.recordingId) : undefined);

  // Save appeal record
  const appealedAt = Date.now();
  await saveAppeal(orgId, {
    findingId,
    appealedAt,
    status: "pending",
    auditor: f.owner,
    ...(comment ? { comment: String(comment) } : {}),
    ...(appealedQuestions.length > 0 ? { appealedQuestions } : {}),
  });

  fireWebhook(orgId, "appeal", {
    findingId,
    finding: f,
    auditor: f.owner,
    questionCount: questions.length,
    appealedAt: new Date(appealedAt).toISOString(),
    ...(comment ? { comment: String(comment) } : {}),
  }).catch((err) => console.error(`[APPEAL] ${findingId}: Webhook failed:`, err));

  return json({ ok: true, judgeUrl: "/judge" });
}

/**
 * POST /audit/appeal/different-recording
 * Re-audit with different/additional recording IDs. Nukes old finding, creates new one.
 * Auto-detects appeal type: if original recordingId is in submitted list -> "additional-recording", else -> "different-recording".
 */
export async function handleAppealDifferentRecording(orgId: OrgId, req: Request): Promise<Response> {
  let body: Record<string, any> = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const { findingId, recordingIds, comment } = body;
  if (!findingId) return json({ error: "findingId required" }, 400);
  if (!Array.isArray(recordingIds) || recordingIds.length === 0) {
    return json({ error: "recordingIds must be a non-empty array" }, 400);
  }

  // Validate all IDs are numeric
  for (const rid of recordingIds) {
    if (!/^\d+$/.test(String(rid).trim())) {
      return json({ error: `invalid recording ID: ${rid}` }, 400);
    }
  }

  const oldFinding = await getFinding(orgId, findingId);
  if (!oldFinding) return json({ error: "finding not found" }, 404);

  // Auto-detect appeal type
  const normalizedIds = recordingIds.map((r: any) => String(r).trim());
  const originalId = oldFinding.recordingId ? String(oldFinding.recordingId) : undefined;
  const appealType = originalId && normalizedIds.includes(originalId) ? "additional-recording" : "different-recording";

  // Mark old finding as re-audited
  (oldFinding as Record<string, any>).reAuditedAt = Date.now();
  await saveFinding(orgId, oldFinding as Record<string, any>);

  // Create new job + finding with same record data
  const newJobId = nanoid();
  const newJob: AuditJob = createJob(
    oldFinding.owner ?? "api",
    oldFinding.updateEndpoint ?? "none",
    oldFinding.record?.RecordId ? [String(oldFinding.record.RecordId)] : [],
    newJobId,
  );
  newJob.status = "running";
  await saveJob(orgId, newJob);

  const newFindingId = nanoid();
  const newFinding: AuditFinding = {
    id: newFindingId,
    auditJobId: newJobId,
    findingStatus: "pending",
    feedback: { heading: "", text: "", viewUrl: "" },
    job: newJob,
    record: oldFinding.record,
    recordingIdField: oldFinding.recordingIdField,
    recordingId: normalizedIds[0],
    owner: oldFinding.owner,
    updateEndpoint: oldFinding.updateEndpoint,
    qlabConfig: oldFinding.qlabConfig,
    genieIds: normalizedIds,
    appealSourceFindingId: findingId,
    appealType,
    ...(comment ? { appealComment: String(comment) } : {}),
  };

  await saveFinding(orgId, newFinding as Record<string, any>);
  await enqueueStep("init", { findingId: newFindingId, orgId });

  const reportUrl = `${env.selfUrl}/audit/report?id=${newFindingId}`;
  const voEmail = String((oldFinding.record as any)?.VoEmail ?? "");
  const ownerEmail = oldFinding.owner && oldFinding.owner !== "api" ? oldFinding.owner : "";
  const agentEmail = voEmail || ownerEmail;
  const receiptCfg = await getWebhookConfig(orgId, "re-audit-receipt").catch(() => null);
  const receiptDisplayEmail = receiptCfg?.testEmail || agentEmail;
  console.log(`[APPEAL] ${appealType}: old=${findingId} new=${newFindingId} recordings=${normalizedIds.join(",")} agent=${agentEmail || "(none)"} receiptTo=${receiptDisplayEmail || "(none)"}`);
  return json({ ok: true, newFindingId, reportUrl, agentEmail, receiptDisplayEmail });
}

/**
 * POST /audit/appeal/upload-recording
 * Re-audit with an uploaded MP3 file and optional snip markers.
 */
export async function handleAppealUploadRecording(orgId: OrgId, req: Request): Promise<Response> {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return json({ error: "multipart form data required" }, 400);
  }

  const findingId = formData.get("findingId") as string;
  if (!findingId) return json({ error: "findingId required" }, 400);

  const file = formData.get("file") as File | null;
  if (!file) return json({ error: "file required" }, 400);

  const snipStartRaw = formData.get("snipStart") as string | null;
  const snipEndRaw = formData.get("snipEnd") as string | null;
  const snipStart = snipStartRaw ? Number(snipStartRaw) : undefined;
  const snipEnd = snipEndRaw ? Number(snipEndRaw) : undefined;
  const comment = formData.get("comment") as string | null;

  const oldFinding = await getFinding(orgId, findingId);
  if (!oldFinding) return json({ error: "finding not found" }, 404);

  // Mark old finding as re-audited
  (oldFinding as Record<string, any>).reAuditedAt = Date.now();
  await saveFinding(orgId, oldFinding as Record<string, any>);

  // Upload file to S3
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  const newJobId = nanoid();
  const s3Key = `recordings/${newJobId}/upload.mp3`;
  const s3 = new S3Ref(env.s3Bucket, s3Key);
  await s3.save(fileBytes);

  // Create new job + finding
  const newJob: AuditJob = createJob(
    oldFinding.owner ?? "api",
    oldFinding.updateEndpoint ?? "none",
    oldFinding.record?.RecordId ? [String(oldFinding.record.RecordId)] : [],
    newJobId,
  );
  newJob.status = "running";
  await saveJob(orgId, newJob);

  const newFindingId = nanoid();
  const newFinding: AuditFinding = {
    id: newFindingId,
    auditJobId: newJobId,
    findingStatus: "pending",
    feedback: { heading: "", text: "", viewUrl: "" },
    job: newJob,
    record: oldFinding.record,
    recordingIdField: oldFinding.recordingIdField,
    owner: oldFinding.owner,
    updateEndpoint: oldFinding.updateEndpoint,
    qlabConfig: oldFinding.qlabConfig,
    s3RecordingKey: s3Key,
    recordingPath: s3Key,
    snipStart,
    snipEnd,
    appealSourceFindingId: findingId,
    appealType: "upload-recording",
    ...(comment ? { appealComment: String(comment) } : {}),
  };

  await saveFinding(orgId, newFinding as Record<string, any>);

  // Skip init (recording already in S3), go straight to transcribe
  await enqueueStep("transcribe", { findingId: newFindingId, orgId });

  const reportUrl = `${env.selfUrl}/audit/report?id=${newFindingId}`;
  const voEmail = String((oldFinding.record as any)?.VoEmail ?? "");
  const ownerEmail = oldFinding.owner && oldFinding.owner !== "api" ? oldFinding.owner : "";
  const agentEmail = voEmail || ownerEmail;
  const receiptCfg = await getWebhookConfig(orgId, "re-audit-receipt").catch(() => null);
  const receiptDisplayEmail = receiptCfg?.testEmail || agentEmail;
  console.log(`[APPEAL] Upload-recording: old=${findingId} new=${newFindingId} snip=${snipStart ?? "none"}-${snipEnd ?? "none"} agent=${agentEmail || "(none)"} receiptTo=${receiptDisplayEmail || "(none)"}`);
  return json({ ok: true, newFindingId, reportUrl, agentEmail, receiptDisplayEmail });
}

/**
 * GET /audit/appeal/status?findingId=X
 * Check if an appeal exists for a finding (no side effects).
 */
export async function handleAppealStatus(orgId: OrgId, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const findingId = url.searchParams.get("findingId");
  if (!findingId) return json({ error: "findingId required" }, 400);
  const existing = await getAppeal(orgId, findingId);
  const finding = await getFinding(orgId, findingId);
  const reAuditedAt = (finding as any)?.reAuditedAt ?? null;
  return json({ exists: !!existing, status: existing?.status ?? null, reAuditedAt });
}

/**
 * GET /audit/report?id=X
 * HTML report for a completed audit finding.
 */
export async function handleGetReport(orgId: OrgId, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return new Response("Missing id parameter", { status: 400 });
  }

  const f = await getFinding(orgId, id);
  if (!f) {
    return new Response("Finding not found", { status: 404 });
  }

  // Fetch full (untrimmed) answers from batch KV keys
  const fullAnswers = await getAllAnswersForFinding(orgId, id);
  const questions: any[] = fullAnswers.length > 0 ? fullAnswers : (f.answeredQuestions ?? []);

  const record = f.record ?? {};
  const recordId = String(record.RecordId ?? "");
  const isPackage = f.recordingIdField === "GenieNumber";
  const qbTableId = isPackage ? "bttffb64u" : "bpb28qsnn";
  const crmUrl = recordId ? `https://${env.qbRealm}.quickbase.com/db/${qbTableId}?a=dr&rid=${recordId}` : "";

  const isYesAnswer = (a: string) => {
    const s = String(a ?? "").trim().toLowerCase();
    return s.startsWith("yes") || s === "true" || s === "y" || s === "1";
  };
  const yesCount = questions.filter((q: any) => isYesAnswer(q.answer)).length;
  const noCount = questions.filter((q: any) => !isYesAnswer(q.answer)).length;
  const total = questions.length;
  const passRate = total > 0 ? Math.round((yesCount / total) * 100) : 0;
  const passed = noCount === 0 && total > 0;

  const statusBadge = f.findingStatus === "finished"
    ? (passed
        ? `<span class="badge pass"><span class="badge-dot"></span>PASSED</span>`
        : `<span class="badge fail"><span class="badge-dot"></span>FAILED</span>`)
    : `<span class="badge pending"><span class="badge-dot"></span>${esc(f.findingStatus?.toUpperCase() ?? "UNKNOWN")}</span>`;

  // Fetch full transcript from dedicated KV key (not subject to 64KB trim)
  const storedTranscript = await getTranscript(orgId, id);
  // Only trust diarized if it actually contains speaker labels — Groq sometimes returns artifact text
  const diarizedText = storedTranscript?.diarized;
  const hasSpeakerLabels = diarizedText ? (diarizedText.includes("[AGENT]") || diarizedText.includes("[CUSTOMER]")) : false;
  const rawFallback = storedTranscript?.raw || f.diarizedTranscript || f.rawTranscript || "";
  const transcriptText = hasSpeakerLabels ? diarizedText! : rawFallback;
  const transcriptHtml = transcriptText
    ? esc(transcriptText).replace(/\.\.\.\[KV_TRIM\]/g, "...").replace(/\[AGENT\]/g, '<span class="speaker agent">[AGENT]</span>')
                         .replace(/\[CUSTOMER\]/g, '<span class="speaker customer">[CUSTOMER]</span>')
                         .replace(/\n/g, "<br>")
    : "<em style='color:#484f58;'>No transcript available</em>";

  // Format AI text: highlight 'quoted transcript' and split --- steps
  const fmtText = (text: string): string => {
    return esc(text)
      .replace(/&#39;([^&#]*(?:&#39;[^&#]*)*?)&#39;/g, '<span class="hl">\'$1\'</span>');
  };

  // Condense multiple --- steps into a single summary + expandable detail
  const formatSection = (text: string, qIdx: number, kind: string): string => {
    const steps = text.split(/\n---\n|\n---$|^---\n/).map(s => s.trim()).filter(Boolean);
    const summary = steps[0] ?? text.trim();
    const truncLen = 180;
    const summaryTrunc = summary.length > truncLen ? summary.slice(0, truncLen) + "..." : summary;
    const hasMore = steps.length > 1 || summary.length > truncLen;
    const id = `detail-${qIdx}-${kind}`;

    let html = `<div class="sec-summary">${fmtText(summaryTrunc)}</div>`;
    if (hasMore) {
      html += `<div class="sec-detail" id="${id}">`;
      if (steps.length > 1) {
        html += steps.map((step, j) =>
          `<div class="step-row"><span class="step-num">${j + 1}</span><span class="step-body">${fmtText(step)}</span></div>`
        ).join("");
      } else {
        html += `<div class="step-row"><span class="step-body">${fmtText(summary)}</span></div>`;
      }
      html += `</div>`;
      html += `<button class="sec-toggle" onclick="toggleDetail('${id}',this)">Show ${steps.length > 1 ? steps.length + " steps" : "full text"}</button>`;
    }
    return html;
  };

  const questionsHtml = questions.map((q: any, i: number) => {
    const isYes = isYesAnswer(q.answer);
    const thinking = q.thinking ?? "";
    const defense = q.defense ?? "";

    const rawSnippet = q.snippet ?? "";
    const snippet = rawSnippet
      .replace(/\s*\[AGENT\]/g, "\n[AGENT]")
      .replace(/\s*\[CUSTOMER\]/g, "\n[CUSTOMER]")
      .trim();

    const snippetFormatted = esc(snippet)
      .replace(/\[AGENT\]/g, '<span class="speaker agent">[AGENT]</span>')
      .replace(/\[CUSTOMER\]/g, '<span class="speaker customer">[CUSTOMER]</span>')
      .replace(/\n/g, "<br>");

    const verdictClass = isYes ? "verdict-yes" : "verdict-no";
    const verdictLabel = isYes ? "Compliant" : "Non-Compliant";
    const verdictIcon = isYes ? icons.check : icons.x;

    return `<div class="q-card ${isYes ? "q-card--yes" : "q-card--no"}" id="qcard-${i}">
      <div class="q-card-top" onclick="toggleCard(${i})">
        <div class="q-card-num">${i + 1}</div>
        <div class="q-card-title">${esc(q.header ?? "")}</div>
        <div class="q-card-answer ${isYes ? "answer-yes" : "answer-no"}" id="qa-${i}">${isYes ? "Yes" : "No"}</div>
        <button class="q-card-edit admin-only" data-idx="${i}" title="Flip answer (admin)" onclick="adminFlipAnswer(${i});event.stopPropagation();">✏</button>
        <button class="q-card-toggle" id="toggle-${i}" aria-label="Expand details">
          ${icons.chevronDown}
        </button>
      </div>
      <div class="q-card-body" id="body-${i}">
        <div class="q-verdict ${verdictClass}">
          <span class="q-verdict-icon">${verdictIcon}</span>
          <span>Verdict: <strong>${verdictLabel}</strong></span>
        </div>
        <div class="q-body-inner">
          ${snippet ? `<div class="q-block">
            <div class="q-block-head">
              <span class="q-block-label">Transcript Context</span>
              <button class="copy-btn" onclick="copySnippet(${i});event.stopPropagation();">Copy</button>
            </div>
            <div class="snippet-box">${snippetFormatted}</div>
          </div>` : ""}
          ${thinking ? `<div class="q-block q-block--blue">
            <div class="q-block-head"><span class="q-block-label">Reasoning</span></div>
            ${formatSection(thinking, i, "r")}
          </div>` : ""}
          ${defense ? `<div class="q-block q-block--purple">
            <div class="q-block-head"><span class="q-block-label">Defense</span></div>
            ${formatSection(defense, i, "d")}
          </div>` : ""}
        </div>
      </div>
      <textarea class="snippet-data" id="snippet-${i}" style="display:none;">${esc(snippet)}</textarea>
    </div>`;
  }).join("\n");


  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Audit Report - ${esc(id)}</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #0a0e14; --bg-raised: #0f1419; --bg-surface: #141a22;
      --bg-card: #111820; --bg-inset: #0c1018;
      --border: #1a2030; --border-hover: #263040;
      --text: #b8c0cc; --text-muted: #5c6670; --text-dim: #3d4550; --text-bright: #e2e8f0;
      --green: #34d399; --green-dim: #059669; --green-bg: rgba(52,211,153,0.08); --green-glow: rgba(52,211,153,0.15);
      --red: #f87171; --red-dim: #dc2626; --red-bg: rgba(248,113,113,0.08); --red-glow: rgba(248,113,113,0.15);
      --yellow: #fbbf24; --yellow-bg: rgba(251,191,36,0.08);
      --teal: #2dd4bf; --teal-dim: #14b8a6; --teal-bg: rgba(45,212,191,0.08);
      --blue: #60a5fa; --purple: #a78bfa;
      --mono: 'SF Mono', 'Fira Code', 'Cascadia Code', 'Menlo', monospace;
      --radius: 12px;
    }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; min-height: 100vh; }

    /* ====== HERO ====== */
    .hero {
      background: var(--bg-raised);
      border-bottom: 1px solid var(--border);
      padding: 0 0 28px;
    }
    .hero-top {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 28px; border-bottom: 1px solid var(--border);
    }
    .hero-top-left { display: flex; align-items: center; gap: 12px; }
    .hero-label { font-size: 11px; font-weight: 700; color: var(--text-dim); text-transform: uppercase; letter-spacing: 1.5px; }
    .hero-id {
      font-family: var(--mono); font-size: 10px; color: var(--text-muted);
      background: var(--bg); padding: 2px 8px; border-radius: 4px; border: 1px solid var(--border);
    }
    .badge {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 3px 10px; border-radius: 20px; font-weight: 700; font-size: 10px;
      letter-spacing: 0.8px; text-transform: uppercase;
    }
    .badge-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
    .badge.pass { background: var(--green-bg); color: var(--green); }
    .badge.pass .badge-dot { background: var(--green); box-shadow: 0 0 6px var(--green-glow); }
    .badge.fail { background: var(--red-bg); color: var(--red); }
    .badge.fail .badge-dot { background: var(--red); box-shadow: 0 0 6px var(--red-glow); }
    .badge.pending { background: var(--yellow-bg); color: var(--yellow); }
    .badge.pending .badge-dot { background: var(--yellow); }

    /* Audio in hero top-right */
    .audio-native { display: none; }
    .audio-error { display: none; font-size: 10px; color: var(--red); }
    .ap { display: flex; align-items: center; gap: 8px; }
    .ap-play {
      width: 26px; height: 26px; border-radius: 50%; border: none; cursor: pointer;
      background: var(--teal-dim); color: #fff; display: flex; align-items: center; justify-content: center;
      transition: all 0.15s; flex-shrink: 0;
    }
    .ap-play:hover { background: var(--teal); box-shadow: 0 0 12px var(--teal-bg); }
    .ap-play svg { width: 10px; height: 10px; fill: #fff; }
    #ap-waveform { display: block; }
    .ap-time { font-family: var(--mono); font-size: 10px; color: var(--text-dim); white-space: nowrap; }

    /* Hero score center */
    .hero-body { text-align: center; padding: 32px 28px 0; }
    .hero-score {
      font-size: 72px; font-weight: 900; font-variant-numeric: tabular-nums;
      letter-spacing: -4px; line-height: 1; margin-bottom: 12px;
    }
    .hero-score.good { color: var(--green); text-shadow: 0 0 40px var(--green-glow), 0 0 80px rgba(52,211,153,0.06); }
    .hero-score.bad { color: var(--red); text-shadow: 0 0 40px var(--red-glow), 0 0 80px rgba(248,113,113,0.06); }
    .hero-bar { max-width: 480px; margin: 0 auto 14px; }
    .hero-bar-track { height: 6px; background: var(--bg); border-radius: 3px; overflow: hidden; }
    .hero-bar-fill { height: 100%; border-radius: 3px; transition: width 0.6s ease; }
    .hero-bar-fill.good { background: linear-gradient(90deg, var(--teal-dim), var(--green)); box-shadow: 0 0 12px var(--green-glow); }
    .hero-bar-fill.bad { background: linear-gradient(90deg, var(--red-dim), var(--red)); box-shadow: 0 0 12px var(--red-glow); }
    .hero-stats { display: flex; justify-content: center; gap: 24px; font-size: 12px; color: var(--text-muted); }
    .hero-stat { display: flex; align-items: center; gap: 5px; }
    .hero-stat .dot { width: 5px; height: 5px; border-radius: 50%; }

    /* Hero actions row */
    .hero-actions {
      display: flex; justify-content: center; gap: 10px; margin-top: 20px;
    }
    .appeal-btn {
      background: var(--red-dim); color: #fff; border: none;
      padding: 9px 28px; border-radius: 8px; font-weight: 700; font-size: 12px;
      cursor: pointer; transition: all 0.2s; letter-spacing: 0.3px;
    }
    .appeal-btn:hover { background: var(--red); box-shadow: 0 0 20px var(--red-glow); }
    .appeal-btn:disabled { opacity: 0.4; cursor: default; box-shadow: none; }
    .appeal-btn.filed { background: var(--teal-dim); opacity: 1; }
    .appeal-btn.filed:hover { box-shadow: none; }

    /* ====== MAIN ====== */
    .main { max-width: 940px; margin: 0 auto; padding: 24px 20px 60px; }

    /* Meta bar -- compact horizontal strip */
    .meta-bar {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 1px;
      background: var(--border); border-radius: var(--radius); overflow: hidden;
      margin-bottom: 20px;
    }
    .meta-cell {
      background: var(--bg-card); padding: 12px 16px;
    }
    .meta-cell:first-child { border-radius: var(--radius) 0 0 var(--radius); }
    .meta-cell:last-child { border-radius: 0 var(--radius) var(--radius) 0; }
    .meta-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--text-dim); margin-bottom: 2px; }
    .meta-value { font-size: 12px; color: var(--text-bright); font-family: var(--mono); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    /* Section */
    .section {
      background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius);
      margin-bottom: 16px; overflow: hidden;
    }
    .section-head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 20px; border-bottom: 1px solid var(--border);
    }
    .section-title {
      font-size: 11px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 1px; color: var(--text-muted);
    }
    .section-badge {
      font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 10px;
      background: var(--teal-bg); color: var(--teal); font-family: var(--mono);
    }

    /* Transcript */
    .transcript-box {
      font-size: 13px; line-height: 1.9; padding: 18px 20px; max-height: 360px; overflow-y: auto;
      color: var(--text);
    }
    .transcript-box::-webkit-scrollbar { width: 4px; }
    .transcript-box::-webkit-scrollbar-track { background: transparent; }
    .transcript-box::-webkit-scrollbar-thumb { background: var(--border-hover); border-radius: 2px; }
    .speaker { font-weight: 700; }
    .speaker.agent { color: var(--blue); }
    .speaker.customer { color: var(--purple); }

    /* Questions */
    .expand-bar { display: flex; gap: 6px; }
    .expand-bar button {
      background: var(--teal-bg); color: var(--teal); border: 1px solid rgba(45,212,191,0.2);
      padding: 6px 14px; border-radius: 6px; font-size: 11px; font-weight: 700; cursor: pointer; transition: all 0.15s;
    }
    .expand-bar button:hover { background: rgba(45,212,191,0.15); border-color: rgba(45,212,191,0.35); }
    .questions-list { display: flex; flex-direction: column; }

    .q-card { border-bottom: 1px solid var(--border); transition: background 0.1s; }
    .q-card:last-child { border-bottom: none; }
    .q-card--no { box-shadow: inset 3px 0 0 var(--red); }
    .q-card--yes { box-shadow: inset 3px 0 0 var(--green); }

    .q-card-top { display: flex; align-items: center; gap: 12px; padding: 11px 20px; cursor: pointer; user-select: none; }
    .q-card-top:hover { background: rgba(255,255,255,0.015); }
    .q-card-num {
      flex-shrink: 0; width: 24px; height: 24px; border-radius: 5px;
      background: var(--bg); display: flex; align-items: center; justify-content: center;
      font-weight: 700; font-size: 10px; color: var(--text-dim); font-family: var(--mono);
    }
    .q-card-title { flex: 1; font-weight: 500; font-size: 13px; color: var(--text-bright); }
    .q-card-answer {
      flex-shrink: 0; padding: 2px 10px; border-radius: 10px;
      font-weight: 700; font-size: 10px; letter-spacing: 0.5px;
    }
    .q-card-answer.answer-yes { background: var(--green-bg); color: var(--green); }
    .q-card-answer.answer-no { background: var(--red-bg); color: var(--red); }
    .q-card-toggle {
      flex-shrink: 0; background: none; border: none; cursor: pointer;
      color: var(--text-dim); padding: 4px; display: flex; transition: transform 0.2s;
    }
    .q-card-toggle.open { transform: rotate(180deg); }

    .admin-only { display: none !important; }
    body.is-admin .admin-only { display: flex !important; }
    .q-card-edit {
      flex-shrink: 0; background: none; border: 1px solid rgba(251,191,36,0.25);
      color: var(--yellow); padding: 2px 7px; border-radius: 4px; font-size: 12px;
      cursor: pointer; transition: all 0.15s; align-items: center; justify-content: center;
    }
    .q-card-edit:hover { background: rgba(251,191,36,0.1); border-color: rgba(251,191,36,0.5); }
    .q-card-edit:disabled { opacity: 0.4; cursor: not-allowed; }

    .q-card-body { display: none; border-top: 1px solid var(--border); padding: 0; background: var(--bg-inset); }
    .q-card-body.open { display: block; }

    /* Verdict banner */
    .q-verdict {
      display: flex; align-items: center; gap: 8px;
      padding: 9px 20px; font-size: 11px; font-weight: 600; letter-spacing: 0.3px;
    }
    .q-verdict-icon { display: flex; align-items: center; }
    .verdict-yes { background: var(--green-bg); color: var(--green); }
    .verdict-no { background: var(--red-bg); color: var(--red); }

    /* Question body sections */
    .q-body-inner { padding: 12px 20px 16px; display: flex; flex-direction: column; gap: 12px; }
    .q-block { border-radius: 8px; overflow: hidden; }
    .q-block-head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 14px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px;
    }
    .q-block-label { display: flex; align-items: center; gap: 6px; }
    .q-block--blue { background: rgba(96,165,250,0.06); border: 1px solid rgba(96,165,250,0.1); }
    .q-block--blue .q-block-head { color: var(--blue); border-bottom: 1px solid rgba(96,165,250,0.1); }
    .q-block--purple { background: rgba(167,139,250,0.06); border: 1px solid rgba(167,139,250,0.1); }
    .q-block--purple .q-block-head { color: var(--purple); border-bottom: 1px solid rgba(167,139,250,0.1); }
    .q-block:not(.q-block--blue):not(.q-block--purple) { background: var(--bg-card); border: 1px solid var(--border); }
    .q-block:not(.q-block--blue):not(.q-block--purple) .q-block-head { color: var(--text-muted); border-bottom: 1px solid var(--border); }

    .sec-summary { padding: 10px 14px; font-size: 12px; line-height: 1.7; color: var(--text); }
    .sec-detail { display: none; padding: 0 14px 6px; }
    .sec-detail.open { display: block; }
    .sec-toggle {
      display: block; width: 100%; padding: 6px 14px; background: none; border: none; border-top: 1px solid rgba(255,255,255,0.04);
      color: var(--text-dim); font-size: 10px; font-weight: 600; cursor: pointer; text-align: left; transition: color 0.15s;
    }
    .sec-toggle:hover { color: var(--text-muted); }
    .step-row { display: flex; gap: 10px; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.03); }
    .step-row:last-child { border-bottom: none; }
    .step-num {
      flex-shrink: 0; width: 20px; height: 20px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 9px; font-weight: 800; font-family: var(--mono); margin-top: 2px;
    }
    .q-block--blue .step-num { background: rgba(96,165,250,0.12); color: var(--blue); }
    .q-block--purple .step-num { background: rgba(167,139,250,0.12); color: var(--purple); }
    .step-body { font-size: 12px; line-height: 1.65; color: var(--text); word-break: break-word; }
    .hl { color: var(--teal); font-style: italic; }

    .snippet-box {
      background: var(--bg); border: 1px solid var(--border); border-radius: 8px;
      padding: 12px 14px; font-size: 12px; line-height: 1.8; white-space: pre-wrap;
      word-break: break-word; color: var(--text); max-height: 240px; overflow-y: auto;
    }
    .snippet-box::-webkit-scrollbar { width: 4px; }
    .snippet-box::-webkit-scrollbar-thumb { background: var(--border-hover); border-radius: 2px; }

    .copy-btn {
      background: transparent; color: var(--text-dim); border: 1px solid var(--border);
      padding: 3px 10px; border-radius: 4px; font-size: 9px; font-weight: 600;
      cursor: pointer; transition: all 0.15s;
    }
    .copy-btn:hover { color: var(--text-muted); border-color: var(--border-hover); }
    .copy-btn.copied { color: var(--green); border-color: var(--green); }

    /* Appeal panel — lives inside reaudit-overlay modal */
    .appeal-panel {
      text-align: left;
      background: #161c28;
    }
    .appeal-tabs {
      display: flex; border-bottom: 1px solid var(--border);
    }
    .appeal-tab {
      flex: 1; padding: 10px 0; background: none; border: none; color: var(--text-muted);
      font-size: 12px; font-weight: 700; cursor: pointer; text-align: center;
      border-bottom: 2px solid transparent; transition: all 0.15s;
    }
    .appeal-tab:hover { color: var(--text); }
    .appeal-tab.active { color: var(--teal); border-bottom-color: var(--teal); }
    .appeal-fork { padding: 16px 20px; }
    .fork-label { font-size: 11px; color: var(--text-muted); margin-bottom: 10px; }
    .recording-inputs { display: flex; flex-direction: column; gap: 6px; }
    .recording-row { display: flex; gap: 6px; align-items: center; }
    .recording-input {
      flex: 1; background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
      color: var(--text-bright); padding: 8px 12px; font-size: 13px; font-family: var(--mono);
      outline: none; transition: border-color 0.15s;
    }
    .recording-input:focus { border-color: var(--teal); }
    .recording-remove {
      background: none; border: none; color: var(--red); cursor: pointer; font-size: 16px;
      padding: 4px 8px; border-radius: 4px; transition: background 0.15s;
    }
    .recording-remove:hover { background: var(--red-bg); }
    .fork-add-btn {
      background: none; border: 1px dashed var(--border); color: var(--text-muted);
      padding: 6px 14px; border-radius: 6px; font-size: 11px; font-weight: 600;
      cursor: pointer; margin-top: 8px; transition: all 0.15s; width: 100%;
    }
    .fork-add-btn:hover { border-color: var(--teal); color: var(--teal); }
    .fork-submit {
      background: var(--teal-dim); color: #fff; border: none;
      padding: 9px 0; border-radius: 8px; font-weight: 700; font-size: 12px;
      cursor: pointer; transition: all 0.2s; width: 100%; margin-top: 12px;
    }
    .fork-submit:hover { background: var(--teal); box-shadow: 0 0 16px var(--teal-bg); }
    .fork-submit:disabled { opacity: 0.4; cursor: default; box-shadow: none; }
    .appeal-comment {
      width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
      color: var(--text-bright); padding: 8px 12px; font-size: 12px; font-family: inherit;
      outline: none; resize: vertical; min-height: 50px; max-height: 120px;
      transition: border-color 0.15s; margin-top: 10px;
    }
    .appeal-comment:focus { border-color: var(--teal); }
    .appeal-comment::placeholder { color: var(--text-dim); }
    /* Upload: initial drop zone */
    .upload-area {
      border: 2px dashed var(--border); border-radius: 8px; padding: 28px 16px;
      text-align: center; cursor: pointer; transition: border-color 0.15s;
    }
    .upload-area:hover { border-color: var(--teal); }
    .upload-area.has-file { display: none; }
    .upload-icon { font-size: 28px; color: var(--text-dim); margin-bottom: 6px; }
    .upload-text { font-size: 12px; color: var(--text-muted); }

    /* Upload: file info bar (shown after selecting) */
    .file-info {
      display: none; align-items: center; gap: 10px;
      background: var(--bg); border: 1px solid var(--border); border-radius: 8px;
      padding: 8px 12px;
    }
    .file-info.visible { display: flex; }
    .file-info-icon {
      width: 32px; height: 32px; border-radius: 6px; flex-shrink: 0;
      background: var(--teal-bg); color: var(--teal); display: flex;
      align-items: center; justify-content: center; font-size: 14px;
    }
    .file-info-name { flex: 1; font-size: 12px; font-weight: 600; color: var(--text-bright); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .file-info-size { font-size: 10px; color: var(--text-dim); font-family: var(--mono); flex-shrink: 0; }
    .file-info-change {
      background: none; border: 1px solid var(--border); color: var(--text-muted);
      padding: 4px 10px; border-radius: 4px; font-size: 10px; font-weight: 600;
      cursor: pointer; transition: all 0.15s; flex-shrink: 0;
    }
    .file-info-change:hover { border-color: var(--teal); color: var(--teal); }

    /* Snip editor */
    .snip-editor { display: none; margin-top: 14px; }
    .snip-editor.visible { display: block; }
    .snip-editor-label {
      font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;
      color: var(--text-dim); margin-bottom: 8px;
    }
    .snip-row { display: flex; align-items: center; gap: 10px; }
    .snip-play-btn {
      width: 32px; height: 32px; border-radius: 50%; border: none; cursor: pointer;
      background: var(--teal-dim); color: #fff; display: flex; align-items: center;
      justify-content: center; font-size: 13px; flex-shrink: 0; transition: all 0.15s;
    }
    .snip-play-btn:hover { background: var(--teal); box-shadow: 0 0 12px var(--teal-bg); }
    .snip-track-wrap { flex: 1; display: flex; flex-direction: column; gap: 3px; }
    .snip-track {
      width: 100%; height: 20px; background: var(--bg); border-radius: 4px;
      cursor: pointer; position: relative; overflow: hidden; border: 1px solid var(--border);
    }
    .snip-fill {
      height: 100%; background: linear-gradient(90deg, var(--teal-dim), var(--teal));
      width: 0%; pointer-events: none; position: absolute; top: 0; left: 0;
      opacity: 0.35; transition: width 0.08s;
    }
    .snip-cursor {
      position: absolute; top: 0; width: 2px; height: 100%;
      background: var(--teal); pointer-events: none; left: 0; transition: left 0.08s;
      box-shadow: 0 0 4px var(--teal);
    }
    .snip-range {
      position: absolute; top: 0; height: 100%;
      background: var(--yellow); opacity: 0.2; pointer-events: none; left: 0; width: 0;
    }
    .snip-handle {
      position: absolute; top: -2px; width: 3px; height: calc(100% + 4px);
      pointer-events: none; border-radius: 1px;
    }
    .snip-handle--start { background: var(--green); left: 0; display: none; box-shadow: 0 0 6px var(--green-glow); }
    .snip-handle--end { background: var(--red); left: 0; display: none; box-shadow: 0 0 6px var(--red-glow); }

    .snip-times {
      display: flex; justify-content: space-between; font-family: var(--mono);
      font-size: 10px; color: var(--text-dim);
    }

    /* Snip action bar */
    .snip-actions {
      display: flex; align-items: center; gap: 6px; margin-top: 10px;
      padding: 8px 10px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px;
    }
    .snip-btn {
      padding: 5px 12px; border-radius: 5px; font-size: 10px; font-weight: 700;
      cursor: pointer; transition: all 0.15s; border: none;
    }
    .snip-btn--start { background: var(--green-bg); color: var(--green); }
    .snip-btn--start:hover { background: rgba(52,211,153,0.15); }
    .snip-btn--end { background: var(--red-bg); color: var(--red); }
    .snip-btn--end:hover { background: rgba(248,113,113,0.15); }
    .snip-btn--clear { background: var(--bg-surface); color: var(--text-dim); border: 1px solid var(--border); }
    .snip-btn--clear:hover { color: var(--text-muted); border-color: var(--border-hover); }
    .snip-window {
      margin-left: auto; font-family: var(--mono); font-size: 11px; font-weight: 600;
      display: flex; align-items: center; gap: 8px;
    }
    .snip-window-val { padding: 2px 8px; border-radius: 4px; }
    .snip-window-val--start { background: var(--green-bg); color: var(--green); }
    .snip-window-val--end { background: var(--red-bg); color: var(--red); }
    .snip-window-sep { color: var(--text-dim); }
    .snip-hint {
      font-size: 10px; color: var(--text-dim); margin-top: 6px; font-style: italic;
    }

    @media (max-width: 700px) {
      .hero-top { padding: 12px 16px; flex-wrap: wrap; gap: 8px; }
      .hero-body { padding: 24px 16px 0; }
      .hero-score { font-size: 52px; }
      .main { padding: 16px 12px 40px; }
      .meta-bar { grid-template-columns: 1fr 1fr; }
      .meta-cell:first-child, .meta-cell:last-child { border-radius: 0; }
      .q-card-top { padding: 10px 14px; gap: 8px; }
      .q-card-title { font-size: 12px; }
      .ap-track { width: 80px; }
    }
  </style>
</head>
<body>
  <!-- HERO: Score is the star -->
  <div class="hero">
    <div class="hero-top">
      <div class="hero-top-left">
        <span class="hero-label">Audit Report</span>
        <span class="hero-id">${esc(id)}</span>
        ${statusBadge}
        <span style="font-size:11px;color:#6e7681;font-weight:500;">${esc(f.findingStatus ?? "")}</span>
      </div>
      <div class="ap" id="audio-player">
        <audio id="recording-audio" class="audio-native" preload="metadata" src="/audit/recording?id=${esc(id)}"></audio>
        <button class="ap-play" id="ap-play" title="Play recording">
          <span id="ap-icon-play">${icons.play16}</span>
          <span id="ap-icon-pause" style="display:none">${icons.pause16}</span>
        </button>
        <canvas id="ap-waveform" width="200" height="34" style="cursor:pointer;border-radius:4px;flex-shrink:0;"></canvas>
        <span class="ap-time" id="ap-time">0:00 / 0:00</span>
        <span class="audio-error" id="audio-error">No recording</span>
      </div>
    </div>
    <div class="hero-body">
      <div id="live-score" class="hero-score ${passRate >= 80 ? "good" : "bad"}">${passRate}%</div>
      <div class="hero-bar">
        <div class="hero-bar-track"><div id="live-bar" class="hero-bar-fill ${passRate >= 80 ? "good" : "bad"}" style="width:${passRate}%"></div></div>
      </div>
      <div class="hero-stats">
        <span class="hero-stat"><span class="dot dot-green" style="background:var(--green)"></span><span id="live-passed">${yesCount} passed</span></span>
        <span class="hero-stat"><span class="dot dot-red" style="background:var(--red)"></span><span id="live-failed">${noCount} failed</span></span>
        <span class="hero-stat"><span class="dot" style="background:var(--text-dim)"></span><span id="live-total">${total} total</span></span>
      </div>
      <div id="live-badge" style="display:none;align-items:center;gap:5px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--teal);margin-bottom:8px;"><span style="width:6px;height:6px;border-radius:50%;background:var(--teal);animation:bot-pulse 1.2s ease-in-out infinite;display:inline-block;"></span>Live</div>
      ${(f as any).appealSourceFindingId ? `<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--teal);margin-bottom:8px;padding:4px 10px;background:var(--teal-bg);border-radius:4px;display:inline-block;">Re-Audit</div>` : ""}
      <div class="hero-actions">
        ${passRate < 100 ? `<button class="appeal-btn" id="appeal-btn" onclick="openAppealChoice()">File Appeal</button>` : ""}
      </div>
      <!-- Appeal Confirmation (judge review) -->
      <div id="appeal-confirm-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.55);backdrop-filter:blur(8px);z-index:200;align-items:center;justify-content:center;">
        <div style="background:#161c28;border:1px solid #1c2333;border-radius:14px;padding:28px 32px 22px;max-width:480px;width:90vw;animation:appealIn 0.16s ease;">
          <div style="font-size:16px;font-weight:700;color:#e6edf3;margin-bottom:6px;">File an Appeal?</div>
          <div style="font-size:12px;color:#6e7681;margin-bottom:12px;line-height:1.5;">Select the questions you believe were incorrectly assessed. A judge will review those decisions. Only one appeal can be filed per record.</div>
          <div id="appeal-questions-list" style="margin-bottom:12px;max-height:200px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;padding-right:10px;box-sizing:border-box;"></div>
          <textarea id="appeal-comment-input" placeholder="Additional context for the judge (optional)..." style="width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#e6edf3;padding:10px 12px;font-size:12px;font-family:inherit;resize:vertical;min-height:60px;outline:none;margin-bottom:14px;"></textarea>
          <div style="display:flex;gap:10px;justify-content:flex-end;">
            <button onclick="document.getElementById('appeal-confirm-overlay').style.display='none'" style="padding:8px 18px;border-radius:7px;border:1px solid #1c2333;background:transparent;color:#6e7681;font-size:12px;font-weight:600;cursor:pointer;">Cancel</button>
            <button id="appeal-submit-btn" onclick="submitJudgeAppeal()" style="padding:8px 18px;border-radius:7px;border:none;background:#58a6ff;color:#fff;font-size:12px;font-weight:600;cursor:pointer;">File Appeal</button>
          </div>
        </div>
      </div>
      <style>@keyframes appealIn { from { opacity:0;transform:scale(0.95) translateY(6px); } to { opacity:1;transform:none; } }</style>

      <!-- Choice Modal: Appeal Decision vs Re-Audit Recording -->
      <div id="appeal-choice-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(8px);z-index:200;align-items:center;justify-content:center;">
        <div style="background:#161c28;border:1px solid #1c2333;border-radius:14px;padding:28px 28px 22px;max-width:520px;width:90vw;animation:appealIn 0.16s ease;">
          <div style="font-size:17px;font-weight:700;color:#e6edf3;margin-bottom:6px;">What would you like to do?</div>
          <div style="font-size:12px;color:#6e7681;margin-bottom:20px;">Choose how you'd like to address this audit result.</div>
          <div style="display:flex;gap:12px;margin-bottom:20px;">
            <button id="choice-appeal-btn" onclick="chooseAppeal()" style="flex:1;text-align:left;padding:18px;border-radius:10px;border:1px solid #30363d;background:#0d1117;color:#e6edf3;cursor:pointer;transition:border-color 0.15s;" onmouseover="this.style.borderColor='#58a6ff'" onmouseout="this.style.borderColor='#30363d'">
              <div style="font-weight:700;font-size:13px;margin-bottom:6px;color:#58a6ff;">Appeal Decision</div>
              <div style="font-size:11px;color:#6e7681;line-height:1.5;">Submit for a human to review the flagged questions</div>
            </button>
            <button id="choice-reaudit-btn" onclick="chooseReAudit()" style="flex:1;text-align:left;padding:18px;border-radius:10px;border:1px solid #30363d;background:#0d1117;color:#e6edf3;cursor:pointer;transition:border-color 0.15s;" onmouseover="this.style.borderColor='var(--teal)'" onmouseout="this.style.borderColor='#30363d'">
              <div style="font-weight:700;font-size:13px;margin-bottom:6px;color:var(--teal);">Add 2nd Genie / Different Recording</div>
              <div style="font-size:11px;color:#6e7681;line-height:1.5;">Run the audit again using a different or additional recording</div>
            </button>
          </div>
          <div style="text-align:center;">
            <button onclick="document.getElementById('appeal-choice-overlay').style.display='none'" style="padding:6px 22px;border-radius:7px;border:1px solid #30363d;background:transparent;color:#6e7681;font-size:12px;cursor:pointer;">Cancel</button>
          </div>
        </div>
      </div>

      <!-- Appeal Submitted! Success Screen -->
      <div id="appeal-success-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(8px);z-index:210;align-items:center;justify-content:center;">
        <div style="background:#161c28;border:1px solid #1c2333;border-radius:14px;padding:36px 32px;max-width:380px;width:90vw;text-align:center;animation:appealIn 0.16s ease;">
          <div style="font-size:36px;margin-bottom:14px;">✅</div>
          <div style="font-size:17px;font-weight:700;color:#e6edf3;margin-bottom:8px;">Appeal Submitted!</div>
          <div style="font-size:12px;color:#6e7681;line-height:1.5;">A judge will review your selected questions and make a final determination.</div>
        </div>
      </div>

      <!-- Re-Audit Receipt Offer -->
      <div id="receipt-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(8px);z-index:210;align-items:center;justify-content:center;">
        <div style="background:#161c28;border:1px solid #1c2333;border-radius:14px;padding:36px 32px;max-width:400px;width:90vw;text-align:center;animation:appealIn 0.16s ease;">
          <div style="font-size:48px;margin-bottom:14px;">☑️</div>
          <div style="font-size:17px;font-weight:700;color:#e6edf3;margin-bottom:10px;">Audit Re-submitted!</div>
          <div id="receipt-sent-to-row" style="margin-bottom:22px;">
            <div style="font-size:12px;color:#6e7681;margin-bottom:6px;line-height:1.5;">Would you like a receipt emailed to</div>
            <div id="receipt-email-display" style="font-size:13px;font-weight:600;color:#58a6ff;word-break:break-all;"></div>
          </div>
          <div style="display:flex;gap:10px;justify-content:center;">
            <button id="receipt-yes-btn" onclick="sendReceiptYes()" style="padding:10px 24px;border-radius:8px;background:var(--teal);border:none;color:#fff;font-size:13px;font-weight:700;cursor:pointer;">For sure!</button>
            <button onclick="sendReceiptNo()" style="padding:10px 24px;border-radius:8px;background:transparent;border:1px solid #30363d;color:#8b949e;font-size:13px;font-weight:600;cursor:pointer;">Nah, I'm good!</button>
          </div>
        </div>
      </div>

      <!-- Re-Audit Recording Modal Overlay -->
      <div id="reaudit-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(8px);z-index:200;align-items:center;justify-content:center;">
        <div style="background:#161c28;border:1px solid #1c2333;border-radius:14px;width:90vw;max-width:560px;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;animation:appealIn 0.16s ease;">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px 14px;border-bottom:1px solid #1c2333;flex-shrink:0;">
            <div style="font-size:15px;font-weight:700;color:#e6edf3;">Re-Audit Recording</div>
            <button onclick="document.getElementById('reaudit-overlay').style.display='none'" style="background:none;border:none;color:#6e7681;font-size:22px;cursor:pointer;line-height:1;padding:0 4px;">&times;</button>
          </div>
          <div style="overflow-y:auto;flex:1;">
      <div class="appeal-panel" id="appeal-panel">
        <div class="appeal-tabs">
          <button class="appeal-tab active" id="tab-recording" onclick="switchFork('recording')">Different Recording</button>
          <button class="appeal-tab" id="tab-upload" onclick="switchFork('upload')">Upload Recording</button>
        </div>
        <div class="appeal-fork" id="fork-recording">
          <div class="fork-label">Provide corrected or additional Recording IDs</div>
          <div class="recording-inputs" id="recording-inputs">
            <div class="recording-row">
              <input type="text" class="recording-input" id="recording-input-first" value="${esc(String((f as any).genieIds?.[0] ?? f.recordingId ?? ""))}" placeholder="8-digit Genie ID" maxlength="8" oninput="onRecordingInput(this)" onblur="validateRecordingInput(this)" onpaste="onRecordingPaste(event, this)" />
              <button class="recording-remove" style="visibility:hidden;" disabled>&times;</button>
            </div>
            ${Array.isArray((f as any).genieIds) && (f as any).genieIds.length > 1 ? (f as any).genieIds.slice(1).map((gid: string) => `<div class="recording-row"><input type="text" class="recording-input" value="${esc(gid)}" placeholder="8-digit Genie ID" maxlength="8" oninput="onRecordingInput(this)" onblur="validateRecordingInput(this)" onpaste="onRecordingPaste(event, this)" /><button class="recording-remove" onclick="this.parentElement.remove()">&times;</button></div>`).join('') : ''}
          </div>
          <button class="fork-add-btn" onclick="addRecordingInput()">+ Add Another</button>
          <textarea class="appeal-comment" id="recording-comment" placeholder="Optional comment for the judge..."></textarea>
          <button class="fork-submit" onclick="submitDifferentRecording()">Submit Re-Audit</button>
        </div>
        <div class="appeal-fork" id="fork-upload" style="display:none">
          <div class="upload-area" id="upload-area" onclick="document.getElementById('file-input').click()">
            <div class="upload-icon">${icons.upload}</div>
            <div class="upload-text">Click to select an audio file</div>
            <input type="file" id="file-input" accept="audio/mpeg,audio/*" style="display:none" onchange="handleFileSelect(this)" />
          </div>
          <div class="file-info" id="file-info">
            <div class="file-info-icon">${icons.music}</div>
            <span class="file-info-name" id="file-info-name"></span>
            <span class="file-info-size" id="file-info-size"></span>
            <button class="file-info-change" onclick="document.getElementById('file-input').click()">Change</button>
          </div>
          <div class="snip-editor" id="snip-editor">
            <audio id="snip-audio" preload="auto"></audio>
            <div class="snip-editor-label">Trim recording (optional)</div>
            <div class="snip-row">
              <button class="snip-play-btn" id="snip-play-btn" onclick="toggleSnipPlay()">${icons.playSmall}</button>
              <div class="snip-track-wrap">
                <div class="snip-track" id="snip-track" onclick="seekSnip(event)">
                  <div class="snip-fill" id="snip-fill"></div>
                  <div class="snip-cursor" id="snip-cursor"></div>
                  <div class="snip-range" id="snip-range"></div>
                  <div class="snip-handle snip-handle--start" id="snip-handle-start"></div>
                  <div class="snip-handle snip-handle--end" id="snip-handle-end"></div>
                </div>
                <div class="snip-times">
                  <span id="snip-time-cur">0:00</span>
                  <span id="snip-time-dur">0:00</span>
                </div>
              </div>
            </div>
            <div class="snip-actions">
              <button class="snip-btn snip-btn--start" onclick="setSnipStart()">Set Start</button>
              <button class="snip-btn snip-btn--end" onclick="setSnipEnd()">Set End</button>
              <button class="snip-btn snip-btn--clear" onclick="clearSnip()">Clear</button>
              <div class="snip-window" id="snip-window">
                <span class="snip-window-val snip-window-val--start" id="snip-val-start">--:--</span>
                <span class="snip-window-sep">${icons.arrowRight}</span>
                <span class="snip-window-val snip-window-val--end" id="snip-val-end">--:--</span>
              </div>
            </div>
            <div class="snip-hint">Seek to a position then click Set Start / Set End to define the window.</div>
          </div>
          <textarea class="appeal-comment" id="upload-comment" placeholder="Optional comment for the judge..."></textarea>
          <button class="fork-submit" id="upload-submit" onclick="submitUploadRecording()" disabled>Submit Re-Audit</button>
        </div>
      </div>
          </div><!-- /scroll-container -->
        </div><!-- /modal-box -->
      </div><!-- /reaudit-overlay -->
    </div>
  </div>

  <!-- MAIN CONTENT -->
  <div class="main">
    <!-- Compact metadata strip -->
    <div class="meta-bar">
      <div class="meta-cell"><div class="meta-label">Record ID</div><div class="meta-value">${crmUrl ? `<a href="${crmUrl}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none;border-bottom:1px solid #30363d;" onmouseover="this.style.borderBottomColor='#58a6ff';this.style.color='#58a6ff'" onmouseout="this.style.borderBottomColor='#30363d';this.style.color=''">${esc(recordId)}</a>` : esc(recordId)}</div></div>
      <div class="meta-cell"><div class="meta-label">Recording ID${Array.isArray((f as any).genieIds) && (f as any).genieIds.length > 1 ? 's' : ''}</div><div class="meta-value">${Array.isArray((f as any).genieIds) && (f as any).genieIds.length > 1 ? (f as any).genieIds.map((id: string) => esc(id)).join(', ') : esc(String(f.recordingId ?? ""))}</div></div>
      <div class="meta-cell"><div class="meta-label">Destination</div><div class="meta-value">${esc(String((record.DestinationDisplay || record.RelatedDestinationId) ?? ""))}</div></div>
      <div class="meta-cell"><div class="meta-label">Team Member</div><div class="meta-value">${(() => { const raw = (record as any).VoName as string | undefined; const parsed = raw ? (raw.includes(" - ") ? raw.split(" - ").slice(1).join(" - ").trim() : raw.trim()) : ""; return esc(parsed || (f.owner && f.owner !== "api" ? f.owner : "") || f.owner || ""); })()}</div></div>
      <div class="meta-cell"><div class="meta-label">Date</div><div class="meta-value">${(() => { try { return new Date(f.job?.timestamp ?? "").toLocaleString("en-US", { month: "numeric", day: "numeric", year: "2-digit", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }); } catch { return esc(f.job?.timestamp ?? ""); } })()}</div></div>
    </div>
    <!-- Record details row -->
    ${(() => {
      const chk = (val: any) => val && String(val) !== "0" && String(val).toLowerCase() !== "false" ? "☑" : "☐";
      const r = record as any;
      if (isPackage) {
        const mcc = chk(r["345"]); const msp = chk(r["306"]);
        return `<div class="meta-bar" style="margin-top:6px;">
        <div class="meta-cell"><div class="meta-label">Guest Name</div><div class="meta-value">${esc(String(r.GuestName ?? ""))}</div></div>
        <div class="meta-cell"><div class="meta-label">Marital Status</div><div class="meta-value">${esc(String(r["67"] ?? ""))}</div></div>
        <div class="meta-cell"><div class="meta-label">Office</div><div class="meta-value">${esc(String(r.OfficeName ?? ""))}</div></div>
        <div class="meta-cell"><div class="meta-label">Total Amount</div><div class="meta-value">${r["145"] ? "$" + esc(String(r["145"])) : "—"}</div></div>
        <div class="meta-cell"><div class="meta-label">MCC / MSP</div><div class="meta-value">${mcc} MCC &nbsp; ${msp} MSP</div></div>
        </div>`;
      } else {
        const wgs = chk(r["460"]); const mcc = chk(r["594"]);
        return `<div class="meta-bar" style="margin-top:6px;">
        <div class="meta-cell"><div class="meta-label">Guest Name</div><div class="meta-value">${esc(String(r.GuestName ?? r["32"] ?? ""))}</div></div>
        <div class="meta-cell"><div class="meta-label">Spouse Name</div><div class="meta-value">${esc(String(r["33"] ?? ""))}</div></div>
        <div class="meta-cell"><div class="meta-label">Marital Status</div><div class="meta-value">${esc(String(r["49"] ?? ""))}</div></div>
        <div class="meta-cell"><div class="meta-label">Arrival</div><div class="meta-value">${esc(String(r["8"] ?? ""))}</div></div>
        <div class="meta-cell"><div class="meta-label">Departure</div><div class="meta-value">${esc(String(r["10"] ?? ""))}</div></div>
        <div class="meta-cell"><div class="meta-label">WGS / MCC</div><div class="meta-value">${wgs} WGS &nbsp; ${mcc} MCC</div></div>
        </div>`;
      }
    })()}

    <!-- Transcript -->
    <div class="section">
      <div class="section-head">
        <span class="section-title">Transcript</span>
      </div>
      <div class="transcript-box">${transcriptHtml}</div>
    </div>

    <!-- Questions -->
    <div class="section">
      <div class="section-head">
        <span class="section-title">Questions</span>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="section-badge">${total}</span>
          <div class="expand-bar">
            <button onclick="expandAll()">Expand All</button>
            <button onclick="collapseAll()">Collapse All</button>
          </div>
        </div>
      </div>
      <div class="questions-list">
        ${questionsHtml || '<div style="text-align:center;padding:32px 20px;color:var(--text-dim);">No questions answered yet</div>'}
      </div>
    </div>
  </div>

  <script>
    function toggleCard(i) {
      var body = document.getElementById('body-' + i);
      var toggle = document.getElementById('toggle-' + i);
      if (!body) return;
      body.classList.toggle('open');
      if (toggle) toggle.classList.toggle('open');
    }
    function expandAll() {
      for (var i = 0; i < ${total}; i++) {
        var body = document.getElementById('body-' + i);
        var toggle = document.getElementById('toggle-' + i);
        if (body) body.classList.add('open');
        if (toggle) toggle.classList.add('open');
      }
    }
    function collapseAll() {
      for (var i = 0; i < ${total}; i++) {
        var body = document.getElementById('body-' + i);
        var toggle = document.getElementById('toggle-' + i);
        if (body) body.classList.remove('open');
        if (toggle) toggle.classList.remove('open');
      }
    }
    function toggleDetail(id, btn) {
      var el = document.getElementById(id);
      if (!el) return;
      el.classList.toggle('open');
      var summary = el.previousElementSibling;
      if (el.classList.contains('open')) {
        btn.textContent = 'Hide';
        if (summary && summary.classList.contains('sec-summary')) summary.style.display = 'none';
      } else {
        btn.textContent = btn.getAttribute('data-label') || 'Show more';
        if (summary && summary.classList.contains('sec-summary')) summary.style.display = '';
      }
    }
    // Store original label on sec-toggle buttons
    document.querySelectorAll('.sec-toggle').forEach(function(btn) {
      btn.setAttribute('data-label', btn.textContent);
    });
    function copySnippet(i) {
      var el = document.getElementById('snippet-' + i);
      if (!el) return;
      navigator.clipboard.writeText(el.value).then(function() {
        var btn = document.querySelector('#body-' + i + ' .copy-btn');
        if (!btn) return;
        btn.textContent = 'Copied';
        btn.classList.add('copied');
        setTimeout(function() { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1500);
      });
    }
    // -- Appeal fork panel --
    var _appealOpen = false;
    var _snipStartMs = null;
    var _snipEndMs = null;
    var _uploadFile = null;
    var _failedQuestions = ${JSON.stringify(questions.filter((q: any) => !isYesAnswer(q.answer)).map((q: any) => ({ header: q.header ?? "" })))};

    function updateAppealSubmitState() {
      var anyChecked = _failedQuestions.some(function(_, i) {
        var cb = document.getElementById('aq-' + i);
        return cb && cb.checked;
      });
      document.getElementById('appeal-submit-btn').disabled = !anyChecked;
    }

    function toggleAllAppealQuestions(checked) {
      _failedQuestions.forEach(function(_, i) {
        var cb = document.getElementById('aq-' + i);
        if (cb) cb.checked = checked;
      });
      var btn = document.getElementById('aq-all-btn');
      if (btn) btn.textContent = checked ? 'Uncheck All' : 'Check All';
      updateAppealSubmitState();
    }

    function handleCheckAll() {
      var allChecked = _failedQuestions.every(function(_, i) {
        var cb = document.getElementById('aq-' + i);
        return cb && cb.checked;
      });
      toggleAllAppealQuestions(!allChecked);
    }

    function confirmAppeal() {
      var btn = document.getElementById('appeal-btn');
      if (!btn || btn.disabled || btn.classList.contains('filed')) return;
      document.getElementById('appeal-comment-input').value = '';
      document.getElementById('appeal-submit-btn').disabled = true;
      var list = document.getElementById('appeal-questions-list');
      var checkAllHtml = '';
      if (_failedQuestions.length > 1) {
        checkAllHtml = '<div style="margin-bottom:8px;">' +
          '<button id="aq-all-btn" onclick="handleCheckAll()" style="padding:4px 14px;border-radius:6px;border:1px solid #6e57e0;background:rgba(110,87,224,0.12);color:#a78bfa;font-size:11px;font-weight:700;cursor:pointer;letter-spacing:0.3px;">Check All</button>' +
          '</div>' +
          '<div style="height:1px;background:#30363d;margin-bottom:6px;"></div>';
      }
      list.innerHTML = checkAllHtml + _failedQuestions.map(function(q, i) {
        return '<label style="display:flex;align-items:flex-start;gap:8px;padding:7px 10px;border-radius:6px;cursor:pointer;font-size:12px;color:#c9d1d9;background:#0d1117;border:1px solid #21262d;">' +
          '<input type="checkbox" id="aq-' + i + '" style="margin-top:2px;accent-color:#58a6ff;flex-shrink:0;" onchange="updateAppealSubmitState()">' +
          '<span>' + q.header + '</span></label>';
      }).join('');
      document.getElementById('appeal-confirm-overlay').style.display = 'flex';
    }

    function submitJudgeAppeal() {
      var comment = document.getElementById('appeal-comment-input').value.trim();
      var submitBtn = document.getElementById('appeal-submit-btn');
      var selectedQuestions = _failedQuestions.filter(function(_, i) {
        var cb = document.getElementById('aq-' + i);
        return cb && cb.checked;
      }).map(function(q) { return q.header; });
      submitBtn.disabled = true;
      submitBtn.textContent = 'Filing...';
      fetch('/audit/appeal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ findingId: '${esc(id)}', comment: comment, appealedQuestions: selectedQuestions }),
      })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          document.getElementById('appeal-confirm-overlay').style.display = 'none';
          if (d.ok) {
            lockAppealBtn();
            var successEl = document.getElementById('appeal-success-overlay');
            successEl.style.display = 'flex';
            setTimeout(function() { successEl.style.display = 'none'; }, 3000);
          } else {
            alert(d.error || 'Failed to file appeal');
            submitBtn.disabled = false;
            submitBtn.textContent = 'File Appeal';
          }
        })
        .catch(function() {
          alert('Network error — please try again');
          submitBtn.disabled = false;
          submitBtn.textContent = 'File Appeal';
        });
    }

    function lockAppealBtn(status) {
      var btn = document.getElementById('appeal-btn');
      if (!btn) return;
      btn.textContent = (status === 'complete') ? 'Appeal Decided' : 'Appeal Filed';
      btn.classList.add('filed');
      btn.disabled = true;
      btn.onclick = null;
    }

    function openAppealChoice() {
      var btn = document.getElementById('appeal-btn');
      if (!btn || btn.disabled || btn.classList.contains('filed')) return;
      document.getElementById('appeal-choice-overlay').style.display = 'flex';
    }

    function chooseAppeal() {
      document.getElementById('appeal-choice-overlay').style.display = 'none';
      confirmAppeal();
    }

    function chooseReAudit() {
      document.getElementById('appeal-choice-overlay').style.display = 'none';
      document.getElementById('reaudit-overlay').style.display = 'flex';
      _appealOpen = true;
    }

    var _pendingReauditFindingId = null;
    var _pendingReauditReportUrl = null;
    var _pendingAgentEmail = null;

    function sendReceiptYes() {
      var btn = document.getElementById('receipt-yes-btn');
      btn.disabled = true; btn.textContent = 'Sending...';
      fetch('/audit/send-reaudit-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ findingId: _pendingReauditFindingId, bccOnly: false }),
      }).catch(function() {}).finally(function() {
        window.location.href = _pendingReauditReportUrl;
      });
    }

    function sendReceiptNo() {
      // Always fire BCC even on opt-out, but skip agent email
      fetch('/audit/send-reaudit-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ findingId: _pendingReauditFindingId, bccOnly: true }),
      }).catch(function() {});
      window.location.href = _pendingReauditReportUrl;
    }

    function showReceiptModal(newFindingId, reportUrl, agentEmail, receiptDisplayEmail) {
      _pendingReauditFindingId = newFindingId;
      _pendingReauditReportUrl = reportUrl;
      var displayEmail = receiptDisplayEmail || agentEmail || '';
      var email = (displayEmail && displayEmail !== 'api') ? displayEmail : '';
      _pendingAgentEmail = email;
      var sentToRow = document.getElementById('receipt-sent-to-row');
      var displayEl = document.getElementById('receipt-email-display');
      if (email) {
        displayEl.textContent = email + '?';
        sentToRow.style.display = '';
      } else {
        sentToRow.style.display = 'none';
      }
      document.getElementById('receipt-overlay').style.display = 'flex';
    }

    function switchFork(name) {
      document.getElementById('fork-recording').style.display = name === 'recording' ? 'block' : 'none';
      document.getElementById('fork-upload').style.display = name === 'upload' ? 'block' : 'none';
      document.getElementById('tab-recording').classList.toggle('active', name === 'recording');
      document.getElementById('tab-upload').classList.toggle('active', name === 'upload');
    }

    function addRecordingInput(value) {
      var container = document.getElementById('recording-inputs');
      var row = document.createElement('div');
      row.className = 'recording-row';
      row.innerHTML = '<input type="text" class="recording-input" placeholder="8-digit Genie ID" maxlength="8" oninput="onRecordingInput(this)" onblur="validateRecordingInput(this)" onpaste="onRecordingPaste(event, this)" /><button class="recording-remove" onclick="this.parentElement.remove()">&times;</button>';
      container.appendChild(row);
      var inp = row.querySelector('.recording-input');
      if (value) { inp.value = value; validateRecordingInput(inp); }
      else inp.focus();
      return inp;
    }

    function onRecordingInput(inp) {
      // Clear validation feedback while typing — neutral state
      inp.style.borderColor = '';
    }

    function isAllDigits(s) {
      if (!s) return false;
      for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); if (c < 48 || c > 57) return false; }
      return true;
    }

    function validateRecordingInput(inp) {
      var v = inp.value.trim();
      inp.style.borderColor = isAllDigits(v) ? '#3d7a5a' : '';
    }

    function onRecordingPaste(e, inp) {
      e.preventDefault();
      var text = (e.clipboardData || window.clipboardData).getData('text');
      var parts = text.split(/[,\s]+/).map(function(s) { return s.trim(); }).filter(Boolean);
      if (parts.length <= 1) { inp.value = parts[0] || ''; validateRecordingInput(inp); return; }
      inp.value = parts[0]; validateRecordingInput(inp);
      for (var i = 1; i < parts.length; i++) { addRecordingInput(parts[i]); }
    }

    function submitDifferentRecording() {
      var inputs = document.querySelectorAll('#recording-inputs .recording-input');
      var ids = [];
      var hasInvalid = false;
      inputs.forEach(function(inp) {
        var v = inp.value.trim();
        var codes = []; for (var ci = 0; ci < v.length; ci++) codes.push(v.charCodeAt(ci));
        console.log('[RE-AUDIT] value:', JSON.stringify(v), 'len:', v.length, 'codes:', codes, 'ok:', isAllDigits(v));
        if (!v) return;
        if (!isAllDigits(v)) { inp.style.borderColor = 'var(--red)'; hasInvalid = true; }
        else ids.push(v);
      });
      if (hasInvalid) return;
      if (ids.length === 0) { alert('Enter at least one Recording ID'); return; }

      var comment = (document.getElementById('recording-comment').value || '').trim();
      var btn = document.querySelector('#fork-recording .fork-submit');
      btn.disabled = true;
      btn.textContent = 'Submitting...';

      var payload = { findingId: '${esc(id)}', recordingIds: ids };
      if (comment) payload.comment = comment;

      fetch('/audit/appeal/different-recording', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then(function(r) { return r.json(); }).then(function(d) {
        if (d.error) {
          btn.textContent = d.error;
          setTimeout(function() { btn.textContent = 'Submit Re-Audit'; btn.disabled = false; }, 2500);
        } else {
          lockAppealBtn();
          btn.textContent = 'Submitted!';
          showReceiptModal(d.newFindingId, d.reportUrl || '/audit/report?id=' + d.newFindingId, d.agentEmail, d.receiptDisplayEmail);
        }
      }).catch(function() {
        btn.textContent = 'Error';
        setTimeout(function() { btn.textContent = 'Submit Re-Audit'; btn.disabled = false; }, 2000);
      });
    }

    function fmtMs(ms) {
      if (ms == null) return '--:--';
      var s = Math.floor(ms / 1000);
      var m = Math.floor(s / 60); s = s % 60;
      return m + ':' + (s < 10 ? '0' : '') + s;
    }

    function fmtBytes(b) {
      if (b < 1024) return b + ' B';
      if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
      return (b / 1048576).toFixed(1) + ' MB';
    }

    function handleFileSelect(input) {
      var file = input.files[0];
      if (!file) return;
      _uploadFile = file;

      // Hide drop zone, show file info bar
      document.getElementById('upload-area').classList.add('has-file');
      var info = document.getElementById('file-info');
      info.classList.add('visible');
      document.getElementById('file-info-name').textContent = file.name;
      document.getElementById('file-info-size').textContent = fmtBytes(file.size);
      document.getElementById('upload-submit').disabled = false;

      // Show snip editor
      var audio = document.getElementById('snip-audio');
      audio.src = URL.createObjectURL(file);
      document.getElementById('snip-editor').classList.add('visible');

      _snipStartMs = null;
      _snipEndMs = null;
      updateSnipDisplay();
    }

    function toggleSnipPlay() {
      var audio = document.getElementById('snip-audio');
      var btn = document.getElementById('snip-play-btn');
      if (audio.paused) { audio.play(); btn.innerHTML = '${icons.pauseSmall.replace(/'/g, "\\'")}'; }
      else { audio.pause(); btn.innerHTML = '${icons.playSmall.replace(/'/g, "\\'")}'; }
    }

    // Snip audio event listeners
    (function() {
      var audio = document.getElementById('snip-audio');
      if (!audio) return;
      audio.addEventListener('timeupdate', function() {
        var cur = audio.currentTime * 1000;
        var dur = (audio.duration || 0) * 1000;
        document.getElementById('snip-time-cur').textContent = fmtMs(cur);
        if (dur > 0) {
          var pct = cur / dur * 100;
          document.getElementById('snip-fill').style.width = pct + '%';
          document.getElementById('snip-cursor').style.left = pct + '%';
        }
      });
      audio.addEventListener('loadedmetadata', function() {
        document.getElementById('snip-time-dur').textContent = fmtMs(audio.duration * 1000);
      });
      audio.addEventListener('ended', function() {
        document.getElementById('snip-play-btn').innerHTML = '${icons.playSmall.replace(/'/g, "\\'")}';
      });
    })();

    function seekSnip(e) {
      var track = document.getElementById('snip-track');
      var rect = track.getBoundingClientRect();
      var pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      var audio = document.getElementById('snip-audio');
      if (audio.duration) audio.currentTime = pct * audio.duration;
    }

    function setSnipStart() {
      var audio = document.getElementById('snip-audio');
      _snipStartMs = Math.round(audio.currentTime * 1000);
      if (_snipEndMs != null && _snipStartMs > _snipEndMs) _snipEndMs = null;
      updateSnipDisplay();
    }

    function setSnipEnd() {
      var audio = document.getElementById('snip-audio');
      _snipEndMs = Math.round(audio.currentTime * 1000);
      if (_snipStartMs != null && _snipEndMs < _snipStartMs) _snipStartMs = null;
      updateSnipDisplay();
    }

    function clearSnip() {
      _snipStartMs = null;
      _snipEndMs = null;
      updateSnipDisplay();
    }

    function updateSnipDisplay() {
      // Update value badges
      document.getElementById('snip-val-start').textContent = fmtMs(_snipStartMs);
      document.getElementById('snip-val-end').textContent = fmtMs(_snipEndMs);

      var audio = document.getElementById('snip-audio');
      var dur = (audio.duration || 0) * 1000;
      var range = document.getElementById('snip-range');
      var hStart = document.getElementById('snip-handle-start');
      var hEnd = document.getElementById('snip-handle-end');

      if (dur > 0 && _snipStartMs != null) {
        var leftPct = (_snipStartMs / dur * 100);
        var rightPct = _snipEndMs != null ? (_snipEndMs / dur * 100) : 100;
        range.style.left = leftPct + '%';
        range.style.width = (rightPct - leftPct) + '%';
        hStart.style.display = 'block';
        hStart.style.left = leftPct + '%';
      } else {
        range.style.left = '0';
        range.style.width = '0';
        hStart.style.display = 'none';
      }

      if (dur > 0 && _snipEndMs != null) {
        hEnd.style.display = 'block';
        hEnd.style.left = (_snipEndMs / dur * 100) + '%';
      } else {
        hEnd.style.display = 'none';
      }
    }

    function submitUploadRecording() {
      if (!_uploadFile) { alert('Select a file first'); return; }

      var btn = document.getElementById('upload-submit');
      btn.disabled = true;
      btn.textContent = 'Uploading...';

      var uploadComment = (document.getElementById('upload-comment').value || '').trim();
      var fd = new FormData();
      fd.append('findingId', '${esc(id)}');
      fd.append('file', _uploadFile);
      if (_snipStartMs != null) fd.append('snipStart', String(_snipStartMs));
      if (_snipEndMs != null) fd.append('snipEnd', String(_snipEndMs));
      if (uploadComment) fd.append('comment', uploadComment);

      fetch('/audit/appeal/upload-recording', { method: 'POST', body: fd })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d.error) {
            btn.textContent = d.error;
            setTimeout(function() { btn.textContent = 'Submit Re-Audit'; btn.disabled = false; }, 2500);
          } else {
            lockAppealBtn();
            btn.textContent = 'Submitted!';
            showReceiptModal(d.newFindingId, d.reportUrl || '/audit/report?id=' + d.newFindingId, d.agentEmail, d.receiptDisplayEmail);
          }
        }).catch(function() {
          btn.textContent = 'Error';
          setTimeout(function() { btn.textContent = 'Submit Re-Audit'; btn.disabled = false; }, 2000);
        });
    }
    // Custom audio player with waveform
    (function() {
      var audio = document.getElementById('recording-audio');
      var player = document.getElementById('audio-player');
      var playBtn = document.getElementById('ap-play');
      var iconPlay = document.getElementById('ap-icon-play');
      var iconPause = document.getElementById('ap-icon-pause');
      var canvas = document.getElementById('ap-waveform');
      var ctx2d = canvas ? canvas.getContext('2d') : null;
      var timeEl = document.getElementById('ap-time');
      if (!audio) return;

      var wfData = null;
      var wfProgress = 0;

      function drawWaveform() {
        if (!ctx2d || !canvas) return;
        var W = canvas.width, H = canvas.height;
        ctx2d.clearRect(0, 0, W, H);
        if (!wfData) {
          ctx2d.fillStyle = 'rgba(255,255,255,0.08)';
          ctx2d.fillRect(0, H / 2 - 1, W, 2);
          return;
        }
        var BARS = wfData.length;
        var barW = W / BARS;
        for (var i = 0; i < BARS; i++) {
          var x = i * barW;
          var amp = Math.max(2, wfData[i] * H * 0.88);
          var y = (H - amp) / 2;
          var played = (i / BARS) <= wfProgress;
          ctx2d.fillStyle = played ? '#14b8a6' : 'rgba(255,255,255,0.18)';
          ctx2d.fillRect(x + 0.5, y, Math.max(1, barW - 1.5), amp);
        }
        var cx = wfProgress * W;
        ctx2d.fillStyle = 'rgba(255,255,255,0.7)';
        ctx2d.fillRect(cx - 1, 0, 2, H);
      }

      // Load waveform data
      fetch('/audit/recording?id=${esc(id)}')
        .then(function(r) { return r.arrayBuffer(); })
        .then(function(buf) {
          var ac = new (window.AudioContext || window.webkitAudioContext)();
          return ac.decodeAudioData(buf);
        })
        .then(function(decoded) {
          var ch = decoded.getChannelData(0);
          var BARS = 150;
          var block = Math.floor(ch.length / BARS);
          var data = [];
          for (var i = 0; i < BARS; i++) {
            var sum = 0;
            for (var j = 0; j < block; j++) sum += Math.abs(ch[i * block + j]);
            data.push(sum / block);
          }
          var mx = Math.max.apply(null, data) || 1;
          for (var k = 0; k < data.length; k++) data[k] /= mx;
          wfData = data;
          drawWaveform();
        })
        .catch(function() { drawWaveform(); });

      function fmt(s) {
        var m = Math.floor(s / 60); var sec = Math.floor(s % 60);
        return m + ':' + (sec < 10 ? '0' : '') + sec;
      }
      function updateTime() {
        var cur = audio.currentTime || 0; var dur = audio.duration || 0;
        timeEl.textContent = fmt(cur) + ' / ' + fmt(dur);
        wfProgress = dur > 0 ? cur / dur : 0;
        drawWaveform();
      }

      playBtn.addEventListener('click', function() {
        if (audio.paused) { audio.play(); } else { audio.pause(); }
      });
      audio.addEventListener('play', function() { iconPlay.style.display = 'none'; iconPause.style.display = 'block'; });
      audio.addEventListener('pause', function() { iconPlay.style.display = 'block'; iconPause.style.display = 'none'; });
      audio.addEventListener('ended', function() { iconPlay.style.display = 'block'; iconPause.style.display = 'none'; wfProgress = 0; drawWaveform(); });
      audio.addEventListener('timeupdate', updateTime);
      audio.addEventListener('loadedmetadata', updateTime);

      if (canvas) {
        canvas.addEventListener('click', function(e) {
          var rect = canvas.getBoundingClientRect();
          var pct = (e.clientX - rect.left) / rect.width;
          if (audio.duration) audio.currentTime = pct * audio.duration;
        });
      }

      audio.addEventListener('error', function() {
        player.style.display = 'none';
        document.getElementById('audio-error').style.display = 'inline';
      });

      drawWaveform(); // initial placeholder
    })();
    // Admin mode — check if current user is admin, show pencil icons
    (function() {
      fetch('/admin/api/me')
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(d) { if (d && d.role === 'admin') document.body.classList.add('is-admin'); })
        .catch(function() {});
    })();
    window.adminFlipAnswer = function(idx) {
      var btn = document.querySelector('.q-card-edit[data-idx="' + idx + '"]');
      if (btn) { btn.disabled = true; btn.textContent = '…'; }
      fetch('/admin/flip-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ findingId: '${esc(id)}', questionIndex: idx })
      })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.ok) { window.location.reload(); }
        else { alert(d.error || 'Failed to flip answer'); if (btn) { btn.disabled = false; btn.textContent = '✏'; } }
      })
      .catch(function() { if (btn) { btn.disabled = false; btn.textContent = '✏'; } });
    };
    // Check if appeal already exists on load — disable button if so
    fetch('/audit/appeal/status?findingId=${esc(id)}')
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.reAuditedAt) {
          var btn = document.getElementById('appeal-btn');
          if (btn) { btn.textContent = 'Re-Audited'; btn.classList.add('filed'); btn.disabled = true; btn.onclick = null; }
          var overlay = document.getElementById('reaudit-overlay');
          if (overlay) overlay.style.display = 'none';
        } else if (d.exists) {
          lockAppealBtn(d.status);
          var overlay = document.getElementById('reaudit-overlay');
          if (overlay) overlay.style.display = 'none';
        }
      }).catch(function() {});
    // If already re-audited, lock the button too
    ${(f as any).reAuditedAt ? `(function() {
      var btn = document.getElementById('appeal-btn');
      if (btn) { btn.textContent = 'Re-Audited'; btn.classList.add('filed'); btn.disabled = true; btn.onclick = null; }
    })();` : ''}
    // SSE live updates — subscribe while finding is still processing
    (function() {
      var status = '${esc(String((f as any).findingStatus ?? "pending"))}';
      if (status === 'finished' || status === 'terminated') return;
      var liveEl = document.getElementById('live-badge');
      if (liveEl) liveEl.style.display = 'inline-flex';
      var es = new EventSource('/audit/report-sse?id=${esc(id)}');
      es.addEventListener('update', function(e) {
        var d = JSON.parse(e.data);
        var scoreEl = document.getElementById('live-score');
        var barEl = document.getElementById('live-bar');
        var passedEl = document.getElementById('live-passed');
        var failedEl = document.getElementById('live-failed');
        var totalEl = document.getElementById('live-total');
        if (scoreEl) { scoreEl.textContent = d.score + '%'; scoreEl.className = 'hero-score ' + (d.score >= 80 ? 'good' : 'bad'); }
        if (barEl) { barEl.style.width = d.score + '%'; barEl.className = 'hero-bar-fill ' + (d.score >= 80 ? 'good' : 'bad'); }
        if (passedEl) passedEl.textContent = d.passed + ' passed';
        if (failedEl) failedEl.textContent = d.failed + ' failed';
        if (totalEl) totalEl.textContent = d.total + ' total';
      });
      es.addEventListener('complete', function() {
        es.close();
        if (liveEl) liveEl.style.display = 'none';
        setTimeout(function() { window.location.reload(); }, 600);
      });
      es.onerror = function() {
        es.close();
        if (liveEl) liveEl.style.display = 'none';
      };
    })();
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function esc(s: unknown): string {
  const str = typeof s === "string" ? s : String(s ?? "");
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
