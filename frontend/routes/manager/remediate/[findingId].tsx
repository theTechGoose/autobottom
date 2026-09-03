/** Manager remediation detail — full-page scrub view for one confirmed-failure
 *  audit. Reuses the reviewer/judge queue layout (split panel + click-to-scrub
 *  transcript + audio bar) instead of the old cramped Finding-Detail modal:
 *
 *   - Left: audit metadata + the questions list with FAILED questions on top.
 *     Clicking a failed question jumps the transcript + audio to where the bot's
 *     evidence for that failure appears (RemediationInteractive island).
 *   - Right: the click-to-scrub transcript (TranscriptPanel) — clicking any line
 *     seeks the audio to that moment.
 *   - Bottom: the audio player (QueueAudioPlayer), which consumes the
 *     `queue:jump-to-audio` events both click paths dispatch. HotkeyHandler is
 *     mounted in audio-only mode so Space/P, ←/→ and ↑/↓ drive it here exactly
 *     as they do in the review and judge queues.
 *   - Topbar: the same Remediate close-out the queue row offers, so a manager
 *     who opened the audit to scrub it can finish here instead of navigating
 *     back to record what they did.
 *
 *  A full page (not an HTMX fragment) so the islands actually hydrate — see
 *  frontend/CLAUDE.md Gotcha #1. The finding is fetched from the manager
 *  endpoint, which now attaches raw + utteranceTimes so scrubbing works; older
 *  audits with no per-line times still render, just without click-to-seek. */
import { define } from "../../../lib/define.ts";
import { Layout } from "../../../components/Layout.tsx";
import { emitTranscriptLines, TranscriptPanel, type TranscriptData } from "../../../components/TranscriptPanel.tsx";
import { findEvidenceLine } from "../../../lib/transcript-excerpt.ts";
import { apiFetch } from "../../../lib/api.ts";
import type { QueueItem } from "../../api/manager/queue.tsx";
import { safeDiarized } from "@core/business/diarization-validation/mod.ts";
import { questionLabel } from "@core/business/question-labels/mod.ts";
import { buildRecordMeta } from "@core/business/record-meta/mod.ts";
import { RecordDetails } from "../../../components/VerdictPanel.tsx";
import QueueAudioPlayer from "../../../islands/QueueAudioPlayer.tsx";
import RemediationInteractive from "../../../islands/RemediationInteractive.tsx";
import HotkeyHandler from "../../../islands/HotkeyHandler.tsx";
import AppealModal from "../../../islands/AppealModal.tsx";

interface AnsweredQuestion {
  header?: string;
  populated?: string;
  answer?: string;
  thinking?: string;
  defense?: string;
  /** The exact context the model graded this question against (step-ask-all
   *  stores it). Narrows the evidence-line lookup on a RAG-chunked long call. */
  snippet?: string;
}
interface Finding {
  findingId?: string;
  owner?: string;
  recordingId?: string;
  recordingIdField?: string;
  rawTranscript?: string;
  diarizedTranscript?: string;
  utteranceTimes?: number[];
  answeredQuestions?: AnsweredQuestion[];
  record?: Record<string, unknown>;
  completedAt?: number;
  findingStatus?: string;
  /** Appeal / re-audit state — AppealModal reads these to lock its own button
   *  ("Appeal Filed" / "Re-Audited") so a manager can't double-file. */
  appealedAt?: number;
  reAuditedAt?: number;
  reAuditedTo?: string;
}

// Same QuickBase deep-links the audit report + finding modal use.
const QB_DATE_URL = "https://monsterrg.quickbase.com/db/bpb28qsnn?a=dr&rid=";
const QB_PKG_URL = "https://monsterrg.quickbase.com/db/bttffb64u?a=dr&rid=";

function isYes(a: string | undefined): boolean {
  const s = String(a ?? "").trim().toLowerCase();
  return s.startsWith("yes") || s === "true" || s === "y" || s === "1";
}
function isErrorAnswer(a: string | undefined): boolean {
  return String(a ?? "").trim().toLowerCase() === "error";
}
function stripVoNamePrefix(raw: string): string {
  return raw.includes(" - ") ? raw.split(" - ").slice(1).join(" - ").trim() : raw.trim();
}
/** Team member display name: VoName (minus the "DEST - " prefix), else a real
 *  owner email — never the "api" token. Mirrors finding.tsx / the backend. */
