/** Audit report UI — ported from production handleGetReport (main:controller.ts).
 *  Renders:
 *    - Hero: audit ID, status badge (PASSED/FAILED/pending), inline waveform audio player
 *    - Score block: big percentage, pass/fail counts
 *    - Record + Guest metadata grids
 *    - Transcript with speaker attribution
 *    - Questions list with verdict, thinking, defense (native <details> for expand)
 *
 *  The audio player uses a Fresh island (AudioPlayer) for the waveform rendering
 *  and seek interactions that are inherently browser-side. Everything else is
 *  server-rendered. */
import AudioPlayer from "../islands/AudioPlayer.tsx";
import AppealModal from "../islands/AppealModal.tsx";
import { buildFocusedExcerpt, type ExcerptSegment } from "../lib/transcript-excerpt.ts";
import { isValidDiarizedTranscript } from "@core/business/diarization-validation/mod.ts";

/** Render a focused excerpt's segments: speaker-labeled turns + `⋯` gap markers
 *  between elided windows. Shared shape with the top transcript / TranscriptPanel. */
function renderSegments(segments: ExcerptSegment[]): preact.JSX.Element[] {
  return segments.map((seg, si) =>
    seg.kind === "gap"
      ? <div key={si} class="rpt-snip-gap" aria-hidden="true">⋯</div>
      : (
        <div key={si} class="rpt-snip-line">
          {seg.speaker === "team" && <span class="rpt-speaker team">[TEAM MEMBER]</span>}
          {seg.speaker === "guest" && <span class="rpt-speaker guest">[GUEST]</span>}
          {seg.speaker ? " " : null}{seg.text}
        </div>
      )
  );
}

interface AnsweredQuestion {
  header?: string;
  answer?: string;
  thinking?: string;
  defense?: string;
  snippet?: string;
  /** Reviewer handle time for this question (active on-screen ms). Reviewed
   *  (failed) questions only; idle-discarded ones set reviewDiscarded. */
  reviewHandleMs?: number;
  reviewIdleMs?: number;
  reviewDiscarded?: boolean;
  /** Root-cause attribution for a failed question (manual admin override). */
  failureSource?: string;
  failureSourceBy?: string;
}

/** Failure-source options for the admin override control. */
const FAILURE_SOURCE_OPTIONS: Array<{ key: string; label: string }> = [
  { key: "autobot", label: "Autobot" },
  { key: "vo_app", label: "VO app" },
  { key: "team_member", label: "Team member" },
  { key: "unknown", label: "Unknown" },
];

/** ms → "1m 12s" / "45s" / "—". */
function fmtHandle(ms?: number): string {
  if (ms == null || ms <= 0) return "—";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

interface Finding {
  id: string;
  findingStatus?: string;
  recordingIdField?: string;
  record?: Record<string, unknown>;
  answeredQuestions?: AnsweredQuestion[];
  diarizedTranscript?: string;
  rawTranscript?: string;
  feedback?: { heading?: string; text?: string };
  startedAt?: number;
  completedAt?: number;
  /** Set by fileJudgeAppeal — surface as "Appeal Filed" disabled button. */
  appealedAt?: number;
  /** Set by reaudit flow — surface as "Re-Audited" disabled button. */
  reAuditedAt?: number;
  /** Set by reaudit flow — points to the new finding that superseded this
   *  one. Used to turn the "Re-Audited" pill into a one-click jump link. */
  reAuditedTo?: string;
  /** Multi-recording audits: per-track S3 keys (length = recording count). */
  s3RecordingKeys?: string[];
  /** Multi-recording audits: per-track recording IDs (genie IDs). */
  genieIds?: string[];
  /** Owner email — used as fallback when VoName is empty. */
  owner?: string;
  /** Pipeline job metadata; job.timestamp is when the audit run started. */
  job?: { timestamp?: string };
}

function stripVoNamePrefix(raw: string): string {
  return raw.includes(" - ") ? raw.split(" - ").slice(1).join(" - ").trim() : raw.trim();
}

function formatAuditDate(ts: string | undefined): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString("en-US", {
      month: "numeric", day: "numeric", year: "2-digit",
      hour: "numeric", minute: "2-digit",
      timeZone: "America/New_York",
    });
  } catch {
    return ts;
  }
}

const QB_DATE_URL = "https://monsterrg.quickbase.com/db/bpb28qsnn?a=dr&rid=";
const QB_PKG_URL = "https://monsterrg.quickbase.com/db/bttffb64u?a=dr&rid=";

