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

interface AnsweredQuestion {
  header?: string;
  answer?: string;
  thinking?: string;
  defense?: string;
  snippet?: string;
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

function scoreColor(pct: number): string {
  return pct >= 80 ? "var(--green)" : "var(--red)";
}

function formatTranscript(text: string): string {
  return text
    .replace(/\[AGENT\]/g, '[TEAM MEMBER]')
    .replace(/\[CUSTOMER\]/g, '[GUEST]');
}

/** Render a snippet as JSX with colored speaker labels. */
function renderSnippet(text: string): preact.JSX.Element[] {
  const normalized = formatTranscript(text);
  // Split keeping the speaker tags as separate tokens
  const re = /(\[TEAM MEMBER\]|\[GUEST\])/g;
  const parts = normalized.split(re);
  const out: preact.JSX.Element[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === "[TEAM MEMBER]") out.push(<span key={i} class="rpt-speaker team-member">{p}</span>);
    else if (p === "[GUEST]") out.push(<span key={i} class="rpt-speaker guest">{p}</span>);
    else if (p) out.push(<span key={i}>{p}</span>);
  }
  return out;
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

  // Transcript: prefer diarized (speaker-labeled), fall back to raw
  const diarized = finding.diarizedTranscript ?? "";
  const hasSpeakerLabels = diarized.includes("[AGENT]") || diarized.includes("[CUSTOMER]");
  const transcriptText = hasSpeakerLabels ? diarized : (finding.rawTranscript ?? "");

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
            const yes = isYes(q.answer);
            return (
              <details key={i} class={`rpt-q ${yes ? "pass" : "fail"}`} id={`rpt-q-${i}`}>
                <summary>
                  <span class="rpt-q-num">{i + 1}</span>
                  <span class="rpt-q-title">{q.header ?? "Untitled question"}</span>
                  <span class={`rpt-q-verdict ${yes ? "yes" : "no"}`} id={`rpt-q-answer-${i}`}>{yes ? "Yes" : "No"}</span>
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
                  <div class={`rpt-q-pill ${yes ? "yes" : "no"}`}>
                    <span style="font-size:14px;">{yes ? "✓" : "✗"}</span>
                    <span>Verdict: <strong>{yes ? "Compliant" : "Non-Compliant"}</strong></span>
                  </div>
                  {q.snippet && (
                    <div class="rpt-q-block">
                      <div class="rpt-q-label-row">
                        <div class="rpt-q-label">Transcript Context</div>
                        <button type="button" class="rpt-q-copy" data-idx={i} {...{ onclick: `event.preventDefault();copySnippet(${i});` }}>Copy</button>
                      </div>
                      <pre class="rpt-q-snippet" id={`rpt-q-snippet-${i}`}>{renderSnippet(q.snippet)}</pre>
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
                </div>
              </details>
            );
          })
        ) : (
          <div style="text-align:center;padding:32px 20px;color:var(--text-dim);">No questions answered yet</div>
        )}
      </div>
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