function teamMemberOf(f: Finding): string {
  const raw = (f.record as Record<string, unknown> | undefined)?.VoName;
  const parsed = raw ? stripVoNamePrefix(String(raw)) : "";
  if (parsed) return parsed;
  if (f.owner && f.owner !== "api") return f.owner;
  return "—";
}
/** WGS/MCC sale flags — same semantic as the backend's saleFlagsFromFinding. */
function saleFlagsOf(f: Finding): { wgs: boolean; mcc: boolean } {
  const rec = (f.record ?? {}) as Record<string, unknown>;
  const sold = (v: unknown): boolean => {
    const s = String(v ?? "").trim().toLowerCase();
    return s !== "" && s !== "0" && s !== "no" && s !== "false";
  };
  return f.recordingIdField === "GenieNumber"
    ? { wgs: false, mcc: sold(rec["345"]) }
    : { wgs: sold(rec["460"]), mcc: sold(rec["594"]) };
}
function score(qs: AnsweredQuestion[]): number {
  if (qs.length === 0) return 0;
  const yes = qs.filter((q) => isYes(q.answer)).length;
  return Math.round((yes / qs.length) * 100);
}

/** The Remediate action for this audit — the same close-out the queue row
 *  offers, so a manager who opened the audit to scrub it doesn't have to go back
 *  to the queue to record what they did.
 *
 *  Returns BOTH halves together (the topbar control and the modal it opens)
 *  because they share one condition: a modal with no button is unreachable, and
 *  a button with no modal is dead. Deciding once keeps them from drifting apart.
 *
 *  Three states, driven by the QUEUE ITEM (remediation status lives there, not
 *  on the finding):
 *    - pending          → button + modal
 *    - already handled  → a stamp of who closed it, no modal. Re-submitting
 *                         would re-fire the manager webhook and re-award XP.
 *    - not in the queue → nothing; there's no queue item to close. */
export function renderRemediateAction(opts: {
  queueItem: QueueItem | null;
  findingId: string;
  userEmail: string;
  teamMember: string;
  returnTo: string;
}) {
  const { queueItem, findingId, userEmail, teamMember, returnTo } = opts;
  if (!queueItem) return { action: null, modal: null };

  if (queueItem.status === "remediated") {
    return {
      action: (
        <span class="rem-done" title={queueItem.notes ?? ""}>
          Remediated{queueItem.remediatedBy ? ` by ${queueItem.remediatedBy}` : ""}
        </span>
      ),
      modal: null,
    };
  }

  // Skipped is closed out too — show who decided, not a live button that would
  // silently re-skip an audit somebody already ruled on.
  if (queueItem.status === "skipped") {
    return {
      action: (
        <span class="rem-done">
          Skipped{queueItem.skippedBy ? ` by ${queueItem.skippedBy}` : ""}
        </span>
      ),
      modal: null,
    };
  }

  // An audit out for appeal has left the queue, but the button STAYS: appealing
  // and coaching are not mutually exclusive, and a manager who has already had
  // the conversation should still be able to write it up. The pill next to it
  // is what says the row is off their queue, so the live button doesn't read as
  // "this is still owed".
  return {
    action: (
      <button
        type="button"
        class="btn btn-primary btn-sm"
        {...{ "hx-on:click": "document.getElementById('remediate-modal')?.classList.add('open')" }}
      >Remediate</button>
    ),
    // Mirrors the queue's modal. findingId is baked in (no JS to set it — there's
    // only one audit on this page), and returnTo sends the manager back to the
    // queue view they came from, ?as= and all.
    modal: (
      <div id="remediate-modal" class="modal-overlay">
        <div class="modal" style="width:min(520px,92vw);">
          <div class="modal-title">Remediate Failure</div>
          <div class="modal-sub" style="margin-bottom:14px;">
            Record how this failure was addressed with {teamMember}.
          </div>
          <form hx-post="/api/manager/remediate" hx-swap="none">
            <input type="hidden" name="findingId" value={findingId} />
            {/* username → remediatedBy on the queue item + gamification credit */}
            <input type="hidden" name="username" value={userEmail} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <div class="form-group">
              <label>Remediation notes</label>
              <textarea name="notes" rows={5} required placeholder="What was discussed / corrected with the agent…"></textarea>
            </div>
            <div class="modal-actions">
              <button
                type="button"
                class="btn btn-ghost"
                {...{ "hx-on:click": "this.closest('.modal-overlay').classList.remove('open')" }}
              >Cancel</button>
              <button type="submit" class="btn btn-primary">Submit</button>
            </div>
          </form>
        </div>
      </div>
    ),
  };
}

