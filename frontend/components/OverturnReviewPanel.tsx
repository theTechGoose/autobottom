/** Overturn Review panel (REQ-047..051) — one held appeal: every judged
 *  question with the reviewer who failed it and the judge's call. Each
 *  overturn takes the team's call — confirm it, or reverse it to an uphold
 *  with a required note. Swapped whole by the HTMX decide/toggle routes. */
import { judgeReasonText } from "@judge/domain/business/appeal-tracking/mod.ts";
import type { OverturnReviewItem } from "@judge/domain/business/overturn-review/mod.ts";

export type { OverturnReviewItem };

export interface OverturnReviewWaiting { findingId: string; heldAt: number; judge: string }

interface Props {
  item: OverturnReviewItem | null;
  remaining: number;
  enabled: boolean;
  waiting: OverturnReviewWaiting[];
  isAdmin: boolean;
  /** A refused call (e.g. a reversal without a note), shown above the questions. */
  error?: string;
  /** Set after the team's last call closed an appeal. */
  finalizedId?: string;
}

const fmt = (ms?: number) =>
  ms ? new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }) : "—";

export function OverturnReviewPanel({ item, remaining, enabled, waiting, isAdmin, error, finalizedId }: Props) {
  return (
    <div id="ovr-panel" class="ovr-panel">
      <div class="ovr-head">
        <div>
          <div class="ovr-title">Overturn Review</div>
          <div class="ovr-sub">{remaining} waiting · overturned appeals are final only after the team's call</div>
        </div>
        {isAdmin && (
          <button
            type="button"
            class={`sf-btn ${enabled ? "danger" : "primary"} ovr-toggle`}
            hx-post="/api/judge/overturn-review/toggle"
            hx-vals={JSON.stringify({ enabled: String(!enabled), findingId: item?.findingId ?? "" })}
            hx-target="#ovr-panel"
            hx-swap="outerHTML"
          >
            {enabled ? "Turn off" : "Turn on"}
          </button>
        )}
      </div>

      {!enabled && (
        <div class="ovr-banner warn">
          Overturn Review is off — a judge's overturn closes the appeal and emails right away. Appeals already here still wait for a call.
        </div>
      )}
      {finalizedId && <div class="ovr-banner ok">Appeal {finalizedId} is final — the appeal result email has been sent.</div>}
      {error && <div class="ovr-banner err">{error}</div>}

      {waiting.length > 1 && (
        <div class="ovr-waiting">
          {waiting.map((w) => (
            <a
              href={`/judge/overturn-review?findingId=${encodeURIComponent(w.findingId)}`}
              class={`ovr-chip${w.findingId === item?.findingId ? " active" : ""}`}
            >
              {w.findingId.slice(0, 8)} · {fmt(w.heldAt)}
            </a>
          ))}
        </div>
      )}

      {!item ? (
        <div class="placeholder-card ovr-empty">No overturned appeals are waiting.</div>
      ) : (
        <>
          <div class="ovr-meta">
            <div><span>Record</span><a href={`/audit/report?id=${encodeURIComponent(item.findingId)}`} target="_blank">{item.recordId ?? item.findingId}</a></div>
            <div><span>Team member</span>{item.auditor ?? "—"}</div>
            <div><span>Judge</span>{item.judge}</div>
            <div><span>Held</span>{fmt(item.heldAt)}</div>
          </div>
          {item.appealComment && (
            <div class="ovr-comment"><span>Appeal comment</span>{item.appealComment}</div>
          )}

          {item.questions.map((q) => (
            <div class={`ovr-q ${q.decision}`} data-qi={String(q.questionIndex)}>
              <div class="ovr-q-head">
                <span class="ovr-q-name">{q.header}</span>
                <span class="ovr-q-bot">Bot: {q.botAnswer}</span>
              </div>
              {q.populated && <div class="ovr-q-text">{q.populated}</div>}
              <div class="ovr-q-line"><span>Failed by reviewer</span>{q.reviewer ?? "—"}</div>
              {q.decision === "overturn" ? (
                <div class="ovr-q-line"><span>Overturned by judge</span>{q.judge} — {judgeReasonText(q.judgeReason)}</div>
              ) : (
                <div class="ovr-q-line"><span>Upheld by judge</span>{q.judge}{q.judgeReason ? ` — ${judgeReasonText(q.judgeReason)}` : ""}</div>
              )}

              {q.decision === "overturn" && (q.verdict ? (
                <div class={`ovr-verdict ${q.verdict.verdict}`}>
                  {q.verdict.verdict === "confirm"
                    ? <>Overturn confirmed by {q.verdict.by}</>
                    : <>Reversed by {q.verdict.by} — the fail stands: {q.verdict.note}</>}
                </div>
              ) : (
                <div class="ovr-actions">
                  <form hx-post="/api/judge/overturn-review/decide" hx-target="#ovr-panel" hx-swap="outerHTML">
                    <input type="hidden" name="findingId" value={item.findingId} />
                    <input type="hidden" name="questionIndex" value={String(q.questionIndex)} />
                    <input type="hidden" name="verdict" value="confirm" />
                    <button type="submit" class="sf-btn primary ovr-confirm">Confirm overturn</button>
                  </form>
                  <form class="ovr-reverse" hx-post="/api/judge/overturn-review/decide" hx-target="#ovr-panel" hx-swap="outerHTML">
                    <input type="hidden" name="findingId" value={item.findingId} />
                    <input type="hidden" name="questionIndex" value={String(q.questionIndex)} />
                    <input type="hidden" name="verdict" value="reverse" />
                    <textarea name="note" required placeholder="Why the fail stands — required, and sent in the appeal result email"></textarea>
                    <button type="submit" class="sf-btn danger ovr-reverse-btn">Reverse — uphold the fail</button>
                  </form>
                </div>
              ))}
            </div>
          ))}
        </>
      )}
      <style>{CSS}</style>
    </div>
  );
}

