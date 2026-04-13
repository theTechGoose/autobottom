/** Scoring engine: score calculation, bonus point flips.
 *  Pure functions — no KV or external dependencies. */

export interface ScoringQuestion {
  answer: string;
  egregious?: boolean;
  weight?: number;
  bonusFlipped?: boolean;
  header?: string;
}

export interface BonusFlipResult {
  flipped: number;
  remaining: number;
  questions: ScoringQuestion[];
}

/**
 * Apply bonus point flips to eligible "No" answers.
 * Egregious questions are immune. Consumes from budget by weight.
 */
export function applyBonusFlips(questions: ScoringQuestion[], budget: number): BonusFlipResult {
  if (budget <= 0) return { flipped: 0, remaining: budget, questions };

  let remaining = budget;
  let flipped = 0;
  const result = questions.map((q) => {
    if (q.answer !== "No") return q;
    if (q.egregious) return q;
    const weight = q.weight ?? 5;
    if (remaining >= weight) {
      remaining -= weight;
      flipped++;
      return { ...q, answer: "Yes", bonusFlipped: true };
    }
    return q;
  });

  return { flipped, remaining, questions: result };
}

/**
 * Calculate audit score as percentage of "Yes" answers.
 * Returns 0 for invalid audits, undefined for empty question sets.
 */
export function calculateScore(questions: ScoringQuestion[], isInvalid = false): number | undefined {
  if (isInvalid) return 0;
  if (!questions.length) return undefined;
  const yes = questions.filter((q) => q.answer === "Yes").length;
  return Math.round((yes / questions.length) * 100);
}

/**
 * Determine the auto-complete reason for an audit that doesn't need review.
 * Returns undefined if the audit should go to review queue.
 */
export function getAutoCompleteReason(
  score: number | undefined,
  isInvalid: boolean,
): "perfect_score" | "invalid_genie" | undefined {
  if (isInvalid) return "invalid_genie";
  if (score === 100) return "perfect_score";
  return undefined;
}
