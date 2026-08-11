/** Audit scrub view — GET /audit/scrub?id=X.
 *
 *  The audit report is a document: you read the score, the questions and the
 *  transcript, and the audio player at the top is a separate thing you scrub by
 *  hand while scrolling the text with your eyes. There is no way to hear the
 *  moment a question was graded on. This page is the same audit as a workspace:
 *
 *   - Left: record details + every question with its verdict and reasoning.
 *     Clicking a question jumps the transcript and the audio to the moment its
 *     evidence appears.
 *   - Right: the click-to-scrub transcript — clicking any line seeks the audio
 *     to that line's timestamp.
 *   - Bottom: the audio bar, with the same transport keys the review and judge
 *     queues use (Space/P, ←/→ seek, ↑/↓ speed).
 *
 *  Deliberately the SAME parts as the manager remediation view
 *  (/manager/remediate/[findingId]) — TranscriptPanel, QueueAudioPlayer and the
 *  RemediationInteractive click delegation — so the two scrub surfaces behave
 *  identically. The differences are on purpose: this one lists EVERY question
 *  (remediation is about failures only) and carries no queue close-out, because
 *  an audit reached from its report may not be in anyone's queue.
 *
 *  MULTI-RECORDING AUDITS DON'T JUMP, and that's correct rather than missing:
 *  step-transcribe's multi-genie branch concatenates plain `transcribe()` text
 *  with no utterances, so those audits have no utteranceTimes at all. The page
 *  detects that, says so, and still plays REC 1 — which beats offering jumps
 *  that would land on the wrong recording's clock.
 *
 *  Public, like /audit/report. It shows nothing the report doesn't already show
 *  to the same anonymous visitor (transcript and recording are both on the
 *  report), the findingId in the URL is the same unguessable token, and the
 *  "Scrub" button lives on that public page — gating this one would hand agents
 *  a login wall on a link to their own audit.
 *
 *  A full page (not an HTMX fragment) so the islands hydrate — see
 *  frontend/CLAUDE.md Gotcha #1. Registered in FRONTEND_EXACT_PAGES (main.ts)
 *  or /audit/* dispatches to danet and this 404s. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { apiFetch } from "../../lib/api.ts";
import { emitTranscriptLines, TranscriptPanel, type TranscriptData } from "../../components/TranscriptPanel.tsx";
import { findEvidenceLine } from "../../lib/transcript-excerpt.ts";
import { RecordDetails } from "../../components/VerdictPanel.tsx";
import { safeDiarized } from "@core/business/diarization-validation/mod.ts";
import { questionLabel } from "@core/business/question-labels/mod.ts";
import { buildRecordMeta } from "@core/business/record-meta/mod.ts";
import { authenticate } from "@core/business/auth/mod.ts";
import QueueAudioPlayer from "../../islands/QueueAudioPlayer.tsx";
import RemediationInteractive from "../../islands/RemediationInteractive.tsx";
import HotkeyHandler from "../../islands/HotkeyHandler.tsx";

interface AnsweredQuestion {
  header?: string;
  displayHeader?: string;
  populated?: string;
  answer?: string;
  thinking?: string;
  defense?: string;
  /** The exact context the model graded this question against (step-ask-all
   *  stores it). Narrows the evidence-line lookup on a RAG-chunked long call. */
  snippet?: string;
}

interface Finding {
  id?: string;
  findingStatus?: string;
  owner?: string;
  recordingId?: string;
  recordingIdField?: string;
  rawTranscript?: string;
  diarizedTranscript?: string;
  utteranceTimes?: number[];
  answeredQuestions?: AnsweredQuestion[];
  record?: Record<string, unknown>;
  error?: string;
}

// Same QuickBase deep-links the audit report + remediation view use.
const QB_DATE_URL = "https://monsterrg.quickbase.com/db/bpb28qsnn?a=dr&rid=";
const QB_PKG_URL = "https://monsterrg.quickbase.com/db/bttffb64u?a=dr&rid=";

