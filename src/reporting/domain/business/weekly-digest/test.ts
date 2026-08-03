/** Tests for the weekly digest aggregation + rendering. */
import { assert, assertEquals } from "#assert";
import {
  buildDigest,
  capCategories,
  passPercent,
  renderDigestEmail,
  renderDigestPage,
  shortQuestionLabel,
} from "./mod.ts";
import type { DigestOptions } from "./mod.ts";
import type { ReportRow, SectionResult } from "@reporting/domain/business/email-report-engine/mod.ts";

const OPTS: DigestOptions = {
  title: "IDS Audits",
  weekLabel: "Week of Jul 13 – Jul 19, 2026",
  generatedAt: "Jul 20, 2026, 9:00 AM",
};

const LINKS = {
  recordUrl: (id: string) => `https://qb.example/${id}`,
  findingUrl: (id: string) => `https://autobot.example/audit/report?id=${id}`,
};

function row(over: Partial<ReportRow>): ReportRow {
  return { voName: "Someone", score: 100, shift: "AM", ...over };
}

function section(header: string, rows: ReportRow[]): SectionResult {
  return { header, columns: ["voName", "score"], rows } as SectionResult;
}

Deno.test("passPercent — derived from the fail count so the three numbers reconcile", () => {
  assertEquals(passPercent(2, 28), 93);  // 26 passed of 28
  assertEquals(passPercent(6, 16), 62);  // an exact .5 never rounds the pass rate up
  assertEquals(passPercent(11, 22), 50);
  assertEquals(passPercent(0, 13), 100);
  assertEquals(passPercent(1, 1), 0);
  assertEquals(passPercent(0, 0), 0);    // no audits, no divide-by-zero
});

Deno.test("shortQuestionLabel — shortens known headers, passes anything else through", () => {
  assertEquals(shortQuestionLabel("Correct Days & Nights"), "Travel Dates");
  assertEquals(shortQuestionLabel("9% Service Fee"), "11% Service Fee");
  assertEquals(shortQuestionLabel("Understand Reschedule Process"), "WGS Disclosure");
  assertEquals(shortQuestionLabel("Credit Card Number is Not Read on VO?"), "CC# Read");
  assertEquals(shortQuestionLabel("Guest Name"), "Guest Name");
  assertEquals(shortQuestionLabel("Some Question We Never Renamed"), "Some Question We Never Renamed");
});

Deno.test("capCategories — top five, with Genie Invalid kept and pinned last", () => {
  const cats = [
    { label: "A", count: 6 }, { label: "B", count: 5 }, { label: "C", count: 4 },
    { label: "D", count: 3 }, { label: "E", count: 2 }, { label: "F", count: 1 },
    { label: "Genie Invalid", count: 1, genie: true },
  ];
  const capped = capCategories(cats);
  assertEquals(capped.map((c) => c.label), ["A", "B", "C", "D", "E", "Genie Invalid"]);
});

Deno.test("buildDigest — a member's passed/failed/total always reconcile, genie invalid included in failed", () => {
  const fails = new Map([["f2", ["Taxes"]]]);
  const groups = buildDigest([section("GS MB", [
    row({ findingId: "f1", score: 100 }),
    row({ findingId: "f2", score: 96 }),
    row({ findingId: "f3", score: 100, invalidGenie: true }),
  ])], fails);

  assertEquals(groups.length, 1);
  const m = groups[0].members[0];
  assertEquals(m.total, 3);
  assertEquals(m.failed, 2);            // the 96% and the invalid genie
  assertEquals(m.passed, 1);
  assertEquals(m.genieInvalid, 1);
  assertEquals(m.passed + m.failed, m.total);
  assertEquals(m.passPct, passPercent(2, 3));
  // The invalid genie never graded, so it isn't itemised — but it IS a category line.
  assertEquals(m.failedAuditTotal, 1);
  assertEquals(m.failedAudits.length, 1);
  assertEquals(m.categories.map((c) => c.label), ["Taxes", "Genie Invalid"]);
  assert(m.categories.at(-1)?.genie, "Genie Invalid is flagged so it renders in amber");
});

Deno.test("buildDigest — a failed audit missing from the question index still counts in the denominator", () => {
  // The question-level index only covers June 2026 onward, so some failures have
  // no rows. The itemised list must say "1 of 2", not pretend there was one fail.
  const groups = buildDigest([section("GS MB", [
    row({ findingId: "f1", score: 96 }),
    row({ findingId: "f2", score: 92 }),
  ])], new Map([["f1", ["Taxes"]]]));

  const m = groups[0].members[0];
  assertEquals(m.failed, 2);
  assertEquals(m.failedAuditTotal, 2);
  assertEquals(m.failedAudits.length, 1);

  const page = renderDigestPage(groups, OPTS, LINKS);
  assert(page.includes("itemised (1 of 2)"), "the page owns up to the gap");
});

Deno.test("buildDigest — itemised failures read least-bad first", () => {
  const groups = buildDigest([section("GS MB", [
    row({ findingId: "a", recordId: "100", score: 88 }),
    row({ findingId: "b", recordId: "200", score: 96 }),
    row({ findingId: "c", recordId: "300", score: 92 }),
  ])], new Map([["a", ["Taxes"]], ["b", ["Income"]], ["c", ["Age"]]]));

  assertEquals(groups[0].members[0].failedAudits.map((a) => a.score), [96, 92, 88]);
});

