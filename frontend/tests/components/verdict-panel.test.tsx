import { renderHTML, assertContains, assertNotContains } from "../helpers/render.ts";
import { VerdictPanel } from "../../components/VerdictPanel.tsx";
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