/** The remediation note, for an audit that has already been closed out.
 *
 *  The note is the record of what a manager actually DID about a failure, and
 *  it used to be readable nowhere in the app — a required textarea whose only
 *  render was a `title` tooltip on the "Remediated by" stamp. It now leads the
 *  left panel here, and the Completed tab's Notes column links straight to it
 *  (the row click already opens this page).
 *
 *  Nothing renders while an item is still pending — there is no note yet — or
 *  when the audit isn't in the queue at all. */
export function renderRemediationNote(queueItem: QueueItem | null) {
  if (!queueItem || queueItem.status !== "remediated") return null;  // a skipped row has no note by design
  const note = (queueItem.notes ?? "").trim();
  const when = queueItem.remediatedAt
    ? new Date(queueItem.remediatedAt).toLocaleString("en-US", {
      timeZone: "America/New_York", month: "short", day: "numeric",
      year: "numeric", hour: "numeric", minute: "2-digit",
    }) + " ET"
    : "";
  const by = queueItem.remediatedBy ?? "";
  return (
    <div class="rem-note-panel" id="remediation-note">
      <div class="rem-note-panel-head">Remediation</div>
      {(by || when) && (
        <div class="rem-note-panel-meta">
          {by}{by && when ? " · " : ""}{when}
        </div>
      )}
      <div class="rem-note-panel-body">
        {note || <span style="color:var(--text-dim);font-style:italic;">No notes were recorded.</span>}
      </div>
    </div>
  );
}

/** Record Details — the same grid the review and judge queues show, built from
 *  the finding's raw QuickBase record via the shared buildRecordMeta.
 *
 *  Managers were coaching a rep on a failed call with no idea WHICH booking it
 *  was: the page carried only record ID, recording ID and type. Guest name,
 *  destination and travel dates are the context that makes a failure legible.
 *
 *  Open by default here, unlike review/judge. There the accordion is one of
 *  five competing for the panel and the reviewer is heads-down on one question;
 *  here it is the only one and the manager is reading for context before a
 *  conversation. Renders nothing when the record is empty rather than a grid of
 *  em-dashes. */
export function renderRecordDetails(f: { record?: Record<string, unknown>; recordingIdField?: string }) {
  const meta = buildRecordMeta(f.record, f.recordingIdField);
  if (Object.keys(meta).length === 0) return null;
  return (
    <details class="verdict-accordion" open>
      <summary>Record Details</summary>
      <RecordDetails meta={meta} isPackage={f.recordingIdField === "GenieNumber"} />
    </details>
  );
}

/** The failures on this audit, each carrying the transcript line its evidence
 *  points at.
 *
 *  FAILURES ONLY. Passing questions used to render below the failures, which on
 *  a 25-question audit with one failure meant 24 rows of "YES" pushing the one
 *  thing the manager opened the page for off the top of the panel. Remediation
 *  is about what went wrong; the pass count still shows in the topbar, and the
 *  full question list is one click away on the audit report.
 *
 *  Questions the bot could not grade are not passes, so they are not silently
 *  dropped with them — they get a count line above the list. There is nothing to
 *  coach on an ungraded question, so they don't earn a row.
 *
 *  The evidence lookup happens HERE, on the server, against the same rendered
 *  line list TranscriptPanel emits — so a row's `data-rem-line-idx` addresses
 *  the exact `data-line-idx` the island will query. It used to happen
 *  client-side at click time against the whole call, which is how a failure
 *  whose evidence describes what was NEVER said still jumped somewhere (see
 *  findEvidenceLine). A failure with no confident match gets no attribute and
 *  says so in place. */
