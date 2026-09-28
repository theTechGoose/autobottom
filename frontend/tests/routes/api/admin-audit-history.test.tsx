/** Admin audit-history table — the APPEAL column.
 *
 *  The badge used to read "Appeal Complete" with no hover text, which told an
 *  admin nothing about which way the appeal went. These lock in the direction,
 *  the hover notes, and the click-through to the appeal-detail modal. */
import { renderHTML, assertContains, assertNotContains } from "../../helpers/render.ts";
import { assert } from "@std/assert";
import {
  renderAuditHistoryMain,
  renderAuditHistoryDropdowns,
  type AdminAuditData,
  type AdminAuditFilters,
  type AdminAuditItem,
} from "../../../routes/api/admin/audit-history.tsx";

function data(item: Partial<AdminAuditItem>): AdminAuditData {
  return {
    items: [{ findingId: "fid-1", ts: Date.now(), score: 75, ...item }],
    total: 1, pages: 1, page: 1,
    owners: [], departments: [], shifts: [], reviewers: [],
  };
}

function render(item: Partial<AdminAuditItem>): string {
  return renderHTML(renderAuditHistoryMain(data(item), "24h", null));
}

Deno.test("appeal badge — an accepted appeal says so", () => {
  const html = render({ appealStatus: "complete", appealOutcome: "granted", appealOverturned: 2, appealUpheld: 0 });
  assertContains(html, "Appeal Accepted");
  assertNotContains(html, "Appeal Complete");
});

Deno.test("appeal badge — a denied appeal says so", () => {
  const html = render({ appealStatus: "complete", appealOutcome: "denied", appealOverturned: 0, appealUpheld: 3 });
  assertContains(html, "Appeal Denied");
  assertContains(html, "pill-red");
});

Deno.test("appeal badge — a split decision reads as partly accepted", () => {
  const html = render({ appealStatus: "complete", appealOutcome: "partial", appealOverturned: 1, appealUpheld: 1 });
  assertContains(html, "Appeal Partly Accepted");
});

Deno.test("appeal badge — hover text carries the counts, the score move and the judge's reasons", () => {
  const html = render({
    appealStatus: "complete",
    appealOutcome: "partial",
    appealOverturned: 1,
    appealUpheld: 1,
    appealScoreBefore: 75,
    appealScoreAfter: 88,
    appealJudgedBy: "judge@monsterrg.com",
    appealComment: "The guest confirmed the dates twice",
    appealNotes: "Travel Dates — Overturned: Bot error — the bot got it wrong",
  });
  assertContains(html, "1 overturned");
  assertContains(html, "1 upheld");
  assertContains(html, "Score 75% ");
  assertContains(html, "88%");
  assertContains(html, "judge@monsterrg.com");
  assertContains(html, "The guest confirmed the dates twice");
  assertContains(html, "Bot error");
});

Deno.test("appeal badge — a decided appeal opens the detail modal", () => {
  const html = render({ appealStatus: "complete", appealOutcome: "granted" });
  assertContains(html, "/api/manager/appeal?findingId=fid-1");
  assertContains(html, "appeal-detail-content");
});

Deno.test("appeal badge — an appeal with no recoverable direction keeps the old wording", () => {
  const html = render({ appealStatus: "complete", appealOutcome: "unknown" });
  assertContains(html, "Appeal Complete");
});

Deno.test("appeal badge — a pending appeal is still pending, and says what it waits on", () => {
  const html = render({ appealStatus: "pending" });
  assertContains(html, "Appeal Pending");
  assertContains(html, "still waiting on a judge");
});

Deno.test("appeal badge — an un-appealed audit gets no badge at all", () => {
  const html = render({ appealStatus: null });
  assertNotContains(html, "Appeal ");
});

/** The AUDITOR dropdown.
 *
 *  It used to strip the @domain off the option's VALUE as well as its label,
 *  so picking "aknight" submitted `auditor=aknight` while the backend compares
 *  against the full `reviewedBy` email — every row failed the match and the
 *  page went blank. Value stays the email; only the label is shortened. */
function filters(over: Partial<AdminAuditFilters> = {}): AdminAuditFilters {
  return {
    since: "0", until: "1", type: "", owner: "", department: "", shift: "",
    reviewed: "", auditor: "", scoreMin: "0", scoreMax: "100", scoreState: "",
    page: "1", limit: "50", ...over,
  };
}

function auditorDropdown(reviewers: string[], selected = ""): string {
  const d: AdminAuditData = {
    items: [], total: 0, pages: 1, page: 1,
    owners: [], departments: [], shifts: [], reviewers,
  };
  return renderHTML(renderAuditHistoryDropdowns(d, filters({ auditor: selected })).auditor);
}

Deno.test("auditor dropdown — submits the full email, shows the short name", () => {
  const html = auditorDropdown(["aknight@monsterrg.com"]);
  assertContains(html, 'value="aknight@monsterrg.com"');
  assertContains(html, ">aknight<");
  assertNotContains(html, 'value="aknight"');
});

Deno.test("auditor dropdown — the chosen auditor stays chosen after a refresh", () => {
  const html = auditorDropdown(["aknight@monsterrg.com", "zzz@monsterrg.com"], "aknight@monsterrg.com");
  assertContains(html, 'value="aknight@monsterrg.com" selected');
});

Deno.test("auditor dropdown — options are ordered by the name people read", () => {
  const html = auditorDropdown(["zzz@a.com", "aknight@zzzz.com"]);
  assert(html.indexOf(">aknight<") < html.indexOf(">zzz<"));
});
