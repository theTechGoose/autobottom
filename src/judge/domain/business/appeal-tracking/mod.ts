/** Appeal tracking — appeal lifecycle helpers and the one place that decides
 *  WHICH WAY a decided appeal went.
 *
 *  The appeal record used to carry nothing but `status: "complete"`, so every
 *  audit-history screen could only say "Appeal Complete" — true, and useless.
 *  `summarizeAppealOutcome` turns the judge's per-question decisions into the
 *  direction, the score movement, and the reason lines a tooltip can show, and
 *  those get stamped onto the appeal record when the judge finishes.
 *
 *  `appealOutcomeFromFinding` derives the same summary from an already-judged
 *  finding, which is how appeals decided before the stamp existed get
 *  back-filled. Both are pure so the shape can't drift between the two. */
import { questionLabel } from "@core/business/question-labels/mod.ts";
import type { AppealOutcome } from "@core/dto/types.ts";

export function isAppealExpired(appealedAt: number, maxDays = 7): boolean {
  return (Date.now() - appealedAt) > maxDays * 86400000;
}

/** The overturn picker's four codes, spelled out. An uphold carries the
 *  judge's own free text instead, which is shown verbatim. */
export const JUDGE_REASON_CODES: Record<string, string> = {
  error: "Bot error — the bot got it wrong",
  logic: "Question logic — the question itself misfired",
  fragment: "Fragment — the snippet the bot judged was incomplete",
  transcript: "Transcript — the transcript was wrong or missing",
};

export function judgeReasonText(raw: string | null | undefined): string {
  const r = String(raw ?? "").trim();
  return JUDGE_REASON_CODES[r] ?? r;
}

/** How each outcome is NAMED to a human. One place, so the badge, the CSV and
 *  anything else that reports an appeal all say the same word. `unknown` keeps
 *  the old wording — it is the honest label for "decided, direction unknown". */
export const APPEAL_OUTCOME_LABELS: Record<AppealOutcome, string> = {
  granted: "Accepted",
  partial: "Partly Accepted",
  denied: "Denied",
  unknown: "Complete",
};

/** A question the judge ruled on, in whichever shape the caller holds it:
 *  a `judge-decided` row (`decision`) or a stamped finding question
 *  (`judgeAction`). */
export interface JudgedQuestion {
  header?: string;
  displayHeader?: string;
  populated?: string;
  decision?: "overturn" | "uphold";
  judgeAction?: "overturn" | "uphold";
  reason?: string;
  judgeReason?: string;
}

export interface AppealOutcomeSummary {
  outcome: AppealOutcome;
  overturnedCount: number;
  upheldCount: number;
  scoreBefore?: number;
  scoreAfter?: number;
  judgeNotes?: string;
}

/** Keep the stamped notes small — this rides along on every appeal record and
 *  is read on every audit-history page load. */
const MAX_NOTE_LINES = 8;
const MAX_NOTES_CHARS = 700;

function actionOf(q: JudgedQuestion): "overturn" | "uphold" | null {
  const a = q.decision ?? q.judgeAction;
  return a === "overturn" || a === "uphold" ? a : null;
}

export function appealDirection(overturned: number, upheld: number): AppealOutcome {
  if (overturned + upheld === 0) return "unknown";
  if (upheld === 0) return "granted";
  if (overturned === 0) return "denied";
  return "partial";
}

/** Turn the judge's decisions into the summary stamped on the appeal record. */
export function summarizeAppealOutcome(
  judged: JudgedQuestion[],
  scores?: { before?: number; after?: number },
): AppealOutcomeSummary {
  const decided = judged.filter((q) => actionOf(q) !== null);
  const overturnedCount = decided.filter((q) => actionOf(q) === "overturn").length;
  const upheldCount = decided.length - overturnedCount;
  const lines: string[] = [];
  for (const q of decided.slice(0, MAX_NOTE_LINES)) {
    const label = questionLabel(q) || "Question";
    const verb = actionOf(q) === "overturn" ? "Overturned" : "Upheld";
    const reason = judgeReasonText(q.reason ?? q.judgeReason);
    lines.push(reason ? `${label} — ${verb}: ${reason}` : `${label} — ${verb}`);
  }
  if (decided.length > MAX_NOTE_LINES) lines.push(`+${decided.length - MAX_NOTE_LINES} more`);
  const judgeNotes = lines.join("\n").slice(0, MAX_NOTES_CHARS);
  return {
    outcome: appealDirection(overturnedCount, upheldCount),
    overturnedCount,
    upheldCount,
    ...(scores?.before != null ? { scoreBefore: scores.before } : {}),
    ...(scores?.after != null ? { scoreAfter: scores.after } : {}),
    ...(judgeNotes ? { judgeNotes } : {}),
  };
}

function isYes(answer: unknown): boolean {
  return String(answer ?? "").trim().toLowerCase().startsWith("yes");
}

/** Same summary, recovered from a finding the judge already stamped. Used to
 *  back-fill appeals decided before the stamp existed. An overturned question
 *  reads "Yes" today and read "No" before the appeal, so the pre-appeal score
 *  is today's score minus the overturns — the identical math the appeal-detail
 *  modal does. */
export function appealOutcomeFromFinding(
  finding: { answeredQuestions?: Array<Record<string, unknown>> } | null | undefined,
): AppealOutcomeSummary {
  const qs = finding?.answeredQuestions ?? [];
  const judged = qs.filter((q) => q.judgeAction === "overturn" || q.judgeAction === "uphold") as JudgedQuestion[];
  if (qs.length === 0 || judged.length === 0) {
    return { outcome: "unknown", overturnedCount: 0, upheldCount: 0 };
  }
  const overturned = judged.filter((q) => q.judgeAction === "overturn").length;
  const yes = qs.filter((q) => isYes(q.answer)).length;
  const after = Math.round((yes / qs.length) * 100);
  const before = Math.round(((yes - overturned) / qs.length) * 100);
  return summarizeAppealOutcome(judged, { before, after });
}
