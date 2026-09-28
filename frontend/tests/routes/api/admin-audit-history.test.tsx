/** Admin audit-history table — the APPEAL column.
 *
 *  The badge used to read "Appeal Complete" with no hover text, which told an
 *  admin nothing about which way the appeal went. These lock in the direction,
 *  the hover notes, and the click-through to the appeal-detail modal. */
import { renderHTML, assertContains, assertNotContains } from "../../helpers/render.ts";
import { assert, assertEquals } from "@std/assert";
import {
  renderAuditHistoryMain,
  renderAuditHistoryDropdowns,
  windowLabelFromFilters,
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
    page: "1", limit: "50", rangeMode: "", ...over,
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

/** REQ-001 — the window label must name the window that was actually queried.
 *
 *  A typed 09/26–09/26 range spans ~24h, so bucketing by span labelled it
 *  "24h" — which reads as "the last 24 hours", a different window entirely. */

/** Eastern-time boundaries of a typed date range. The page's Go button builds
 *  these from `<date>T00:00:00` / `<date>T23:59:59` in the user's own zone. */
const SEP26_START = Date.UTC(2026, 8, 26, 4, 0, 0);       // Sep 26 00:00 EDT
const SEP26_END = Date.UTC(2026, 8, 27, 3, 59, 59);       // Sep 26 23:59:59 EDT
const SEP22_START = Date.UTC(2026, 8, 22, 4, 0, 0);       // Sep 22 00:00 EDT

function label(over: Partial<AdminAuditFilters>): string {
  return windowLabelFromFilters(filters(over));
}

Deno.test("REQ-001 — a one-day custom range names the day, not '24h'", () => {
  assertEquals(
    label({ since: String(SEP26_START), until: String(SEP26_END), rangeMode: "custom" }),
    "Sep 26",
  );
});

Deno.test("REQ-001 — a custom range across days names both ends", () => {
  assertEquals(
    label({ since: String(SEP22_START), until: String(SEP26_END), rangeMode: "custom" }),
    "Sep 22 \u2013 Sep 26",
  );
});

Deno.test("REQ-001 — a preset button keeps its preset name", () => {
  const until = Date.now();
  assertEquals(label({ since: String(until - 24 * 3_600_000), until: String(until) }), "24h");
  assertEquals(label({ since: String(until - 7 * 24 * 3_600_000), until: String(until) }), "7d");
});

Deno.test("REQ-001 — no date filter still reads 'all'", () => {
  assertEquals(label({ since: "0", until: String(Date.now()) }), "all");
});

Deno.test("REQ-001 — the Total card carries whatever label it is given", () => {
  const html = renderHTML(renderAuditHistoryMain(data({}), "Sep 26", null));
  assertContains(html, "Total (Sep 26)");
});

/** REQ-002 — Started / Bot Done / Reviewed are Eastern clock times.
 *
 *  The old single FINISHED column rendered the index row's `completedAt`, and
 *  writeSoleAuditDoneIndex overwrites that with the review time on a reviewed
 *  row — so one column silently meant the reviewer on some rows and the bot on
 *  others. Split it, and print real times instead of "1d ago". */
const STARTED = Date.UTC(2026, 8, 24, 12, 12, 0);   // Sep 24  8:12 AM EDT
const BOT_MS = 95_000;                               // → bot done 8:13 AM EDT
const BOT_DONE_TEXT = "9/24 8:13 AM";
const STARTED_TEXT = "9/24 8:12 AM";
const REVIEW_TS = Date.UTC(2026, 8, 26, 18, 41, 0); // Sep 26  2:41 PM EDT
const REVIEW_TEXT = "9/26 2:41 PM";

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

Deno.test("REQ-002 — the table has a Bot Done and a Reviewed column, not one 'Finished'", () => {
  const html = render({});
  assertContains(html, "<th>Bot Done</th>");
  assertContains(html, "<th>Reviewed</th>");
  assertNotContains(html, "<th>Finished</th>");
});

Deno.test("REQ-002 — a reviewed audit shows the bot's finish and the reviewer's finish apart", () => {
  const html = render({
    startedAt: STARTED,
    durationMs: BOT_MS,
    ts: REVIEW_TS,
    reviewed: true,
    reviewedBy: "aknight@monsterrg.com",
    reason: "reviewed",
  });
  assertContains(html, STARTED_TEXT);
  assertContains(html, BOT_DONE_TEXT);
  assertContains(html, REVIEW_TEXT);
});

Deno.test("REQ-002 — times are clock times, never '1d ago'", () => {
  const html = render({
    startedAt: STARTED,
    durationMs: BOT_MS,
    ts: REVIEW_TS,
    reviewed: true,
    reviewedBy: "aknight@monsterrg.com",
    reason: "reviewed",
  });
  assertNotContains(html, "d ago");
  assertNotContains(html, "h ago");
  assertNotContains(html, "m ago");
});

Deno.test("REQ-002 — hovering a time gives the full date, seconds and zone", () => {
  const html = render({ startedAt: STARTED, durationMs: BOT_MS, ts: REVIEW_TS, reviewed: true, reviewedBy: "a@b.com" });
  assertContains(html, "2026");
  assertContains(html, "EDT");
});

Deno.test("REQ-002 — an audit nobody has reviewed shows no review time", () => {
  const html = render({ startedAt: STARTED, durationMs: BOT_MS, ts: STARTED + BOT_MS, reviewed: false });
  assertContains(html, BOT_DONE_TEXT);
  assertNotContains(html, REVIEW_TEXT);
});

Deno.test("REQ-002 — an audit that never needed review still reads as Auto", () => {
  const html = render({ reason: "perfect_score", startedAt: STARTED, durationMs: BOT_MS, ts: STARTED + BOT_MS });
  assertContains(html, "\u2713 Auto");
  assertNotContains(html, REVIEW_TEXT);
});

Deno.test("REQ-002 — an old row with no duration falls back to its index time for Bot Done", () => {
  const html = render({ ts: STARTED + BOT_MS, reviewed: false });
  assertContains(html, BOT_DONE_TEXT);
});

Deno.test("REQ-002 — a reviewed row with no duration does not pass the review time off as the bot's", () => {
  const html = render({ ts: REVIEW_TS, reviewed: true, reviewedBy: "aknight@monsterrg.com", reason: "reviewed" });
  assertEquals(occurrences(html, REVIEW_TEXT), 1);
});