Deno.test("buildDigest — one group per shift once a section spans more than one, in floor order", () => {
  const groups = buildDigest([section("GS MB", [
    row({ findingId: "1", shift: "WFH" }),
    row({ findingId: "2", shift: "Weekend" }),
    row({ findingId: "3", shift: "PM" }),
    row({ findingId: "4", shift: "AM" }),
  ])], new Map());

  assertEquals(groups.map((g) => g.label), ["AM", "PM", "WW", "WFH"]);
});

Deno.test("buildDigest — splitByShift off keeps one group per department, shifts combined", () => {
  const groups = buildDigest([
    section("WST DS", [row({ findingId: "1", shift: "AM" }), row({ findingId: "2", shift: "PM" })]),
    section("WST ACT", [row({ findingId: "3", shift: "AM" }), row({ findingId: "4", shift: "Weekend" })]),
  ], new Map(), false);

  assertEquals(groups.map((g) => g.label), ["WST DS", "WST ACT"]);
  assertEquals(groups.map((g) => g.total), [2, 2]);
});

Deno.test("buildDigest — a single-shift section stays one group named for the department", () => {
  const groups = buildDigest([section("IDS A3N", [
    row({ findingId: "1", shift: "AM" }),
    row({ findingId: "2", shift: "AM" }),
  ])], new Map());

  assertEquals(groups.map((g) => g.label), ["IDS A3N"]);
  assertEquals(groups[0].total, 2);
});

Deno.test("buildDigest — rows with no shift land in their own group, last", () => {
  const groups = buildDigest([section("GS MB", [
    row({ findingId: "1", shift: "AM" }),
    row({ findingId: "2", shift: "" }),
  ])], new Map());

  assertEquals(groups.map((g) => g.label), ["AM", "Unassigned"]);
});

Deno.test("buildDigest — a multi-department report prefixes shift groups with the department", () => {
  const groups = buildDigest([
    section("GS MB", [row({ findingId: "1", shift: "AM" }), row({ findingId: "2", shift: "PM" })]),
    section("VO MB", [row({ findingId: "3", shift: "AM" })]),
  ], new Map());

  assertEquals(groups.map((g) => g.label), ["GS MB — AM", "GS MB — PM", "VO MB"]);
});

Deno.test("buildDigest — empty sections are dropped, and members sort by VOs completed", () => {
  const groups = buildDigest([
    section("GS MB", [
      row({ findingId: "1", voName: "Anthony Santiago" }),
      row({ findingId: "2", voName: "Garrey Sumter" }),
      row({ findingId: "3", voName: "Garrey Sumter" }),
    ]),
    section("VO MB", []),
  ], new Map());

  assertEquals(groups.length, 1);
  assertEquals(groups[0].members.map((m) => m.name), ["Garrey Sumter", "Anthony Santiago"]);
  assertEquals(groups[0].label, "GS MB", "one populated section means no shift prefix");
});

Deno.test("buildDigest — a blank VO name is bucketed as Other", () => {
  const groups = buildDigest([section("GS MB", [row({ findingId: "1", voName: "", score: 0 })])], new Map());
  assertEquals(groups[0].members[0].name, "Other");
});

Deno.test("buildDigest — the group card totals the whole shift, not just one member", () => {
  const groups = buildDigest([section("GS MB", [
    row({ findingId: "1", voName: "A", score: 100 }),
    row({ findingId: "2", voName: "A", score: 96 }),
    row({ findingId: "3", voName: "B", score: 96 }),
    row({ findingId: "4", voName: "B", score: 100 }),
  ])], new Map([["2", ["Taxes"]], ["3", ["Taxes"]]]));

  const g = groups[0];
  assertEquals(g.total, 4);
  assertEquals(g.failed, 2);
  assertEquals(g.passed, 2);
  assertEquals(g.passPct, 50);
  assertEquals(g.failPct, 50);
  assertEquals(g.categories, [{ label: "Taxes", count: 2 }], "member counts roll up into the group");
});

Deno.test("renderDigestEmail — flat cards, no <details>, and the numbers on the card", () => {
  const groups = buildDigest([section("GS MB", [
    row({ findingId: "1", voName: "Garrey Sumter", score: 100 }),
    row({ findingId: "2", voName: "Garrey Sumter", score: 96 }),
  ])], new Map([["2", ["Taxes"]]]));

  const html = renderDigestEmail(groups, OPTS);
  assert(!html.includes("<details"), "email clients don't get an expander");
  assert(html.includes("Garrey Sumter"));
  assert(html.includes("50%"), "pass rate on the card");
  assert(html.includes("VOs Completed"));
  assert(html.includes("Categories Failed"));
  assert(html.includes("Week of Jul 13 – Jul 19, 2026"));
});

Deno.test("renderDigestEmail — a clean week says None rather than an empty list", () => {
  const groups = buildDigest([section("GS MB", [row({ findingId: "1", score: 100 })])], new Map());
  const html = renderDigestEmail(groups, OPTS);
  assert(html.includes(">None<"));
});