export function renderQuestionList(qs: AnsweredQuestion[], transcript: TranscriptData) {
  const hasTimes = (transcript.utteranceTimes?.length ?? 0) > 0;

  // Original question numbers are preserved — a manager comparing against the
  // full report needs "question 2", not "the first row".
  const indexed = qs.map((q, i) => ({ q, num: i + 1 }));
  const failedRows = indexed.filter(({ q }) => !isYes(q.answer) && !isErrorAnswer(q.answer));
  const ungradedCount = indexed.filter(({ q }) => isErrorAnswer(q.answer)).length;
  const failedCount = failedRows.length;

  // Only worth resolving when the transcript can actually be seeked to.
  const renderedLines = hasTimes ? emitTranscriptLines(transcript).map((e) => e.line) : [];
  const evidenceLines = new Map<number, number>();
  for (const { q, num } of failedRows) {
    if (!renderedLines.length) break;
    const idx = findEvidenceLine({
      lines: renderedLines,
      defense: q.defense,
      thinking: q.thinking,
      snippet: q.snippet,
    });
    if (idx != null) evidenceLines.set(num, idx);
  }

  return (
    <>
      <div class="tbl-title" style="margin:16px 0 8px;">
        Failed Questions ({failedCount} of {qs.length})
        {evidenceLines.size > 0 && (
          <span class="rem-hint">
            {" "}· click a highlighted failure to jump to it ({evidenceLines.size} of {failedCount})
          </span>
        )}
      </div>
      {ungradedCount > 0 && (
        <div class="rem-q-ungraded">
          {ungradedCount} question{ungradedCount === 1 ? "" : "s"} could not be graded by the bot — not counted as a pass or a failure.
        </div>
      )}
      <div class="rem-q-list">
        {failedCount === 0
          ? <div class="rem-q-none">Nothing failed on this audit.</div>
          : failedRows.map(({ q, num }) => {
            const reason = q.defense || q.thinking || "";
            const lineIdx = evidenceLines.get(num);
            const jumpable = lineIdx != null;
            return (
              <div
                key={num}
                class={`rem-q-row rem-q-failed ${jumpable ? "rem-q-jumpable" : ""}`}
                {...(jumpable ? { "data-rem-line-idx": String(lineIdx), title: "Jump to this failure in the transcript" } : {})}
              >
                <div class="rem-q-head">
                  <span class="rem-q-num mono">{num}</span>
                  <span class="rem-q-name">{questionLabel(q) || "—"}</span>
                  <span class="pill pill-red">No</span>
                </div>
                {reason && <div class="rem-q-reason">{reason}</div>}
                {hasTimes && !jumpable && (
                  <div class="rem-q-nomatch">No matching moment in the call — nothing to jump to.</div>
                )}
              </div>
            );
          })}
      </div>
    </>
  );
}

