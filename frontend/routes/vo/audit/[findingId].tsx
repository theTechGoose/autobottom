/** VO audit page — the manager's remediation view of one failed audit
 *  (transcript scrub, audio, failed questions, the same three appeal buttons),
 *  with Review in place of Remediate / Skip (REQ-035, REQ-037).
 *
 *  Only an audit in this login's own queue opens: the queue lookup is the
 *  scope check, the same single read the manager page does. */
import { define } from "../../../lib/define.ts";
import { Layout } from "../../../components/Layout.tsx";
import { TranscriptPanel } from "../../../components/TranscriptPanel.tsx";
import { appealGenieIds } from "../../../lib/appeal-genie-ids.ts";
import { apiFetch } from "../../../lib/api.ts";
import { safeDiarized } from "@core/business/diarization-validation/mod.ts";
import { questionLabel } from "@core/business/question-labels/mod.ts";
import QueueAudioPlayer from "../../../islands/QueueAudioPlayer.tsx";
import RemediationInteractive from "../../../islands/RemediationInteractive.tsx";
import HotkeyHandler from "../../../islands/HotkeyHandler.tsx";
import AppealModal from "../../../islands/AppealModal.tsx";
import {
  type Finding, isErrorAnswer, isYes, QB_DATE_URL, QB_PKG_URL, renderQuestionList, renderRecordDetails,
  saleFlagsOf, score, teamMemberOf,
} from "../../manager/remediate/[findingId].tsx";
import { renderVoReviewAction, type VoQueueItem } from "../../api/vo/queue.tsx";

/** The TM write-up, leading the left panel once the audit is reviewed. */
function renderTmReviewNote(item: VoQueueItem | null) {
  const r = item?.tmReview;
  if (!r) return null;
  const when = new Date(r.reviewedAt).toLocaleString("en-US", {
    timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  }) + " ET";
  return (
    <div class="rem-note-panel" id="tm-review-note">
      <div class="rem-note-panel-head">TM Review</div>
      <div class="rem-note-panel-meta">{r.reviewedBy} · {when}</div>
      <div class="rem-note-panel-body">{r.note}</div>
    </div>
  );
}