function isYes(a: string | undefined): boolean {
  const s = String(a ?? "").trim().toLowerCase();
  return s.startsWith("yes") || s === "true" || s === "y" || s === "1";
}

/** "Error" answer is what step-ask-all writes when every Groq fallback model
 *  exhausted retries (rate-limit, timeout, etc.). It is NOT a verdict — the
 *  bot literally couldn't grade the question. Surface it as ERROR in the UI
 *  so reviewers / agents don't read a non-verdict as Non-Compliant. */
function isErrorAnswer(a: string | undefined): boolean {
  return String(a ?? "").trim().toLowerCase() === "error";
}

function scoreColor(pct: number): string {
  return pct >= 80 ? "var(--green)" : "var(--red)";
}

function formatTranscript(text: string): string {
  return text
    .replace(/\[AGENT\]/g, '[TEAM MEMBER]')
    .replace(/\[CUSTOMER\]/g, '[GUEST]');
}

export function AuditReport({ finding, id, auditorEmail = "", isAdmin = false }: { finding: Finding; id: string; auditorEmail?: string; isAdmin?: boolean }) {
  const questions = finding.answeredQuestions ?? [];
  const total = questions.length;
  const yesCount = questions.filter(q => isYes(q.answer)).length;
  const noCount = total - yesCount;
  const passRate = total > 0 ? Math.round((yesCount / total) * 100) : 0;
  const passed = noCount === 0 && total > 0;
  const finished = finding.findingStatus === "finished";

  const record = (finding.record ?? {}) as Record<string, unknown>;
  const recordId = String(record.RecordId ?? "");
  const isPackage = finding.recordingIdField === "GenieNumber";
  const crmUrl = recordId ? (isPackage ? QB_PKG_URL : QB_DATE_URL) + recordId : null;

  // Prefer diarized only when it's a real diarization; validate to avoid the
  // 76UGB0… refusal-as-transcript bug. Also neutralizes already-stored bad data.
  const diarized = finding.diarizedTranscript ?? "";
  const rawText = finding.rawTranscript ?? "";
  const transcriptText = isValidDiarizedTranscript(diarized, rawText) ? diarized : rawText;

  // Team member: prod strips the "DEST - " prefix from VoName, falling back to
  // the finding owner if VoName is missing (main:controller.ts:1253).
  const teamMember = (() => {
    const raw = record.VoName as string | undefined;
    const parsed = raw ? stripVoNamePrefix(raw) : "";
    if (parsed) return parsed;
    if (finding.owner && finding.owner !== "api") return finding.owner;
    return finding.owner || "—";
  })();

  // Multi-recording: when an audit covers >1 recording, surface each genie ID.
  const recordingIdSingle = (finding as unknown as { recordingId?: string }).recordingId ?? record.VoGenie ?? "—";
  const recordingIds = Array.isArray(finding.genieIds) && finding.genieIds.length > 1
    ? finding.genieIds
    : [String(recordingIdSingle)];
  const recordingCount = finding.s3RecordingKeys?.length ?? 1;

  // Record metadata
  const meta = {
    recordId: record.RecordId ?? "—",
    recordingId: recordingIdSingle,
    destination: record.DestinationDisplay ?? record["314"] ?? "—",
    teamMember,
    date: formatAuditDate(finding.job?.timestamp),
  };

  // Date-leg guest fields (ignored when isPackage)
  const guest = {
    guestName: record.GuestName ?? record["32"] ?? "—",
    spouseName: record["33"] ?? "—",
    maritalStatus: record["49"] ?? "—",
    arrival: record["8"] ?? "—",
    departure: record["10"] ?? "—",
    wgs: record["460"] === "yes",
    mcc: record["594"] === "yes",
  };

  // Package fields (ignored when !isPackage) — field IDs per prod main:controller.ts
  const pkg = {
    guestName: record.GuestName ?? "—",
    maritalStatus: record["67"] ?? "—",
    office: record.OfficeName ?? record["314"] ?? "—",
    totalAmount: record["145"] ? `$${record["145"]}` : "—",
    mcc: record["345"] === "yes" || record["345"] === true,
    msp: record["306"] === "yes" || record["306"] === true,
  };

  // Score badge color + label
  let statusBadge;
  if (!finished) {
    statusBadge = <span class="rpt-badge pending">{(finding.findingStatus ?? "unknown").toUpperCase()}</span>;
  } else if (passed) {
    statusBadge = <span class="rpt-badge pass">PASSED</span>;
  } else {
    statusBadge = <span class="rpt-badge fail">FAILED</span>;
  }

  return (
    <div class="rpt-body">
      {/* ===== Hero ===== */}
      <div class="rpt-hero">
        <div class="rpt-hero-top">
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
            <span class="rpt-hero-label">Audit Report</span>
            <code class="rpt-hero-id">{id}</code>
            {statusBadge}
            <span style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;">{finding.findingStatus ?? ""}</span>
          </div>
          <div style="display:flex;gap:12px;align-items:center;">
            {finished && <AudioPlayer findingId={id} recordingCount={recordingCount} />}
          </div>
        </div>
      </div>

      {/* ===== Score block ===== */}
      {finished ? (
        <div class="rpt-score">
          <div style={`font-size:72px;font-weight:800;color:${scoreColor(passRate)};font-variant-numeric:tabular-nums;line-height:1;`}>
            {passRate}%
          </div>
          <div class="rpt-score-bar" style={`--pct:${passRate}%;`}></div>
          <div style="display:flex;gap:24px;justify-content:center;margin-top:14px;font-size:11px;color:var(--text-muted);">
            <span style="color:var(--green);">● {yesCount} passed</span>
            <span style="color:var(--red);">● {noCount} failed</span>
            <span style="color:var(--text-dim);">● {total} total</span>
            {isAdmin && (() => {
              const tot = questions.reduce((s, q) => s + (q.reviewDiscarded ? 0 : (q.reviewHandleMs ?? 0)), 0);
              return tot > 0
                ? <span style="color:var(--cyan);" title="Reviewer active handle time across this audit's reviewed questions">⏱ {fmtHandle(tot)} review</span>
                : null;
            })()}
          </div>
        </div>
      ) : (
        <div class="rpt-score">
          <div style="font-size:16px;color:var(--text-dim);padding:40px 0;">Audit not yet complete — score pending</div>
        </div>
      )}

      {/* File Appeal — show on any finished, non-perfect audit. Sits below the
          score block to match prod's layout. */}
      {finished && passRate < 100 && (
        <div style="display:flex;justify-content:center;margin:8px 0 24px;">
          <AppealModal
            findingId={id}
            auditorEmail={auditorEmail}
            originalGenieId={String(meta.recordingId ?? "")}
            appealedAt={finding.appealedAt}
            reAuditedAt={finding.reAuditedAt}
            reAuditedTo={finding.reAuditedTo}
            failedQuestions={questions
              .map((q, i) => ({ index: i, header: q.header ?? "Untitled question", answer: q.answer ?? "" }))
              .filter((q) => !isYes(q.answer))}
          />
        </div>
      )}

      {/* ===== Record metadata grid ===== */}
      <div class="rpt-grid">
        <Field label="Record ID">{crmUrl
          ? <a href={crmUrl} target="_blank" rel="noopener" class="tbl-link">{meta.recordId}</a>
          : meta.recordId}</Field>
        <Field label={recordingIds.length > 1 ? "Recording IDs" : "Recording ID"}>{recordingIds.join(", ")}</Field>
        <Field label="Destination">{meta.destination}</Field>
        <Field label="Team Member">{meta.teamMember}</Field>
        <Field label="Date">{meta.date}</Field>
      </div>

      {/* ===== Guest metadata grid — prod switches layout by audit type ===== */}
      {isPackage ? (
        <div class="rpt-grid">
          <Field label="Guest Name">{pkg.guestName}</Field>
          <Field label="Marital Status">{pkg.maritalStatus}</Field>
          <Field label="Office">{pkg.office}</Field>
          <Field label="Total Amount">{pkg.totalAmount}</Field>
          <Field label="MCC / MSP">
            <span style={`color:${pkg.mcc ? "var(--green)" : "var(--text-dim)"};margin-right:14px;`}>{pkg.mcc ? "☑" : "☐"} MCC</span>
            <span style={`color:${pkg.msp ? "var(--green)" : "var(--text-dim)"};`}>{pkg.msp ? "☑" : "☐"} MSP</span>
          </Field>
        </div>
      ) : (
        <div class="rpt-grid">
          <Field label="Guest Name">{guest.guestName}</Field>
          <Field label="Spouse Name">{guest.spouseName}</Field>
          <Field label="Marital Status">{guest.maritalStatus}</Field>
          <Field label="Arrival">{guest.arrival}</Field>
          <Field label="Departure">{guest.departure}</Field>
          <Field label="WGS / MCC">
            <span style={`color:${guest.wgs ? "var(--green)" : "var(--text-dim)"};margin-right:14px;`}>{guest.wgs ? "☑" : "☐"} WGS</span>
            <span style={`color:${guest.mcc ? "var(--green)" : "var(--text-dim)"};`}>{guest.mcc ? "☑" : "☐"} MCC</span>
          </Field>
        </div>
      )}

      {/* ===== Transcript ===== */}
      <div class="rpt-section">
        <div class="rpt-section-title">Transcript</div>
        <div class="rpt-transcript">
          {transcriptText
            ? formatTranscript(transcriptText).split(/\r?\n/).map((line, i) => {
                const tm = line.startsWith("[TEAM MEMBER]");
                const gu = line.startsWith("[GUEST]");
                if (tm) return <div key={i} style="margin-bottom:8px;"><span class="rpt-speaker team">[TEAM MEMBER]</span>:{line.slice(13)}</div>;
                if (gu) return <div key={i} style="margin-bottom:8px;"><span class="rpt-speaker guest">[GUEST]</span>:{line.slice(7)}</div>;
                return <div key={i} style="margin-bottom:4px;">{line}</div>;
              })
            : <em style="color:var(--text-dim);">No transcript available</em>
          }
        </div>
      </div>

      {/* ===== Questions — render section even with total=0 (Invalid Genie) ===== */}
      <div class="rpt-section">
        <div class="rpt-section-title">Questions ({total})</div>
        {total > 0 ? (
          questions.map((q, i) => {
            const errored = isErrorAnswer(q.answer);
            const yes = !errored && isYes(q.answer);
            // Transcript Context: rebuild from the diarized transcript, focused to
            // the turns matching the bot's defense quote. Replaces the raw snippet,
            // which for short calls was the whole (often un-segmented) transcript —
            // the brick wall. See lib/transcript-excerpt.ts.
            const excerpt = q.snippet
              ? buildFocusedExcerpt({ diarized, raw: finding.rawTranscript, snippet: q.snippet, defense: q.defense })
              : null;
            const stateClass = errored ? "error" : (yes ? "pass" : "fail");
            const verdictClass = errored ? "error" : (yes ? "yes" : "no");
            const verdictLabel = errored ? "Error" : (yes ? "Yes" : "No");
            const verdictText = errored ? "Bot Error — Could Not Grade" : (yes ? "Compliant" : "Non-Compliant");
            const verdictIcon = errored ? "⚠" : (yes ? "✓" : "✗");
            return (
              <details key={i} class={`rpt-q ${stateClass}`} id={`rpt-q-${i}`}>
                <summary>
                  <span class="rpt-q-num">{i + 1}</span>
                  <span class="rpt-q-title">{q.header ?? "Untitled question"}</span>
                  {isAdmin && (q.reviewDiscarded ? (
                    <span title="Reviewer went idle (>60s) — excluded from handle-time stats"
                      style="font-size:10px;color:var(--text-dim);font-variant-numeric:tabular-nums;margin-right:6px;">⏱ idle-discarded</span>
                  ) : q.reviewHandleMs != null ? (
                    <span title="Reviewer active handle time"
                      style="font-size:10px;color:var(--cyan);font-variant-numeric:tabular-nums;margin-right:6px;">⏱ {fmtHandle(q.reviewHandleMs)}</span>
                  ) : null)}
                  <span class={`rpt-q-verdict ${verdictClass}`} id={`rpt-q-answer-${i}`}>{verdictLabel}</span>
                  {isAdmin && (
                    <button
                      type="button"
                      class="rpt-q-edit"
                      title="Flip answer (admin)"
                      data-idx={i}
                      {...{ onclick: `event.stopPropagation();event.preventDefault();flipQuestion(${i});` }}
                    >✏</button>
                  )}
                </summary>
                <div class="rpt-q-body">
                  <div class={`rpt-q-pill ${verdictClass}`}>
                    <span style="font-size:14px;">{verdictIcon}</span>
                    <span>Verdict: <strong>{verdictText}</strong></span>
                  </div>
                  {excerpt && !excerpt.empty && (
                    <div class="rpt-q-block">
                      <div class="rpt-q-label-row">
                        <div class="rpt-q-label">Transcript Context{excerpt.focused && <span class="rpt-q-label-hint"> · relevant excerpt</span>}</div>
                        <button type="button" class="rpt-q-copy" data-idx={i} {...{ onclick: `event.preventDefault();copySnippet(${i});` }}>Copy</button>
                      </div>
                      <div class="rpt-q-snippet" id={`rpt-q-snippet-${i}`} data-copy={excerpt.text}>
                        {renderSegments(excerpt.segments)}
                      </div>
                    </div>
                  )}
                  {q.thinking && (
                    <div class="rpt-q-block blue">
                      <div class="rpt-q-label">Reasoning</div>
                      <div class="rpt-q-text">{q.thinking}</div>
                    </div>
                  )}
                  {q.defense && (
                    <div class="rpt-q-block purple">
                      <div class="rpt-q-label">Defense</div>
                      <div class="rpt-q-text">{q.defense}</div>
                    </div>
                  )}
                  {isAdmin && !yes && !errored && (
                    <div class="rpt-q-block" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                      <div class="rpt-q-label" style="margin:0;">Failure source</div>
                      <select
                        id={`rpt-q-src-${i}`}
                        style="font-size:12px;padding:4px 8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);"
                        {...{ onchange: `window.setFailureSource(${i}, ${JSON.stringify(q.header ?? "")}, this.value);` }}
                      >
                        <option value="" disabled selected={!q.failureSource}>auto-detected (set to override)</option>
                        {FAILURE_SOURCE_OPTIONS.map((o) => (
                          <option key={o.key} value={o.key} selected={q.failureSource === o.key}>{o.label}</option>
                        ))}
                      </select>
                      {q.failureSourceBy && (
                        <span style="font-size:10px;color:var(--text-dim);">set by {q.failureSourceBy}</span>
                      )}
                    </div>
                  )}
                </div>
              </details>
            );
          })
        ) : (
          <div style="text-align:center;padding:32px 20px;color:var(--text-dim);">No questions answered yet</div>
        )}
      </div>

      {/* ===== Admin: Re-run with different genie(s) =====
       *   Gated behind isAdmin (server-rendered). Hits the existing
       *   /audit/api/appeal/different-recording endpoint and dumps the raw
       *   response inline so any error from startReauditWithGenies is
       *   visible to the admin instead of being swallowed by the agent
       *   AppealModal UX. */}
      {isAdmin && (
        <div class="rpt-section" style="border:1px dashed var(--border);border-radius:8px;padding:16px;margin-top:16px;">
          <div class="rpt-section-title" style="display:flex;align-items:center;gap:8px;">
            <span>Admin: Re-run audit with different genie(s)</span>
            <span style="font-size:10px;color:var(--text-dim);font-weight:400;letter-spacing:1px;">ADMIN ONLY</span>
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;">
            Paste one or more genie IDs (digits only). Same endpoint the agent appeal modal uses; the verbatim server response is shown below so backend errors aren't hidden.
          </div>
          <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;">
            <div style="flex:1;min-width:280px;">
              <label style="display:block;font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Genie IDs (comma or newline-separated)</label>
              <textarea
                id="rpt-rerun-ids"
                rows={2}
                placeholder="e.g. 470605, 470606"
                style="width:100%;font-family:var(--mono);font-size:12px;padding:6px 8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);"
              />
            </div>
            <div style="flex:1;min-width:240px;">
              <label style="display:block;font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Comment (optional)</label>
              <input
                type="text"
                id="rpt-rerun-comment"
                placeholder="why you're re-running"
                style="width:100%;font-size:12px;padding:6px 8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);"
              />
            </div>
            <button
              type="button"
              id="rpt-rerun-btn"
              class="btn btn-primary btn-sm"
              {...{ onclick: `event.preventDefault();window.adminRerunGenies();` }}
            >
              Re-run
            </button>
          </div>
          <pre
            id="rpt-rerun-output"
            style="margin-top:12px;font-size:11px;font-family:var(--mono);background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:10px;color:var(--text);white-space:pre-wrap;display:none;"
          ></pre>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: preact.ComponentChildren }) {
  return (
    <div class="rpt-field">
      <div class="rpt-field-label">{label}</div>
      <div class="rpt-field-value">{children}</div>
    </div>
  );
}
