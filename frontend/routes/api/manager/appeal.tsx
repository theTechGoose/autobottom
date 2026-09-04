/** HTMX fragment — appeal detail, opened from the APPEAL pill in the audit
 *  history table.
 *
 *  Everything here comes off ONE finding read: postJudgedAudit stamps each
 *  judged question with `judgeAction` / `judgedBy` / `judgeReason`, and the
 *  team member's typed appeal comment lands on the finding as `appealComment`.
 *  No index scan, no judge-queue read.
 *
 *  Two shapes of `judgeReason` exist in live data and both render here:
 *    - overturn → one of four codes (error / logic / fragment / transcript),
 *      set by the judge's reason picker.
 *    - uphold   → free text the judge typed, which is also what the team member
 *      gets in the appeal-result email.
 *  Appeals judged before the reason box shipped carry no reason at all — those
 *  say so rather than rendering an empty row. Screenshots a judge attached live
 *  on the judge-decided record, not the finding, so they aren't shown here. */
import { define } from "../../../lib/define.ts";
import { apiFetch } from "../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import { questionLabel } from "@core/business/question-labels/mod.ts";
import { APPEAL_OUTCOME_LABELS, appealDirection, judgeReasonText } from "@judge/domain/business/appeal-tracking/mod.ts";

interface AnsweredQuestion {
  header?: string;
  populated?: string;
  answer?: string;
  judgeAction?: "overturn" | "uphold";
  judgedBy?: string;
  judgeReason?: string;
}

interface Finding {
  findingId?: string;
  owner?: string;
  appealComment?: string;
  appealType?: string;
  answeredQuestions?: AnsweredQuestion[];
  record?: Record<string, unknown>;
}

function isYes(a: string | undefined): boolean {
  const s = String(a ?? "").trim().toLowerCase();
  return s.startsWith("yes") || s === "true" || s === "y" || s === "1";
}

function stripVoNamePrefix(raw: string): string {
  return raw.includes(" - ") ? raw.split(" - ").slice(1).join(" - ").trim() : raw.trim();
}

function teamMemberOf(f: Finding): string {
  const rec = (f.record ?? {}) as Record<string, unknown>;
  const vo = stripVoNamePrefix(String(rec.VoName ?? ""));
  if (vo) return vo;
  const owner = String(f.owner ?? "");
  return owner && owner !== "api" ? owner.split("@")[0] : "—";
}

const LABEL = "font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);";

const OUTCOME_PILL: Record<string, string> = {
  granted: "green",
  partial: "yellow",
  denied: "red",
  unknown: "blue",
};