export default define.page(async function VoAudit(ctx) {
  const user = ctx.state.user!;
  const url = new URL(ctx.req.url);
  const findingId = ctx.params.findingId;
  const asEmail = url.searchParams.get("as") ?? "";
  const asQs = asEmail ? `?as=${encodeURIComponent(asEmail)}` : "";
  const backParam = url.searchParams.get("back") ?? "";
  const backHref = backParam.startsWith("/") && !backParam.startsWith("//") ? backParam : `/vo${asQs}`;

  let item: VoQueueItem | null = null;
  try {
    const { items } = await apiFetch<{ items: VoQueueItem[] }>(`/vo/api/queue${asQs}`, ctx.req);
    item = (items ?? []).find((i) => i.findingId === findingId) ?? null;
  } catch (e) { console.error("VO audit — queue lookup failed:", e); }

  let f: Finding | null = null;
  if (item) {
    try {
      const resp = await apiFetch<Finding | { error: string }>(`/manager/api/finding?findingId=${encodeURIComponent(findingId)}`, ctx.req);
      if (!("error" in resp)) f = resp as Finding;
    } catch { /* rendered as not found */ }
  }

  if (!item || !f) {
    return (
      <Layout title="Audit" section="vo" user={user} pathname={url.pathname}>
        <div class="page-header"><h1>Audit</h1></div>
        <div class="card" style="padding:24px;">
          <p>Couldn't load this audit.</p>
          <a href={backHref} class="btn btn-ghost btn-sm">&larr; Back to Queue</a>
        </div>
      </Layout>
    );
  }

  const qs = f.answeredQuestions ?? [];
  const failedCount = qs.filter((q) => !isYes(q.answer) && !isErrorAnswer(q.answer)).length;
  const pct = score(qs);
  const record = (f.record ?? {}) as Record<string, unknown>;
  const recordId = String(record.RecordId ?? "");
  const isPackage = f.recordingIdField === "GenieNumber";
  const crmUrl = recordId ? (isPackage ? QB_PKG_URL : QB_DATE_URL) + recordId : null;
  const teamMember = teamMemberOf(f);
  const flags = saleFlagsOf(f);
  const saleTags = [...(flags.wgs ? ["WGS"] : []), ...(flags.mcc ? ["MCC"] : [])];
  // Same appeal gate and inputs as the manager page and the report, so all
  // three entry points file the same appeal for the same audit.
  const appealable = f.findingStatus === "finished" && pct < 100;
  const review = renderVoReviewAction({ item, findingId, returnTo: backHref, asEmail });

  const transcript = {
    raw: f.rawTranscript ?? "",
    diarized: safeDiarized(f.diarizedTranscript, f.rawTranscript),
    utteranceTimes: f.utteranceTimes ?? [],
  };

  return (
    <Layout title="Audit" section="vo" user={user} pathname={url.pathname} hideSidebar>
      <div id="rem-detail">
        <div class="rem-topbar">
          <a href={backHref} class="btn btn-ghost btn-sm" {...{ "hx-on:click": "if(history.length>1){event.preventDefault();history.back()}" }}>&larr; Queue</a>
          <div class="rem-topbar-main">
            <span class="rem-tm">{teamMember}</span>
            <span class={`pill pill-${pct >= 90 ? "green" : pct >= 70 ? "yellow" : "red"}`}>{pct}%</span>
            <span class="rem-sub">{failedCount} of {qs.length} failed</span>
            {saleTags.map((t) => <span key={t} class={`pill pill-${t === "WGS" ? "green" : "blue"}`}>{t}</span>)}
          </div>
          <a href={`/audit/report?id=${encodeURIComponent(findingId)}`} class="btn btn-ghost btn-sm" target="_blank" rel="noopener">Open Full Report &#8599;</a>
          {appealable && (
            <AppealModal
              variant="inline"
              findingId={findingId}
              auditorEmail={user.email}
              originalGenieIds={appealGenieIds({ ...f, record })}
              appealedAt={f.appealedAt}
              reAuditedAt={f.reAuditedAt}
              reAuditedTo={f.reAuditedTo}
              awaitingReview={f.awaitingReview}
              failedQuestions={qs
                .map((q, i) => ({ index: i, header: questionLabel(q) || "Untitled question", answer: q.answer ?? "" }))
                .filter((q) => !isYes(q.answer))}
            />
          )}
          {item.appealState && (
            <span class={`pill pill-${item.appealState === "re-audited" ? "blue" : "yellow"}`}>
              {item.appealState === "re-audited" ? "Re-Audited" : "Appealed"}
            </span>
          )}
          {item.invalidGenie && <span class="pill pill-purple">Invalid genie</span>}
          {review.action}
        </div>

        <div class="queue-layout" data-mode="review" style="height:calc(100vh - 52px);">
          <div class="queue-left">
            <div class="verdict-panel">
              <div class="verdict-scroll">
                {renderTmReviewNote(item)}
                <div class="rem-meta-grid">
                  <div><div class="rem-meta-label">Record</div><div class="mono">
                    {crmUrl
                      ? <a href={crmUrl} target="_blank" rel="noopener" style="color:var(--accent);text-decoration:none;">{recordId} &#8599;</a>
                      : (recordId || "—")}
                  </div></div>
                  <div><div class="rem-meta-label">Recording</div><div class="mono">{f.recordingId ?? "—"}</div></div>
                  <div><div class="rem-meta-label">Type</div><div>
                    <span class={`pill ${isPackage ? "pill-purple" : "pill-blue"}`}>{isPackage ? "partner" : "internal"}</span>
                  </div></div>
                </div>
                {renderRecordDetails(f)}
                {renderQuestionList(qs, transcript)}
              </div>
            </div>
          </div>
          <div class="queue-right">
            <TranscriptPanel transcript={transcript} />
          </div>
        </div>

        <QueueAudioPlayer initialFindingId={findingId} />
        <RemediationInteractive />
        <HotkeyHandler mode="audio" />
      </div>

      {review.modal}
    </Layout>
  );
});
