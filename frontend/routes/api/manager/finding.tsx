/** HTMX fragment — finding detail (team member, audio, transcript snippet, Q&A).
 *  Tries the manager-scoped endpoint first; falls back to the generic audit
 *  endpoint when the manager one is incomplete.
 *
 *  Audio uses a NATIVE <audio controls> element (not the AudioPlayer island) —
 *  islands never hydrate inside HTMX-swapped fragments (frontend/CLAUDE.md
 *  Gotcha #1), but the plain element needs no JS. It streams from the same
 *  /audit/recording endpoint the report page uses (Range/206-capable). */
import { define } from "../../../lib/define.ts";
import { apiFetch } from "../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

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
  answeredQuestions?: AnsweredQuestion[];
  record?: Record<string, unknown>;
  completedAt?: number;
  findingStatus?: string;
  s3RecordingKeys?: string[];
  genieIds?: string[];
}

// Same QuickBase deep-links the audit report page uses (AuditReport.tsx).
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

/** WGS/MCC sale flags — same semantic as the backend's saleFlagsFromFinding:
 *  date-legs use QB 460/594 (amount or "yes"), packages use 345 (MCC only). */
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

/** Team member display name: VoName (minus the "DEST - " prefix), falling
 *  back to the owner email when it's a real email — never the "api" token. */
function teamMemberOf(f: Finding): string {
  const raw = (f.record as Record<string, unknown> | undefined)?.VoName;
  const parsed = raw ? stripVoNamePrefix(String(raw)) : "";
  if (parsed) return parsed;
  if (f.owner && f.owner !== "api") return f.owner;
  return "—";
}