function isYes(a: string | undefined): boolean {
  const s = String(a ?? "").trim().toLowerCase();
  return s.startsWith("yes") || s === "true" || s === "y" || s === "1";
}
/** "Error" is what step-ask-all writes when every Groq fallback exhausted its
 *  retries — the bot couldn't grade the question. Not a pass, not a failure. */
function isErrorAnswer(a: string | undefined): boolean {
  return String(a ?? "").trim().toLowerCase() === "error";
}
function stripVoNamePrefix(raw: string): string {
  return raw.includes(" - ") ? raw.split(" - ").slice(1).join(" - ").trim() : raw.trim();
}
/** Team member display name: VoName (minus the "DEST - " prefix), else a real
 *  owner email — never the "api" token. Mirrors the report + remediation view. */
function teamMemberOf(f: Finding): string {
  const raw = (f.record as Record<string, unknown> | undefined)?.VoName;
  const parsed = raw ? stripVoNamePrefix(String(raw)) : "";
  if (parsed) return parsed;
  if (f.owner && f.owner !== "api") return f.owner;
  return "—";
}

/** Every question on the audit, each carrying the transcript line its evidence
 *  points at.
 *
 *  ALL of them, in their original order — unlike the remediation view, which
 *  shows failures only. That view exists to coach one rep on what went wrong;
 *  this one is the report made playable, and someone checking a PASS ("did the
 *  bot really hear the disclosure?") needs to reach it just as much. Original
 *  numbering is preserved so a row here and a row on the report are the same
 *  "question 7".
 *
 *  The evidence lookup happens HERE, on the server, against the same rendered
 *  line list TranscriptPanel emits — so a row's `data-rem-line-idx` addresses
 *  the exact `data-line-idx` the island will query. Doing it client-side at
 *  click time against the whole call is how the old remediation modal jumped to
 *  unrelated lines (see findEvidenceLine). A question with no confident match
 *  gets no attribute and isn't clickable. */
export function renderQuestionList(qs: AnsweredQuestion[], transcript: TranscriptData) {
  const hasTimes = (transcript.utteranceTimes?.length ?? 0) > 0;
  const rows = qs.map((q, i) => ({ q, num: i + 1 }));

  // Only worth resolving when the transcript can actually be seeked to.
  const renderedLines = hasTimes ? emitTranscriptLines(transcript).map((e) => e.line) : [];
  const evidenceLines = new Map<number, number>();
  if (renderedLines.length) {
    for (const { q, num } of rows) {
      const idx = findEvidenceLine({
        lines: renderedLines,
        defense: q.defense,
        thinking: q.thinking,
        snippet: q.snippet,
      });
      if (idx != null) evidenceLines.set(num, idx);
    }
  }

  const failedCount = rows.filter(({ q }) => !isYes(q.answer) && !isErrorAnswer(q.answer)).length;

  return (
    <>
      <div class="tbl-title" style="margin:16px 0 8px;">
        Questions ({qs.length})
        {failedCount > 0 && <span class="rem-sub">{" "}· {failedCount} failed</span>}
        {evidenceLines.size > 0 && (
          <span class="rem-hint">
            {" "}· click a question to jump to it ({evidenceLines.size} of {qs.length})
          </span>
        )}
      </div>
      {!hasTimes && (
        <div class="rem-q-ungraded">
          This audit has no per-line timestamps, so questions and transcript lines can't jump the audio. The recording still plays below.
        </div>
      )}
      <div class="rem-q-list">
        {qs.length === 0
          ? <div class="rem-q-none">This audit has no graded questions.</div>
          : rows.map(({ q, num }) => {
            const pass = isYes(q.answer);
            const ungraded = isErrorAnswer(q.answer);
            const reason = q.defense || q.thinking || "";
            const lineIdx = evidenceLines.get(num);
            const jumpable = lineIdx != null;
            return (
              <div
                key={num}
                class={`rem-q-row ${pass ? "rem-q-passed" : ungraded ? "rem-q-error" : "rem-q-failed"} ${jumpable ? "rem-q-jumpable" : ""}`}
                {...(jumpable
                  ? { "data-rem-line-idx": String(lineIdx), title: "Jump to this moment in the call" }
                  : {})}
              >
                <div class="rem-q-head">
                  <span class="rem-q-num mono">{num}</span>
                  <span class="rem-q-name">{questionLabel(q) || "—"}</span>
                  <span class={`pill pill-${pass ? "green" : ungraded ? "yellow" : "red"}`}>
                    {pass ? "Yes" : ungraded ? "Error" : "No"}
                  </span>
                </div>
                {reason && <div class="rem-q-reason">{reason}</div>}
                {/* Only a GRADED question can be missing a moment. An "Error"
                    row has no verdict to locate — saying "no matching moment"
                    there blames the call for a bot outage. */}
                {hasTimes && !jumpable && !ungraded && (
                  <div class="rem-q-nomatch">No matching moment in the call — nothing to jump to.</div>
                )}
                {ungraded && (
                  <div class="rem-q-nomatch">The bot couldn't grade this question — it counts as neither a pass nor a failure.</div>
                )}
              </div>
            );
          })}
      </div>
    </>
  );
}

