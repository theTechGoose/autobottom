import { renderHTML, assertContains, assertNotContains } from "../helpers/render.ts";
import { assert, assertEquals } from "@std/assert";
import { VerdictPanel, computeIsLastForAudit } from "../../components/VerdictPanel.tsx";
import type { ReviewItem } from "../../components/VerdictPanel.tsx";

const MOCK_ITEM: ReviewItem = {
  findingId: "abc12345-6789", questionIndex: 0, header: "Greeting Check",
  question: "Was the greeting appropriate?", answer: "no",
  thinking: "The agent did not greet...", defense: "However the call was short...",
  snippet: "[AGENT]: Hello\\n[CUSTOMER]: Hi there",
};

const MOCK_YES_ITEM: ReviewItem = { ...MOCK_ITEM, answer: "yes" };

const MOCK_APPEAL_ITEM: ReviewItem = {
  ...MOCK_ITEM, appealType: "full", appealComment: "I disagree with the finding",
};

// Production callers (review/judge/* routes) always supply buffer + currentIndex,
// so the tests do too — keeps the contract honest.
const EMPTY_BUFFER: ReviewItem[] = [];

Deno.test("VerdictPanel — null item renders review empty state", () => {
  const html = renderHTML(<VerdictPanel item={null} buffer={EMPTY_BUFFER} currentIndex={0} mode="review" remaining={0} email="a@b.com" combo={0} />);
  assertContains(html, "No items pending review");
});

Deno.test("VerdictPanel — null item renders judge empty state", () => {
  const html = renderHTML(<VerdictPanel item={null} buffer={EMPTY_BUFFER} currentIndex={0} mode="judge" remaining={0} email="a@b.com" combo={0} />);
  assertContains(html, "No items pending judge review");
});

// In review mode the badge is always "BOT ANSWERED NO" (badge-no), regardless
// of the AI's actual answer — review only sees No-verdicts. badge-yes is a
// judge-only state, so this test exercises judge mode with a yes-answer item.
Deno.test("VerdictPanel — judge mode + yes answer shows badge-yes", () => {
  const html = renderHTML(<VerdictPanel item={MOCK_YES_ITEM} buffer={[MOCK_YES_ITEM]} currentIndex={0} mode="judge" remaining={5} email="a@b.com" combo={0} />);
  assertContains(html, "badge-yes");
});

Deno.test("VerdictPanel — judge Uphold is a reason-modal trigger, not a direct decide", () => {
  const html = renderHTML(<VerdictPanel item={MOCK_ITEM} buffer={[MOCK_ITEM]} currentIndex={0} mode="judge" remaining={5} email="a@b.com" combo={0} />);
  // Uphold opens the JudgeModals reason prompt (data-action), carrying the
  // question name so the modal can say "...why they failed the X question".
  assertContains(html, 'data-action="judge-uphold"');
  assertContains(html, 'data-question-name="Greeting Check"');
  // It must NOT post the uphold decision directly (that path skipped the reason).
  assertNotContains(html, '"decision":"uphold"');
});

Deno.test("VerdictPanel — answer no shows badge-no", () => {
  const html = renderHTML(<VerdictPanel item={MOCK_ITEM} buffer={[MOCK_ITEM]} currentIndex={0} mode="review" remaining={5} email="a@b.com" combo={0} />);
  assertContains(html, "badge-no");
});

// auditRemaining comes from item.auditRemaining (or buffer length), not the
// `remaining` prop, which is consumed elsewhere by the page shell.
Deno.test("VerdictPanel — remaining count displayed", () => {
  const item = { ...MOCK_ITEM, auditRemaining: 15 };
  const html = renderHTML(<VerdictPanel item={item} buffer={[item]} currentIndex={0} mode="review" remaining={15} email="a@b.com" combo={0} />);
  assertContains(html, "15 remaining");
});

// Judge mode with the dashboard stats supplied shows the global "questions /
// audits" split instead of per-audit remaining (mirrors the Judge Dashboard's
// "Appeals Pending" card).
Deno.test("VerdictPanel — judge mode shows questions / audits split when stats supplied", () => {
  const item = { ...MOCK_ITEM, auditRemaining: 1 };
  const html = renderHTML(<VerdictPanel item={item} buffer={[item]} currentIndex={0} mode="judge" remaining={0} email="a@b.com" combo={0} pendingQuestions={14} pendingAudits={10} />);
  assertContains(html, "14 / 10");
  assertContains(html, "questions / audits");
  assertNotContains(html, "1 remaining");
});

// The header guard is `pendingQuestions !== undefined && pendingAudits !== undefined`
// (an AND). Supplying only one — e.g. a stats outage that nulled one field, or a
// regression that weakened the && to a || — must fall back to per-audit remaining.
Deno.test("VerdictPanel — judge mode with only pendingQuestions falls back to remaining", () => {
  const item = { ...MOCK_ITEM, auditRemaining: 1 };
  const html = renderHTML(<VerdictPanel item={item} buffer={[item]} currentIndex={0} mode="judge" remaining={0} email="a@b.com" combo={0} pendingQuestions={14} />);
  assertContains(html, "1 remaining");
  assertNotContains(html, "questions / audits");
});