export default define.page(async function RemediationDetail(ctx) {
  const user = ctx.state.user!;
  const url = new URL(ctx.req.url);
  const findingId = ctx.params.findingId;
  const asEmail = url.searchParams.get("as") ?? "";
  const asQs = asEmail ? `?as=${encodeURIComponent(asEmail)}` : "";
  // Where the row was clicked from, path + query and all, so Back and the
  // post-submit redirect both land on the EXACT filtered view the manager left
  // (member chip, date window, sort) instead of a default-windowed /manager.
  // Working six audits for one person used to mean re-filtering after every
  // single submit. Same open-redirect guard the remediate API wrapper uses:
  // same-origin absolute paths only, so "//host" and "https://…" are refused.
  const backParam = url.searchParams.get("back") ?? "";
  const backHref = backParam.startsWith("/") && !backParam.startsWith("//")
    ? backParam
    : `/manager${asQs}`;

  let f: Finding | null = null;
  try {
    const resp = await apiFetch<Finding | { error: string }>(
      `/manager/api/finding?findingId=${encodeURIComponent(findingId)}`, ctx.req,
    );
    if (!("error" in resp)) f = resp as Finding;
  } catch { /* fall through to the generic endpoint */ }
  if (!f || !f.answeredQuestions) {
    try {
      f = await apiFetch<Finding>(`/audit/finding?id=${encodeURIComponent(findingId)}`, ctx.req);
    } catch { /* rendered as not-found below */ }
  }

  if (!f) {
    return (
      <Layout title="Remediation" section="manager" user={user} pathname={url.pathname}>
        <div class="page-header"><h1>Remediation</h1></div>
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
  const reportUrl = `/audit/report?id=${encodeURIComponent(findingId)}`;
  const teamMember = teamMemberOf(f);
  const flags = saleFlagsOf(f);
  const saleTags = [...(flags.wgs ? ["WGS"] : []), ...(flags.mcc ? ["MCC"] : [])];

  // ── Appeal inputs, mirrored from the audit report ────────────────────────
  // Same audit, same appeal — so these deliberately reproduce report.tsx and
  // AuditReport.tsx rather than inventing a manager-flavoured variant.
  //
  // Gate: report shows the button on a finished audit that isn't perfect. Note
  // `pct < 100` is NOT the same as "has a confirmed failure" — a question the
  // bot couldn't grade drags the score below 100 without being a failure, and
  // that ungraded question is exactly the kind you'd want re-audited, so it
  // stays appealable here too.
  const appealable = f.findingStatus === "finished" && pct < 100;
  // Auditor: the manager is always logged in here, so user.email wins every
  // time. The rest of the report's chain is kept so this can't send an empty
  // auditor if that ever stops being true — the backend rejects empty.
  const voEmail = String(record.VoEmail ?? "").trim();
  const ownerEmail = String(f.owner ?? "").trim();
  const appealAuditorEmail = user.email ||
    voEmail ||
    (ownerEmail && ownerEmail !== "api" ? ownerEmail : "") ||
    "appeal-from-public-report@autobottom.local";
  // Prefill for the "Different Recording" tab. The report's chain ends in a
  // literal "—" for display; that is a fine dash to PRINT and a terrible thing
  // to seed a genie-ID input with, so this stops at "".
  const appealGenieId = String(f.recordingId ?? record.VoGenie ?? "");

  // The queue item — NOT the finding — is where remediation state lives
  // (submitRemediation writes status/remediatedBy/remediatedAt onto it). Read it
  // so this page can offer the same Remediate action the queue row does, and so
  // an already-handled failure shows who closed it instead of a button that
  // would re-fire the manager webhook and re-award XP. Same single-read cost as
  // the queue page itself; best-effort, since a missing queue item just means
  // there is nothing here to remediate.
  let queueItem: QueueItem | null = null;
  try {
    const { items } = await apiFetch<{ items: QueueItem[] }>(`/manager/api/queue${asQs}`, ctx.req);
    queueItem = (items ?? []).find((i) => i.findingId === findingId) ?? null;
  } catch (e) {
    console.error("Remediation detail — queue lookup failed:", e);
  }
  const remediate = renderRemediateAction({
    queueItem,
    findingId,
    userEmail: user.email,
    teamMember,
    returnTo: backHref,
  });

  const transcript = {
    raw: f.rawTranscript ?? "",
    // Sanitized on read so a stored refusal/commentary can never reach the
    // manager's remediation view — see @core/business/diarization-validation.
    diarized: safeDiarized(f.diarizedTranscript, f.rawTranscript),
    utteranceTimes: f.utteranceTimes ?? [],
  };

  return (
    <Layout title="Remediation" section="manager" user={user} pathname={url.pathname} hideSidebar>
      <div id="rem-detail">
        {/* Top bar: back + who / score / links */}
        <div class="rem-topbar">
          {/* Prefer a real Back when we came from the queue: the queue entry's
              URL now carries the filter state, so Back restores that exact view
              (bfcache, or SSR re-reads the params). Fall back to a plain link
              for a direct/deep link with no history. */}
          <a href={backHref} class="btn btn-ghost btn-sm" {...{ "hx-on:click": "if(history.length>1){event.preventDefault();history.back()}" }}>&larr; Queue</a>
          <div class="rem-topbar-main">
            <span class="rem-tm">{teamMember}</span>
            <span class={`pill pill-${pct >= 90 ? "green" : pct >= 70 ? "yellow" : "red"}`}>{pct}%</span>
            <span class="rem-sub">{failedCount} of {qs.length} failed</span>
            {saleTags.map((t) => (
              <span key={t} class={`pill pill-${t === "WGS" ? "green" : "blue"}`}>{t}</span>
            ))}
          </div>
          <a href={reportUrl} class="btn btn-ghost btn-sm" target="_blank" rel="noopener">Open Full Report &#8599;</a>
          {/* Appeal sits between the report and the close-out because that is the
              order of the decision: read it, dispute it if the bot got it wrong,
              otherwise coach it and close.

              Deliberately the SAME island and the SAME inputs as the audit
              report's button — the gate (finished + not a perfect score), the
              auditor-email fallback chain and the appealable-question filter are
              all copied from routes/audit/report.tsx + AuditReport.tsx so the two
              entry points can't drift into filing different appeals for the same
              audit. Only the trigger's placement differs (variant="inline").
              The island locks itself to "Appeal Filed" / "Re-Audited" off the
              finding, which the manager endpoint returns whole, so a manager
              can't double-file what a rep already appealed. */}
          {appealable && (
            <AppealModal
              variant="inline"
              findingId={findingId}
              auditorEmail={appealAuditorEmail}
              originalGenieId={appealGenieId}
              appealedAt={f.appealedAt}
              reAuditedAt={f.reAuditedAt}
              reAuditedTo={f.reAuditedTo}
              failedQuestions={qs
                .map((q, i) => ({ index: i, header: questionLabel(q) || "Untitled question", answer: q.answer ?? "" }))
                .filter((q) => !isYes(q.answer))}
            />
          )}
          {queueItem?.appealState && (
            <span
              class={`pill pill-${queueItem.appealState === "re-audited" ? "blue" : "yellow"}`}
              title={
                queueItem.appealState === "re-audited"
                  ? "New audio was submitted — this audit is off the remediation queue until the re-audit lands"
                  : "Out for a judge decision — this audit is off the remediation queue until the appeal is decided"
              }
            >{queueItem.appealState === "re-audited" ? "Re-Audited" : "Appealed"}</span>
          )}
          {queueItem?.appealDeniedAt && !queueItem.appealState && (
            <span class="pill pill-red" title="Appealed, but the judge let the failure stand">Appeal denied</span>
          )}
          {/* Nothing was graded here, so the questions list below is empty by
              design — say so up front rather than letting a manager hunt for
              a failure that does not exist. */}
          {queueItem?.invalidGenie && (
            <span class="pill pill-purple" title="The recording was missing or unusable, so the bot could not grade this call">
              Invalid genie
            </span>
          )}
          {remediate.action}
          {queueItem && remediate.modal && (
            <form
              hx-post="/api/manager/skip"
              hx-swap="none"
              style="display:inline;"
              {...{ "hx-on:submit": "if(!confirm('Skip this audit? It closes without a remediation note.'))event.preventDefault()" }}
            >
              <input type="hidden" name="findingId" value={findingId} />
              <input type="hidden" name="username" value={user.email} />
              <input type="hidden" name="returnTo" value={backHref} />
              <button
                type="submit"
                class="btn btn-ghost btn-sm"
                title="Close this out without recording a remediation"
              >Skip</button>
            </form>
          )}
        </div>

        <div class="queue-layout" data-mode="review" style="height:calc(100vh - 52px);">
          {/* Left: metadata + questions (failures first) */}
          <div class="queue-left">
            <div class="verdict-panel">
              <div class="verdict-scroll">
                {/* Leads the panel on a closed-out audit: someone opening this
                    from the Completed tab came to read what was done. */}
                {renderRemediationNote(queueItem)}

                <div class="rem-meta-grid">
                  <div><div class="rem-meta-label">Record</div><div class="mono">
                    {crmUrl
                      ? <a href={crmUrl} target="_blank" rel="noopener" style="color:var(--accent);text-decoration:none;">{recordId} &#8599;</a>
                      : (recordId || "—")}
                  </div></div>
                  <div><div class="rem-meta-label">Recording</div><div class="mono">{f.recordingId ?? "—"}</div></div>
                  <div><div class="rem-meta-label">Type</div><div>
                    <span class={`pill ${isPackage ? "pill-purple" : "pill-blue"}`}>{isPackage ? "partner" : "internal"}</span>
                    {" "}<span style="font-size:11px;color:var(--text-muted);">{f.findingStatus ?? ""}</span>
                  </div></div>
                </div>

                {renderRecordDetails(f)}

                {renderQuestionList(qs, transcript)}
              </div>
            </div>
          </div>

          {/* Right: click-to-scrub transcript */}
          <div class="queue-right">
            <TranscriptPanel transcript={transcript} />
          </div>
        </div>

        <QueueAudioPlayer initialFindingId={findingId} />
        <RemediationInteractive />
        {/* Transport keys only (Space/P, ←/→, ↑/↓) — this page has no queue
            content to decide on, so the review/judge shortcuts stay off. */}
        <HotkeyHandler mode="audio" />
      </div>

      {remediate.modal}
    </Layout>
  );
});