export function renderAppealDetail(f: Finding, findingId: string) {
  const qs = f.answeredQuestions ?? [];
  const judged = qs
    .map((q, i) => ({ q, i }))
    .filter(({ q }) => q.judgeAction === "overturn" || q.judgeAction === "uphold");
  const overturned = judged.filter(({ q }) => q.judgeAction === "overturn").length;
  const upheld = judged.length - overturned;
  const scored = qs.length;
  const finalScore = scored > 0 ? Math.round((qs.filter((q) => isYes(q.answer)).length / scored) * 100) : null;
  // Overturned questions were "No" before the judge flipped them, so the
  // pre-appeal score is today's score minus those flips.
  const originalScore = scored > 0
    ? Math.round(((qs.filter((q) => isYes(q.answer)).length - overturned) / scored) * 100)
    : null;
  const judges = [...new Set(judged.map(({ q }) => q.judgedBy).filter(Boolean))] as string[];
  const comment = String(f.appealComment ?? "").trim();
  const direction = appealDirection(overturned, upheld);

  return (
    <div>
      {/* Lead with the direction — it is the first thing anyone opening this
          wants to know, and the badge that opened it says the same word. */}
      <div style="margin-bottom:14px;">
        <span class={`pill pill-${OUTCOME_PILL[direction]}`} style="font-size:12px;padding:4px 12px;">
          Appeal {APPEAL_OUTCOME_LABELS[direction]}
        </span>
      </div>

      <div style="display:flex;flex-wrap:wrap;gap:18px;align-items:baseline;margin-bottom:14px;">
        <div>
          <div style={LABEL}>Team member</div>
          <div style="font-size:14px;font-weight:600;color:var(--text-bright);">{teamMemberOf(f)}</div>
        </div>
        <div>
          <div style={LABEL}>Result</div>
          <div style="font-size:14px;color:var(--text-bright);">
            {originalScore != null && finalScore != null && originalScore !== finalScore
              ? <span><span style="color:var(--text-muted);">{originalScore}%</span> &rarr; <strong style="color:var(--green);">{finalScore}%</strong></span>
              : <span>{finalScore != null ? `${finalScore}%` : "—"} <span style="color:var(--text-muted);font-size:12px;">(unchanged)</span></span>}
          </div>
        </div>
        <div>
          <div style={LABEL}>Decisions</div>
          <div style="font-size:14px;color:var(--text-bright);">
            <strong style="color:var(--green);">{overturned}</strong> overturned
            {" · "}
            <strong style="color:var(--red);">{upheld}</strong> upheld
          </div>
        </div>
        {judges.length > 0 && (
          <div>
            <div style={LABEL}>Judged by</div>
            <div style="font-size:13px;color:var(--text);">{judges.join(", ")}</div>
          </div>
        )}
        <div style="margin-left:auto;">
          <a
            href={`/audit/report?id=${encodeURIComponent(findingId)}`}
            target="_blank"
            rel="noopener"
            class="btn btn-ghost btn-sm"
            style="text-decoration:none;"
          >Open full report &#8599;</a>
        </div>
      </div>

      {comment && (
        <div style="margin-bottom:16px;padding:10px 14px;border-left:3px solid var(--accent);background:var(--bg);border-radius:0 8px 8px 0;">
          <div style={LABEL}>What the team member said</div>
          <div style="font-size:13px;color:var(--text);line-height:1.6;white-space:pre-wrap;margin-top:4px;">{comment}</div>
        </div>
      )}

      {judged.length === 0 ? (
        <div class="placeholder-card">No judge decisions are recorded on this audit.</div>
      ) : (
        <div style="display:flex;flex-direction:column;gap:10px;">
          {judged.map(({ q, i }) => {
            const over = q.judgeAction === "overturn";
            const reasonRaw = String(q.judgeReason ?? "").trim();
            const reason = judgeReasonText(reasonRaw);
            return (
              <div
                key={i}
                style={`padding:12px 14px;border:1px solid var(--border);border-left:3px solid var(--${over ? "green" : "red"});border-radius:0 8px 8px 0;background:var(--bg);`}
              >
                <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px;">
                  <span class="mono" style="color:var(--text-dim);font-size:11px;">Q{i + 1}</span>
                  <span style="font-size:13px;font-weight:600;color:var(--text-bright);flex:1;">{questionLabel(q) || "—"}</span>
                  <span class={`pill pill-${over ? "green" : "red"}`}>{over ? "Overturned" : "Upheld"}</span>
                </div>
                {reason
                  ? <div style="font-size:13px;color:var(--text);line-height:1.6;white-space:pre-wrap;">{reason}</div>
                  : <div style="font-size:12px;color:var(--text-muted);font-style:italic;">No reason recorded — this appeal predates the reason box.</div>}
                {q.judgedBy && judges.length > 1 && (
                  <div style="font-size:11px;color:var(--text-dim);margin-top:6px;">{q.judgedBy}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const findingId = url.searchParams.get("findingId") ?? "";
    const html = (node: unknown) =>
      new Response(renderToString(node as never), { headers: { "content-type": "text/html" } });

    if (!findingId) return html(<div class="error-text">findingId required</div>);

    // Same two-step the finding-detail fragment uses: manager-scoped endpoint
    // first (it enforces the manager's department scope), then the generic one.
    let f: Finding | null = null;
    try {
      const resp = await apiFetch<Finding | { error: string }>(
        `/manager/api/finding?findingId=${encodeURIComponent(findingId)}`,
        ctx.req,
      );
      if (!("error" in resp)) f = resp as Finding;
    } catch { /* fall through */ }
    if (!f || !f.answeredQuestions) {
      try {
        f = await apiFetch<Finding>(`/audit/finding?id=${encodeURIComponent(findingId)}`, ctx.req);
      } catch (e) {
        return html(<div class="error-text">Failed to load appeal: {String(e)}</div>);
      }
    }
    if (!f) return html(<div class="error-text">Not found</div>);

    return html(renderAppealDetail(f, findingId));
  },
});