Deno.test("VerdictPanel — judge mode with only pendingAudits falls back to remaining", () => {
  const item = { ...MOCK_ITEM, auditRemaining: 1 };
  const html = renderHTML(<VerdictPanel item={item} buffer={[item]} currentIndex={0} mode="judge" remaining={0} email="a@b.com" combo={0} pendingAudits={10} />);
  assertContains(html, "1 remaining");
  assertNotContains(html, "questions / audits");
});

// Review mode ignores the stats props — it always shows per-audit remaining.
Deno.test("VerdictPanel — review mode ignores questions/audits stats", () => {
  const item = { ...MOCK_ITEM, auditRemaining: 7 };
  const html = renderHTML(<VerdictPanel item={item} buffer={[item]} currentIndex={0} mode="review" remaining={0} email="a@b.com" combo={0} pendingQuestions={14} pendingAudits={10} />);
  assertContains(html, "7 remaining");
  assertNotContains(html, "questions / audits");
});

Deno.test("VerdictPanel — combo > 1 shows indicator", () => {
  const html = renderHTML(<VerdictPanel item={MOCK_ITEM} buffer={[MOCK_ITEM]} currentIndex={0} mode="review" remaining={5} email="a@b.com" combo={3} />);
  // Component renders combo with U+00D7 multiplication sign, not ASCII "x".
  assertContains(html, "3× combo");
});

Deno.test("VerdictPanel — combo <= 1 hides indicator", () => {
  const html = renderHTML(<VerdictPanel item={MOCK_ITEM} buffer={[MOCK_ITEM]} currentIndex={0} mode="review" remaining={5} email="a@b.com" combo={1} />);
  assertNotContains(html, "combo");
});

Deno.test("VerdictPanel — review mode shows Confirm + Flip buttons", () => {
  const html = renderHTML(<VerdictPanel item={MOCK_ITEM} buffer={[MOCK_ITEM]} currentIndex={0} mode="review" remaining={5} email="a@b.com" combo={0} />);
  assertContains(html, "Confirm");
  assertContains(html, "Flip");
  assertNotContains(html, "Uphold");
});

Deno.test("VerdictPanel — judge mode shows Uphold + overturn reasons", () => {
  const html = renderHTML(<VerdictPanel item={MOCK_ITEM} buffer={[MOCK_ITEM]} currentIndex={0} mode="judge" remaining={5} email="a@b.com" combo={0} />);
  assertContains(html, "Uphold");
  assertContains(html, "error");
  assertContains(html, "logic");
  assertContains(html, "fragment");
  assertContains(html, "transcript");
  assertNotContains(html, "Confirm");
});

Deno.test("VerdictPanel — judge mode shows appeal info when present", () => {
  const html = renderHTML(<VerdictPanel item={MOCK_APPEAL_ITEM} buffer={[MOCK_APPEAL_ITEM]} currentIndex={0} mode="judge" remaining={5} email="a@b.com" combo={0} />);
  assertContains(html, "full");
  assertContains(html, "I disagree with the finding");
});

// ── Fix B: isLastForAudit derives from decisions + full buffer, not the counter ──
// The "final question" deferred-commit path (verdict-final-answer-btn) pops the
// type-YES finalize modal. It must fire ONLY when every other failed question is
// already decided. Clicking a Failed-Questions pill to re-grade an EARLIER
// question (with a later one still undecided) must NOT trigger it — that was the
// premature-finalize / dropped-flip bug.
const Q = (i: number, extra: Partial<ReviewItem> = {}): ReviewItem => ({
  findingId: "fid-b", questionIndex: i, header: `Q${i}`, answer: "no",
  thinking: "t", defense: "d", ...extra,
});
const BUF3 = [Q(0), Q(1), Q(2)];
const DEC_2 = { "0": "flip", "1": "flip" } as Record<string, "confirm" | "flip">;

Deno.test("VerdictPanel — back on an already-decided question with one still undecided → normal decide buttons (no premature finalize)", () => {
  // q0 + q1 decided, q2 still undecided, viewing q0 (clicked back to re-grade).
  const html = renderHTML(<VerdictPanel item={BUF3[0]} buffer={BUF3} currentIndex={0} mode="review" remaining={1} email="a@b.com" combo={0} decisions={DEC_2} />);
  assertContains(html, 'hx-post="/api/review/decide"');
  assertNotContains(html, "verdict-final-answer-btn");
});

Deno.test("VerdictPanel — on the genuinely last undecided question → deferred final-answer buttons", () => {
  // q0 + q1 decided, viewing q2 (the only undecided one).
  const html = renderHTML(<VerdictPanel item={BUF3[2]} buffer={BUF3} currentIndex={2} mode="review" remaining={1} email="a@b.com" combo={0} decisions={DEC_2} />);
  assertContains(html, "verdict-final-answer-btn");
  assertNotContains(html, 'hx-post="/api/review/decide"');
});