Deno.test("a group with no fails drops the 'Highest Number of Fails' heading entirely", () => {
  const groups = buildDigest([section("ODR", [
    row({ findingId: "1", voName: "Rodger Gamble", score: 100 }),
    row({ findingId: "2", voName: "Mariah Brown", score: 100 }),
  ])], new Map());

  for (const html of [renderDigestEmail(groups, OPTS), renderDigestPage(groups, OPTS, LINKS)]) {
    assert(!html.includes("Highest Number of Fails"), "no heading with nothing under it");
    assert(html.includes("No failed audits this week."));
  }
});

Deno.test("fails with no question detail say so instead of showing an empty list or 'None'", () => {
  // The audit failed, but the question-level index has no rows for it.
  const groups = buildDigest([section("GS MB", [
    row({ findingId: "f1", voName: "Kory Wieners", score: 96 }),
    row({ findingId: "f2", voName: "Kory Wieners", score: 100 }),
  ])], new Map());

  const email = renderDigestEmail(groups, OPTS);
  assert(email.includes("Not recorded"), "the card admits the detail is missing");
  assert(!email.includes(">None<"), "'None' next to a fail count would be a contradiction");
  assert(email.includes("Failures recorded, but no question detail is available for them."));

  const page = renderDigestPage(groups, OPTS, LINKS);
  assert(page.includes("no question detail is available"));
  assert(!page.includes("Highest Number of Fails"));
});

Deno.test("renderDigestEmail — trimming keeps every group's summary and says what it held back", () => {
  const rows = Array.from({ length: 5 }, (_, i) => row({ findingId: `f${i}`, voName: `TM ${i}`, score: 100 }));
  const groups = buildDigest([section("GS MB", rows)], new Map());

  const html = renderDigestEmail(groups, OPTS, 2);
  assert(html.includes("Results:"), "the group summary survives the trim");
  assert(html.includes("+ 3 more team members in the full report."));
  assertEquals(html.includes("TM 4"), false, "the tail moved to the full report");
});

Deno.test("renderDigestPage — expandable per member, with links out to the record and the audit", () => {
  const groups = buildDigest([section("GS MB", [
    row({ findingId: "f1", recordId: "490811", voName: "Garrey Sumter", score: 96 }),
  ])], new Map([["f1", ["Guest Name"]]]));

  const html = renderDigestPage(groups, OPTS, LINKS);
  assert(html.includes("<details"), "the page collapses each team member");
  assert(html.includes('id="tm-garrey-sumter"'));
  assert(html.includes("https://qb.example/490811"), "record id links to QuickBase");
  assert(html.includes("audit/report?id=f1"), "finding id links to the audit report");
  assert(html.includes("Failed Audits (1)"));
  assert(html.includes("click a name to expand"));
});

Deno.test("failed audits list — shows BOTH the record id and the finding id, each linked to its own system", () => {
  const groups = buildDigest([section("GS MB", [
    row({ findingId: "khswSh2OhOFJ1sfJL3a8P", recordId: "496508", voName: "Ashley Wilson", score: 96 }),
  ])], new Map([["khswSh2OhOFJ1sfJL3a8P", ["Taxes"]]]));

  const html = renderDigestPage(groups, OPTS, LINKS);
  assert(html.includes(">496508</a>"), "record id is shown");
  assert(html.includes(">khswSh2OhOFJ1sfJL3a8P</a>"), "finding id is shown, not just linked behind the score");
  assert(html.includes("https://qb.example/496508"), "record id → QuickBase");
  assert(html.includes("audit/report?id=khswSh2OhOFJ1sfJL3a8P"), "finding id → the audit report");
  // Two id columns are unreadable unlabelled.
  assert(html.includes("Record ID") && html.includes("Audit ID"), "columns are labelled");
  assert(html.includes(">96%<"), "score still shown");
});

Deno.test("failed audits list — a missing id renders a dash, not a broken link", () => {
  const groups = buildDigest([section("GS MB", [
    row({ findingId: "f1", recordId: undefined, voName: "X", score: 92 }),
  ])], new Map([["f1", ["Age"]]]));
  const html = renderDigestPage(groups, OPTS, LINKS);
  assert(html.includes("&mdash;"), "blank record id shows a dash");
  assert(html.includes("audit/report?id=f1"), "the finding id is still linked");
});

Deno.test("renderDigest — a name with HTML in it is escaped, not rendered", () => {
  const groups = buildDigest([section("GS MB", [row({ findingId: "1", voName: "<script>x</script>" })])], new Map());
  for (const html of [renderDigestEmail(groups, OPTS), renderDigestPage(groups, OPTS, LINKS)]) {
    assert(!html.includes("<script>x</script>"));
    assert(html.includes("&lt;script&gt;"));
  }
});

Deno.test("renderDigest — an empty report still renders, saying so", () => {
  assert(renderDigestEmail([], OPTS).includes("No audits completed in this window."));
  assert(renderDigestPage([], OPTS, LINKS).includes("No audits completed in this window."));
});
