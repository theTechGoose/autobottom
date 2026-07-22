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
 *     `queue:jump-to-audio` events both click paths dispatch.
 *
 *  A full page (not an HTMX fragment) so the islands actually hydrate — see
 *  frontend/CLAUDE.md Gotcha #1. The finding is fetched from the manager
 *  endpoint, which now attaches raw + utteranceTimes so scrubbing works; older
 *  audits with no per-line times still render, just without click-to-seek. */
import { define } from "../../../lib/define.ts";
import { Layout } from "../../../components/Layout.tsx";
import { TranscriptPanel } from "../../../components/TranscriptPanel.tsx";
import { apiFetch } from "../../../lib/api.ts";
import { safeDiarized } from "@core/business/diarization-validation/mod.ts";
import QueueAudioPlayer from "../../../islands/QueueAudioPlayer.tsx";
import RemediationInteractive from "../../../islands/RemediationInteractive.tsx";

interface AnsweredQuestion {
  header?: string;
  populated?: string;
  answer?: string;
  thinking?: string;
  defense?: string;
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

export default define.page(async function RemediationDetail(ctx) {
  const user = ctx.state.user!;
  const url = new URL(ctx.req.url);
  const findingId = ctx.params.findingId;
  const asEmail = url.searchParams.get("as") ?? "";
  const asQs = asEmail ? `?as=${encodeURIComponent(asEmail)}` : "";
  const backHref = `/manager${asQs}`;

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

  // Failures first (preserving each question's original number), then the rest.
  const indexed = qs.map((q, i) => ({ q, num: i + 1 }));
  const failedRows = indexed.filter(({ q }) => !isYes(q.answer) && !isErrorAnswer(q.answer));
  const passRows = indexed.filter(({ q }) => isYes(q.answer) || isErrorAnswer(q.answer));
  const ordered = [...failedRows, ...passRows];

  const transcript = {
    raw: f.rawTranscript ?? "",
    // Sanitized on read so a stored refusal/commentary can never reach the
    // manager's remediation view — see @core/business/diarization-validation.
    diarized: safeDiarized(f.diarizedTranscript, f.rawTranscript),
    utteranceTimes: f.utteranceTimes ?? [],
  };
  const hasTimes = (f.utteranceTimes?.length ?? 0) > 0;

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
          <a href={reportUrl} class="btn btn-primary btn-sm" target="_blank" rel="noopener">Open Full Report &#8599;</a>
        </div>

        <div class="queue-layout" data-mode="review" style="height:calc(100vh - 52px);">
          {/* Left: metadata + questions (failures first) */}
          <div class="queue-left">
            <div class="verdict-panel">
              <div class="verdict-scroll">
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

                <div class="tbl-title" style="margin:16px 0 8px;">
                  Questions ({qs.length}{failedCount > 0 ? ` · ${failedCount} failed` : ""})
                  {hasTimes && <span class="rem-hint"> · click a failed question to jump to it</span>}
                </div>

                <div class="rem-q-list">
                  {ordered.map(({ q, num }) => {
                    const yes = isYes(q.answer);
                    const errored = isErrorAnswer(q.answer);
                    const failed = !yes && !errored;
                    const pill = errored ? "blue" : yes ? "green" : "red";
                    const label = errored ? "Error" : yes ? "Yes" : "No";
                    const reason = failed ? (q.defense || q.thinking || "") : "";
                    // Failed rows carry their evidence so the island can locate
                    // the matching transcript line on click.
                    const evidence = failed ? `${q.defense ?? ""}\n${q.thinking ?? ""}`.trim() : "";
                    return (
                      <div
                        key={num}
                        class={`rem-q-row ${failed ? "rem-q-failed" : ""}`}
                        {...(failed ? { "data-rem-evidence": evidence, title: "Jump to this failure in the transcript" } : {})}
                      >
                        <div class="rem-q-head">
                          <span class="rem-q-num mono">{num}</span>
                          <span class="rem-q-name">{q.header || q.populated || "—"}</span>
                          <span class={`pill pill-${pill}`}>{label}</span>
                        </div>
                        {reason && <div class="rem-q-reason">{reason}</div>}
                      </div>
                    );
                  })}
                </div>
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
      </div>
    </Layout>
  );
});
