/** Appeal-detail modal fragment — everything renders off one finding read.
 *
 *  Both live shapes of `judgeReason` are covered: the overturn picker's codes
 *  and the free text a judge types when upholding. */
import { renderHTML, assertContains, assertNotContains } from "../../helpers/render.ts";
import { renderAppealDetail } from "../../../routes/api/manager/appeal.tsx";
import { renderAuditHistoryTable } from "../../../routes/api/manager/audit-history.tsx";

const UPHELD_REASON =
  "The timeframe disclosure for the confirmation letter ('48 hours') was not stated during the call.";

function finding(over: Record<string, unknown> = {}) {
  return {
    findingId: "fid-appeal",
    owner: "someone@monsterrg.com",
    record: { VoName: "ODR MB - Destiny Peterson", RecordId: "998" },
    answeredQuestions: [
      { header: "Guest Name", answer: "Yes" },
      {
        header: "Confirmation Expectations", answer: "No",
        judgeAction: "uphold", judgedBy: "judge@monsterrg.com", judgeReason: UPHELD_REASON,
      },
      {
        header: "9% Service Fee", answer: "Yes",
        judgeAction: "overturn", judgedBy: "judge@monsterrg.com", judgeReason: "error",
      },
      { header: "Taxes", answer: "Yes" },
    ],
    ...over,
  };
}

Deno.test("appeal modal — lists each judged question with its verdict", () => {
  const html = renderHTML(renderAppealDetail(finding(), "fid-appeal"));
  assertContains(html, "Overturned");
  assertContains(html, "Upheld");
  assertContains(html, "1</strong> overturned");
  assertContains(html, "1</strong> upheld");
  // Questions nobody appealed stay out of the modal.
  assertNotContains(html, "Taxes");
});

Deno.test("appeal modal — shows the judge's typed reason verbatim", () => {
  const html = renderHTML(renderAppealDetail(finding(), "fid-appeal"));
  assertContains(html, "48 hours");
  assertContains(html, "was not stated during the call");
});

Deno.test("appeal modal — spells out the overturn picker's codes", () => {
  const html = renderHTML(renderAppealDetail(finding(), "fid-appeal"));
  assertContains(html, "Bot error");
  assertNotContains(html, ">error<");
});

Deno.test("appeal modal — questions carry their display name, not the raw header", () => {
  const html = renderHTML(renderAppealDetail(finding(), "fid-appeal"));
  assertContains(html, "11% Service Fee");
  assertNotContains(html, "9% Service Fee");
});

Deno.test("appeal modal — score reads before → after when a flip moved it", () => {
  // 3 of 4 answer Yes = 75% now; the overturn is what made the third a Yes,
  // so it was 50% before the appeal.
  const html = renderHTML(renderAppealDetail(finding(), "fid-appeal"));
  assertContains(html, "50%");
  assertContains(html, "75%");
});

Deno.test("appeal modal — an all-upheld appeal says the score is unchanged", () => {
  const html = renderHTML(renderAppealDetail(finding({
    answeredQuestions: [
      { header: "Guest Name", answer: "Yes" },
      { header: "Taxes", answer: "No", judgeAction: "uphold", judgedBy: "j@x.com", judgeReason: "Stands." },
    ],
  }), "fid-appeal"));
  assertContains(html, "unchanged");
  assertContains(html, "1</strong> upheld");
});

Deno.test("appeal modal — the team member's appeal comment renders when present", () => {
  const html = renderHTML(renderAppealDetail(
    finding({ appealComment: "I did say the fee, at 4:12." }),
    "fid-appeal",
  ));
  assertContains(html, "What the team member said");
  assertContains(html, "I did say the fee, at 4:12.");
});

Deno.test("appeal modal — no comment means no comment block", () => {
  const html = renderHTML(renderAppealDetail(finding(), "fid-appeal"));
  assertNotContains(html, "What the team member said");
});

Deno.test("appeal modal — older appeals with no reason say so instead of rendering blank", () => {
  const html = renderHTML(renderAppealDetail(finding({
    answeredQuestions: [
      { header: "Taxes", answer: "No", judgeAction: "uphold", judgedBy: "j@x.com" },
    ],
  }), "fid-appeal"));
  assertContains(html, "No reason recorded");
});

Deno.test("appeal modal — a finding with no judge decisions says so", () => {
  const html = renderHTML(renderAppealDetail(finding({
    answeredQuestions: [{ header: "Taxes", answer: "No" }],
  }), "fid-appeal"));
  assertContains(html, "No judge decisions are recorded");
});

Deno.test("appeal modal — links out to the full report", () => {
  const html = renderHTML(renderAppealDetail(finding(), "fid-appeal"));
  assertContains(html, "/audit/report?id=fid-appeal");
});

// ── The trigger in the table ────────────────────────────────────────────────

function row(appealStatus: string | null) {
  return {
    items: [{ findingId: "fid-row", ts: Date.now(), score: 96, appealStatus }],
    total: 1, pages: 1, page: 1, owners: [], shifts: [], departments: [],
  };
}

Deno.test("audit history — a COMPLETE appeal is a button that opens the modal", () => {
  const html = renderHTML(renderAuditHistoryTable(row("complete")));
  assertContains(html, "/api/manager/appeal?findingId=fid-row");
  assertContains(html, "appeal-detail-content");
  assertContains(html, "appeal-detail-modal");
});

Deno.test("audit history — a PENDING appeal stays a plain pill, nothing to open yet", () => {
  const html = renderHTML(renderAuditHistoryTable(row("pending")));
  assertContains(html, "Pending");
  assertNotContains(html, "/api/manager/appeal");
});

Deno.test("audit history — no appeal renders a dash, not a button", () => {
  const html = renderHTML(renderAuditHistoryTable(row(null)));
  assertNotContains(html, "/api/manager/appeal");
});