Deno.test("VerdictPanel — single-question audit → deferred final-answer buttons", () => {
  const only = Q(0);
  const html = renderHTML(<VerdictPanel item={only} buffer={[only]} currentIndex={0} mode="review" remaining={1} email="a@b.com" combo={0} decisions={{}} />);
  assertContains(html, "verdict-final-answer-btn");
});

// The CRITICAL Fix B guard: jumpToQuestion (review-queue/mod.ts) sets the jumped
// item's auditRemaining to the stale-LOW audit-pending counter. The OLD code
// (isLastForAudit = auditRemaining <= 1) then popped the finalize modal on an
// EARLIER question while a later one was still undecided — the dropped-flip bug.
// This input renders verdict-final-answer-btn under the old component and normal
// decide buttons under the fixed one, so it genuinely fails pre-fix. (The other
// Fix B tests above don't set auditRemaining, so they coincidentally pass both.)
Deno.test("VerdictPanel — stale-low item.auditRemaining must NOT prematurely finalize (Fix B regression guard)", () => {
  const stale = [
    Q(0, { auditRemaining: 1, totalForFinding: 3 }),
    Q(1, { auditRemaining: 1, totalForFinding: 3 }),
    Q(2, { auditRemaining: 1, totalForFinding: 3 }),
  ];
  // Viewing q0 (clicked back to re-grade) with q0+q1 decided but q2 still open.
  const html = renderHTML(<VerdictPanel item={stale[0]} buffer={stale} currentIndex={0} mode="review" remaining={1} email="a@b.com" combo={0} decisions={DEC_2} />);
  assertContains(html, 'hx-post="/api/review/decide"');
  assertNotContains(html, "verdict-final-answer-btn");
});

// ── Item 1a: judge reviewer chip is explicit when reviewedBy is unknown ──────
Deno.test("VerdictPanel — judge mode shows reviewer email when reviewedBy is set", () => {
  const item = { ...MOCK_ITEM, reviewedBy: "josh@monsterrg.com" };
  const html = renderHTML(<VerdictPanel item={item} buffer={[item]} currentIndex={0} mode="judge" remaining={1} email="a@b.com" combo={0} />);
  assertContains(html, "josh@monsterrg.com");
  assertNotContains(html, "not recorded");
});

Deno.test("VerdictPanel — judge mode shows 'not recorded' when reviewedBy is absent", () => {
  const html = renderHTML(<VerdictPanel item={MOCK_ITEM} buffer={[MOCK_ITEM]} currentIndex={0} mode="judge" remaining={1} email="a@b.com" combo={0} />);
  assertContains(html, "Reviewer");
  assertContains(html, "not recorded");
});

Deno.test("VerdictPanel — review mode never shows the reviewer chip", () => {
  const html = renderHTML(<VerdictPanel item={MOCK_ITEM} buffer={[MOCK_ITEM]} currentIndex={0} mode="review" remaining={1} email="a@b.com" combo={0} />);
  assertNotContains(html, "not recorded");
});

// ── computeIsLastForAudit — the finalize-gating logic, tested directly ───────
Deno.test("computeIsLastForAudit — review: not last while another question is undecided", () => {
  assertEquals(computeIsLastForAudit({ isReview: true, buffer: BUF3, item: BUF3[0], decisions: DEC_2, auditRemaining: 99 }), false);
});

Deno.test("computeIsLastForAudit — review: last when every other question is decided", () => {
  assertEquals(computeIsLastForAudit({ isReview: true, buffer: BUF3, item: BUF3[2], decisions: DEC_2, auditRemaining: 99 }), true);
});

Deno.test("computeIsLastForAudit — review: ignores stale-low auditRemaining (the jump-back vector)", () => {
  // auditRemaining=1 would make the OLD counter heuristic say "last" — must not here.
  assert(!computeIsLastForAudit({ isReview: true, buffer: BUF3, item: BUF3[0], decisions: DEC_2, auditRemaining: 1 }));
});

Deno.test("computeIsLastForAudit — review: single-question audit is last", () => {
  const only = [Q(0)];
  assertEquals(computeIsLastForAudit({ isReview: true, buffer: only, item: only[0], decisions: {}, auditRemaining: 1 }), true);
});

Deno.test("computeIsLastForAudit — review: missing decisions on a multi-question buffer falls back to NOT last", () => {
  // The safe fallback: with no decisions map, a multi-question audit never claims
  // "last" client-side — finalize is left to the server auditComplete backstop.
  assertEquals(computeIsLastForAudit({ isReview: true, buffer: BUF3, item: BUF3[0], decisions: undefined, auditRemaining: 1 }), false);
});

Deno.test("computeIsLastForAudit — judge: keeps the counter heuristic (auditRemaining <= 1)", () => {
  assertEquals(computeIsLastForAudit({ isReview: false, buffer: BUF3, item: BUF3[0], decisions: undefined, auditRemaining: 1 }), true);
  assertEquals(computeIsLastForAudit({ isReview: false, buffer: BUF3, item: BUF3[0], decisions: undefined, auditRemaining: 2 }), false);
});