export default define.page(async function AuditScrubPage(ctx) {
  const url = new URL(ctx.req.url);
  // Trim — browsers URL-encode leading whitespace as `+`, so a copy/pasted id
  // with a leading space becomes ` LhW-…` and never matches.
  const id = (url.searchParams.get("id") ?? "").trim();
  const reportUrl = `/audit/report?id=${encodeURIComponent(id)}`;

  // Inline opportunistic auth, exactly as /audit/report does it — this path is
  // public, and putting the lookup in the middleware would make every public-path
  // hit compete for the auth-lane Firestore slot (that is what broke login under
  // concurrency). Anonymous is fine; the user is only used for the page chrome.
  let user = ctx.state.user;
  if (!user) {
    try {
      const auth = await authenticate(ctx.req);
      if (auth?.email && auth?.role) {
        user = {
          email: auth.email,
          orgId: auth.orgId,
          role: auth.role as "admin" | "judge" | "manager" | "reviewer" | "user",
        };
      }
    } catch { /* anonymous is fine */ }
  }

  if (!id) {
    return (
      <Layout title="Audit Scrub" section="admin" user={user} hideSidebar>
        <div style="padding:60px;text-align:center;color:var(--text-dim);">
          <h1 style="font-size:18px;color:var(--text-bright);margin-bottom:12px;">Missing finding ID</h1>
          <p>Open with <code>/audit/scrub?id=&lt;findingId&gt;</code></p>
        </div>
      </Layout>
    );
  }

  let f: Finding | null = null;
  let errorMsg: string | null = null;
  try {
    const data = await apiFetch<Finding>(`/audit/finding?id=${encodeURIComponent(id)}`, ctx.req);
    if (data && data.error) errorMsg = data.error;
    else f = data;
  } catch (e) {
    errorMsg = (e as Error).message;
  }

  if (errorMsg || !f) {
    return (
      <Layout title="Audit Scrub" section="admin" user={user} hideSidebar>
        <div style="max-width:720px;margin:60px auto;padding:0 24px;">
          <div style="background:var(--red-bg);border:1px solid rgba(248,81,73,0.2);border-radius:8px;padding:16px 20px;color:var(--red);font-size:13px;">
            {errorMsg === "not found"
              ? <>No audit finding with id <code>{id}</code> was found.</>
              : <>Couldn't load this audit: {errorMsg}</>}
          </div>
          <div style="margin-top:16px;text-align:center;">
            <a href={reportUrl} class="tbl-link">&larr; Back to report</a>
          </div>
        </div>
      </Layout>
    );
  }

  const qs = f.answeredQuestions ?? [];
  const total = qs.length;
  const yesCount = qs.filter((q) => isYes(q.answer)).length;
  const failedCount = qs.filter((q) => !isYes(q.answer) && !isErrorAnswer(q.answer)).length;
  const pct = total > 0 ? Math.round((yesCount / total) * 100) : 0;
  const record = (f.record ?? {}) as Record<string, unknown>;
  const recordId = String(record.RecordId ?? "");
  const isPackage = f.recordingIdField === "GenieNumber";
  const crmUrl = recordId ? (isPackage ? QB_PKG_URL : QB_DATE_URL) + recordId : null;
  const teamMember = teamMemberOf(f);
  const recordMeta = buildRecordMeta(f.record, f.recordingIdField);

  const transcript: TranscriptData = {
    raw: f.rawTranscript ?? "",
    // Sanitized on read so a stored refusal/commentary can never render as the
    // call — see @core/business/diarization-validation.
    diarized: safeDiarized(f.diarizedTranscript, f.rawTranscript),
    utteranceTimes: f.utteranceTimes ?? [],
  };

  return (
    <Layout title={`Scrub ${id}`} section="admin" user={user} pathname={url.pathname} hideSidebar>
      <div id="rem-detail">
        <div class="rem-topbar">
          {/* A real Back when there's history (the report we came from), a plain
              link otherwise so a shared/deep link still lands somewhere. */}
          <a
            href={reportUrl}
            class="btn btn-ghost btn-sm"
            {...{ "hx-on:click": "if(history.length>1){event.preventDefault();history.back()}" }}
          >&larr; Report</a>
          <div class="rem-topbar-main">
            <span class="rem-tm">{teamMember}</span>
            <span class={`pill pill-${pct >= 90 ? "green" : pct >= 70 ? "yellow" : "red"}`}>{pct}%</span>
            <span class="rem-sub">{failedCount} of {total} failed</span>
          </div>
          <a href={reportUrl} class="btn btn-ghost btn-sm" target="_blank" rel="noopener">Open Full Report &#8599;</a>
        </div>

        <div class="queue-layout" data-mode="review" style="height:calc(100vh - 52px);">
          {/* Left: record context + every question */}
          <div class="queue-left">
            <div class="verdict-panel">
              <div class="verdict-scroll">
                <div class="rem-meta-grid">
                  <div>
                    <div class="rem-meta-label">Record</div>
                    <div class="mono">
                      {crmUrl
                        ? <a href={crmUrl} target="_blank" rel="noopener" style="color:var(--accent);text-decoration:none;">{recordId} &#8599;</a>
                        : (recordId || "—")}
                    </div>
                  </div>
                  <div>
                    <div class="rem-meta-label">Recording</div>
                    <div class="mono">{f.recordingId ?? String(record.VoGenie ?? "—")}</div>
                  </div>
                  <div>
                    <div class="rem-meta-label">Type</div>
                    <div>
                      <span class={`pill ${isPackage ? "pill-purple" : "pill-blue"}`}>{isPackage ? "partner" : "internal"}</span>
                      {" "}<span style="font-size:11px;color:var(--text-muted);">{f.findingStatus ?? ""}</span>
                    </div>
                  </div>
                </div>

                {Object.keys(recordMeta).length > 0 && (
                  <details class="verdict-accordion" open>
                    <summary>Record Details</summary>
                    <RecordDetails meta={recordMeta} isPackage={isPackage} />
                  </details>
                )}

                {renderQuestionList(qs, transcript)}
              </div>
            </div>
          </div>

          {/* Right: click-to-scrub transcript */}
          <div class="queue-right">
            <TranscriptPanel transcript={transcript} />
          </div>
        </div>

        <QueueAudioPlayer initialFindingId={id} />
        <RemediationInteractive />
        {/* Transport keys only (Space/P, ←/→, ↑/↓) — no queue to decide on here. */}
        <HotkeyHandler mode="audio" />
      </div>
    </Layout>
  );
});