const CSS = `
.ovr-panel { display:flex; flex-direction:column; gap:12px; padding:18px; overflow-y:auto; height:100%; box-sizing:border-box; }
.ovr-head { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
.ovr-title { font-size:18px; font-weight:700; color:var(--text-bright); }
.ovr-sub { font-size:12px; color:var(--text-muted); margin-top:2px; }
.ovr-banner { padding:8px 12px; border-radius:6px; font-size:12px; }
.ovr-banner.warn { background:var(--yellow-bg); color:var(--yellow); }
.ovr-banner.ok { background:var(--green-bg); color:var(--green); }
.ovr-banner.err { background:var(--red-bg); color:var(--red); }
.ovr-waiting { display:flex; flex-wrap:wrap; gap:6px; }
.ovr-chip { font-size:11px; padding:3px 8px; border:1px solid var(--border); border-radius:12px; color:var(--text-muted); text-decoration:none; }
.ovr-chip.active { border-color:#14b8a6; color:#14b8a6; }
.ovr-meta { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:8px; font-size:12px; color:var(--text-bright); }
.ovr-meta span, .ovr-comment span, .ovr-q-line span { display:block; font-size:10px; text-transform:uppercase; letter-spacing:.04em; color:var(--text-dim); }
.ovr-meta a { color:#14b8a6; }
.ovr-comment { font-size:13px; color:var(--text-bright); background:var(--bg-surface); padding:8px 12px; border-radius:6px; }
.ovr-q { border:1px solid var(--border); border-left:3px solid var(--text-dim); border-radius:6px; padding:12px; display:flex; flex-direction:column; gap:6px; }
.ovr-q.overturn { border-left-color:#14b8a6; }
.ovr-q-head { display:flex; justify-content:space-between; gap:8px; }
.ovr-q-name { font-weight:700; color:var(--text-bright); font-size:14px; }
.ovr-q-bot { font-size:11px; color:var(--red); }
.ovr-q-text { font-size:12px; color:var(--text-muted); }
.ovr-q-line { font-size:12px; color:var(--text-bright); }
.ovr-actions { display:flex; flex-direction:column; gap:8px; margin-top:4px; }
.ovr-reverse { display:flex; flex-direction:column; gap:6px; }
.ovr-reverse textarea { min-height:52px; background:var(--bg-surface); color:var(--text-bright); border:1px solid var(--border); border-radius:5px; padding:6px 8px; font:inherit; font-size:12px; }
.ovr-actions .sf-btn { font-size:12px; padding:7px 14px; align-self:flex-start; }
.ovr-verdict { font-size:12px; padding:6px 10px; border-radius:5px; }
.ovr-verdict.confirm { background:var(--green-bg); color:var(--green); }
.ovr-verdict.reverse { background:var(--red-bg); color:var(--red); }
`;