function score(qs: AnsweredQuestion[]): number {
  if (qs.length === 0) return 0;
  const yes = qs.filter((q) => isYes(q.answer)).length;
  return Math.round((yes / qs.length) * 100);
}

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const findingId = url.searchParams.get("findingId") ?? "";
    if (!findingId) {
      return new Response(`<div class="error-text">findingId required</div>`, { headers: { "content-type": "text/html" } });
    }
    let f: Finding | null = null;
    try {
      const resp = await apiFetch<Finding | { error: string }>(`/manager/api/finding?findingId=${encodeURIComponent(findingId)}`, ctx.req);
      if (!("error" in resp)) f = resp as Finding;
    } catch { /* fall through */ }
    if (!f || !f.answeredQuestions) {
      try {
        f = await apiFetch<Finding>(`/audit/finding?id=${encodeURIComponent(findingId)}`, ctx.req);
      } catch (e) {
        return new Response(`<div class="error-text">Failed to load finding: ${e}</div>`, { headers: { "content-type": "text/html" } });
      }
    }
    if (!f) {
      return new Response(`<div class="error-text">Not found</div>`, { headers: { "content-type": "text/html" } });
    }

    const qs = f.answeredQuestions ?? [];
    const failedCount = qs.filter((q) => !isYes(q.answer) && !isErrorAnswer(q.answer)).length;
    const transcriptText = f.diarizedTranscript ?? f.rawTranscript ?? "";
    const transcriptSnippet = transcriptText.length > 600 ? transcriptText.slice(0, 600) + "…" : transcriptText;
    const record = (f.record ?? {}) as Record<string, unknown>;
    const recordId = String(record.RecordId ?? "");
    const isPackage = f.recordingIdField === "GenieNumber";
    const crmUrl = recordId ? (isPackage ? QB_PKG_URL : QB_DATE_URL) + recordId : null;
    const reportUrl = `/audit/report?id=${encodeURIComponent(findingId)}`;
    const teamMember = teamMemberOf(f);
    const pct = score(qs);
    // Multi-recording audits: one native player per track, labelled by genie id.
    const recordingCount = f.s3RecordingKeys?.length ?? 1;
    const recordingIds = Array.isArray(f.genieIds) && f.genieIds.length > 1
      ? f.genieIds
      : [String(f.recordingId ?? record.VoGenie ?? "")];

    const html = renderToString(
      <div style="padding:8px 0;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;">
          <div>
            <div style="color:var(--text-muted);font-size:11px;">Team Member</div>
            <div style="font-weight:700;font-size:16px;">{teamMember}</div>
          </div>
          <a href={reportUrl} class="btn btn-primary btn-sm" target="_blank" rel="noopener">Open Full Report &#8599;</a>
        </div>

        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:14px;">
          <div><div style="color:var(--text-muted);font-size:11px;">Score</div><div style="font-weight:600;"><span class={`pill pill-${pct >= 90 ? "green" : pct >= 70 ? "yellow" : "red"}`}>{pct}%</span> <span style="font-size:11px;color:var(--text-muted);">{failedCount} of {qs.length} failed</span></div></div>
          <div>
            <div style="color:var(--text-muted);font-size:11px;">Record</div>
            <div class="mono" style="font-size:12px;">
              {crmUrl
                ? <a href={crmUrl} target="_blank" rel="noopener" style="color:var(--accent);text-decoration:none;">{recordId} &#8599;</a>
                : (recordId || "—")}
            </div>
          </div>
          <div><div style="color:var(--text-muted);font-size:11px;">Recording</div><div class="mono" style="font-size:12px;">{f.recordingId ?? "—"}</div></div>
          <div><div style="color:var(--text-muted);font-size:11px;">Type</div><div><span class={`pill ${isPackage ? "pill-purple" : "pill-blue"}`}>{isPackage ? "partner" : "internal"}</span> <span style="font-size:11px;color:var(--text-muted);">{f.findingStatus ?? ""}</span></div></div>
          <div>
            <div style="color:var(--text-muted);font-size:11px;">Sale</div>
            <div>
              {(() => {
                const flags = saleFlagsOf(f!);
                const tags = [...(flags.wgs ? ["WGS"] : []), ...(flags.mcc ? ["MCC"] : [])];
                return tags.length === 0
                  ? <span style="color:var(--text-dim);">—</span>
                  : <span>{tags.map((t) => <span class={`pill pill-${t === "WGS" ? "green" : "blue"}`} style="margin-right:4px;">{t}</span>)}</span>;
              })()}
            </div>
          </div>
        </div>

        <div style="margin-bottom:14px;">
          <div class="tbl-title" style="margin-bottom:6px;">Audio</div>
          {Array.from({ length: recordingCount }, (_, i) => (
            <div key={i} style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
              {recordingCount > 1 && (
                <span class="mono" style="font-size:11px;color:var(--text-muted);white-space:nowrap;">REC {i + 1}{recordingIds[i] ? ` · ${recordingIds[i]}` : ""}</span>
              )}
              <audio
                controls
                preload="none"
                style="width:100%;height:36px;"
                src={`/audit/recording?id=${encodeURIComponent(findingId)}&idx=${i}`}
              />
            </div>
          ))}
        </div>

        <div style="margin-bottom:14px;">
          <div class="tbl-title" style="margin-bottom:6px;">Transcript Snippet</div>
          <pre style="white-space:pre-wrap;font-size:11px;color:var(--text);background:var(--bg);padding:10px;border-radius:6px;max-height:160px;overflow-y:auto;border:1px solid var(--border);">{transcriptSnippet || "(no transcript)"}</pre>
        </div>

        <div>
          <div class="tbl-title" style="margin-bottom:6px;">Questions ({qs.length}{failedCount > 0 ? ` · ${failedCount} failed` : ""})</div>
          <table class="data-table">
            <thead><tr><th>#</th><th>Question</th><th>Answer</th><th>Reason</th></tr></thead>
            <tbody>
              {qs.length === 0 ? (
                <tr class="empty-row"><td colSpan={4}>No questions</td></tr>
              ) : qs.map((q, i) => {
                const yes = isYes(q.answer);
                const errored = isErrorAnswer(q.answer);
                const pill = errored ? "blue" : yes ? "green" : "red";
                const label = errored ? "Error" : yes ? "Yes" : "No";
                // Failed rows carry the bot's defense/reasoning so the manager
                // can see WHY it failed without opening the full report.
                const reason = !yes && !errored ? (q.defense || q.thinking || "") : "";
                return (
                  <tr key={i} style={!yes && !errored ? "background:rgba(248,81,73,0.07);" : undefined}>
                    <td class="mono" style="width:28px;">{i + 1}</td>
                    <td style="font-size:12px;">{q.header || q.populated || "—"}</td>
                    <td><span class={`pill pill-${pill}`}>{label}</span></td>
                    <td style="font-size:11px;color:var(--text-muted);max-width:340px;">{reason}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>,
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
