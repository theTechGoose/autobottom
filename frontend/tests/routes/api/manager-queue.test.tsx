/** Tests for the Manager Portal queue table renderer.
 *
 *  Regression guard for the field-mapping bug: the queue fragment must read
 *  the backend `ManagerQueueItem` shape (`owner` + `failedCount`/
 *  `totalQuestions`), NOT the never-populated `agentEmail`/`score` it used to
 *  reference — those rendered as em-dashes for every row. */
import { assert, assertEquals } from "@std/assert";
import { renderHTML, assertContains, assertNotContains } from "../../helpers/render.ts";
import {
  renderQueueTable, renderQueueResults, renderCompletedResults, queueTimestamp, queueFacets,
  renderMemberButtons,
  filterAndSortQueue, filterCompleted, readQueueFilterParams, type QueueItem,
} from "../../../routes/api/manager/queue.tsx";

function item(over: Partial<QueueItem> = {}): QueueItem {
  return { findingId: "abc12345xyz", owner: "agent@team.com", status: "pending", totalQuestions: 10, failedCount: 2, ...over };
}

Deno.test("ManagerQueue — empty state renders 'No items in queue'", () => {
  const html = renderHTML(renderQueueTable([]));
  assertContains(html, "No items in queue");
});

Deno.test("ManagerQueue — column headers render", () => {
  const html = renderHTML(renderQueueTable([]));
  for (const header of ["Finding", "Team Member", "Dept / Shift", "Failed Questions", "Score", "Status", "Action"]) assertContains(html, header);
});

Deno.test("ManagerQueue — department and shift render, dash when unstamped", () => {
  const stamped = renderHTML(renderQueueTable([item({ department: "VBA", shift: "PM" })]));
  assertContains(stamped, "VBA · PM");
  const unstamped = renderHTML(renderQueueTable([item({})]));
  assertContains(unstamped, "—");
});

Deno.test("ManagerQueue — team member shows voName when present", () => {
  const html = renderHTML(renderQueueTable([item({ owner: "api", voName: "Jane Doe" })]));
  assertContains(html, "Jane Doe");
});

Deno.test("ManagerQueue — falls back to owner email local-part when voName missing", () => {
  const html = renderHTML(renderQueueTable([item({ owner: "jane@team.com" })]));
  assertContains(html, "jane");
});

Deno.test("ManagerQueue — 'api' owner with no voName renders an em-dash, never 'api'", () => {
  const html = renderHTML(renderQueueTable([item({ owner: "api" })]));
  assertNotContains(html, ">api<");
});

Deno.test("ManagerQueue — sale tags render for WGS/MCC items, dash otherwise", () => {
  const tagged = renderHTML(renderQueueTable([item({ wgs: true, mcc: true })]));
  assertContains(tagged, ">WGS<");
  assertContains(tagged, ">MCC<");
  const untagged = renderHTML(renderQueueTable([item({})]));
  assertNotContains(untagged, ">WGS<");
  assertNotContains(untagged, ">MCC<");
});

Deno.test("ManagerQueue — failed questions list shows first two + more-count", () => {
  const html = renderHTML(renderQueueTable([item({
    failedCount: 3, failedQuestions: ["Q one", "Q two", "Q three"],
  })]));
  assertContains(html, "Q one");
  assertContains(html, "Q two");
  assertNotContains(html, "Q three");
  assertContains(html, "+1 more");
});

Deno.test("ManagerQueue — score derived from failed/total", () => {
  // 2 of 10 failed → 80% pass rate
  const html = renderHTML(renderQueueTable([item({ totalQuestions: 10, failedCount: 2 })]));
  assertContains(html, "80%");
});

Deno.test("ManagerQueue — full pass renders 100% green pill", () => {
  // 0 of 10 failed → 100% → pillColor >=90 → green (distinct <td> from the
  // Status-column green that the remediated test covers).
  const html = renderHTML(renderQueueTable([item({ totalQuestions: 10, failedCount: 0 })]));
  assertContains(html, "100%");
  assertContains(html, "pill-green");
});

Deno.test("ManagerQueue — low pass-rate lands in red band", () => {
  // 9 of 10 failed → 10% → pillColor <70 → red. Pins the score→color mapping
  // so a future reshuffle of pillColor's 90/70 thresholds is caught.
  const html = renderHTML(renderQueueTable([item({ totalQuestions: 10, failedCount: 9 })]));
  assertContains(html, "10%");
  assertContains(html, "pill-red");
});

Deno.test("ManagerQueue — score clamps when failed exceeds total", () => {
  // Defensive: 11 of 10 would compute -10% without the clamp.
  const html = renderHTML(renderQueueTable([item({ totalQuestions: 10, failedCount: 11 })]));
  assertContains(html, "0%");
  assertNotContains(html, "-10%");
});

Deno.test("ManagerQueue — falls back to 'N failed' when total unknown", () => {
  const html = renderHTML(renderQueueTable([item({ totalQuestions: undefined, failedCount: 3 })]));
  assertContains(html, "3 failed");
  assertNotContains(html, "%");
});

Deno.test("ManagerQueue — row opens the remediation page, button still opens the modal", () => {
  // The row used to hx-get a finding-detail modal. Commit 2cb7ef98 replaced
  // that with a full-page click-to-scrub view at /manager/remediate/<id>; the
  // per-row Remediate button still drives the modal.
  const html = renderHTML(renderQueueTable([item({ findingId: "fid-001" })]));
  assertContains(html, `data-finding-id="fid-001"`);
  assertContains(html, "location.href='/manager/remediate/'");
  assertContains(html, "remediate-modal");
  assertContains(html, "rem-findingId");
  // The old modal fragment is gone — if it comes back, it needs its own test.
  assertNotContains(html, "finding-detail-modal");
});

Deno.test("ManagerQueue — quote-bearing findingId can't break out of the URL or JS", () => {
  // A `'` in the id used to close the inlined JS string early (DOM-XSS-prone).
  const html = renderHTML(renderQueueTable([item({ findingId: "x';alert(1)//" })]));
  // (1) The id is carried on a data-attribute, which Preact attribute-escapes.
  //     A `'` inside a double-quoted attribute is inert.
  assertContains(html, `data-finding-id="x';alert(1)//"`);
  // (2) Navigation reads it back through encodeURIComponent — so it can never
  //     be concatenated raw into the URL, nor truncate the path with its `/`.
  assertContains(html, "encodeURIComponent(this.dataset.findingId)");
  assertNotContains(html, "remediate/x';alert");
  // (3) Same rule for the Remediate button: read off the dataset, never
  //     inlined into a single-quoted JS string there is something to escape out of.
  assertContains(html, "this.dataset.findingId");
  assertNotContains(html, "value='");
});

Deno.test("ManagerQueue — remediated item shows green pill", () => {
  const html = renderHTML(renderQueueTable([item({ status: "remediated" })]));
  assertContains(html, "pill-green");
  assertContains(html, "remediated");
});

// ── Completed mode (the /manager/completed tab) ───────────────────────────────

Deno.test("ManagerQueue completed — swaps Status/Action for Remediated By/When", () => {
  const html = renderHTML(renderQueueTable([], { completed: true }));
  assertContains(html, "Remediated By");
  assertContains(html, "When");
  assertNotContains(html, "Status");
  assertNotContains(html, "Action");
  assertContains(html, "No completed remediations");
});

Deno.test("ManagerQueue completed — shows who remediated and when, no Remediate button", () => {
  const html = renderHTML(renderQueueTable(
    [item({ status: "remediated", remediatedBy: "haleys@monsterrg.com", remediatedAt: Date.UTC(2026, 6, 15, 14, 30) })],
    { completed: true },
  ));
  assertContains(html, "haleys@monsterrg.com");
  assertContains(html, "Jul 15");
  assertNotContains(html, "Remediate<");
  assertNotContains(html, "remediate-modal");
});

Deno.test("ManagerQueue completed — dash when remediation metadata is missing", () => {
  const html = renderHTML(renderQueueTable([item({ status: "remediated" })], { completed: true }));
  assertContains(html, "—");
});

// ── Filter / sort helpers (in-memory, zero extra reads) ───────────────────────

const ids = (items: QueueItem[]) => items.map((i) => i.findingId);

Deno.test("queueFacets — distinct members (excludes 'api'/dash) + questions, sorted", () => {
  const facets = queueFacets([
    item({ findingId: "a", voName: "Zoe" }),
    item({ findingId: "b", owner: "amy@team.com" }),
    item({ findingId: "c", owner: "api" }),                                  // no label → excluded
    item({ findingId: "d", voName: "Zoe" }),                                 // dup → collapsed
    item({ findingId: "e", owner: "api", failedQuestions: ["Age", "Confirmation"] }),
    item({ findingId: "f", owner: "api", failedQuestions: ["Age"] }),        // dup question
  ]);
  // localeCompare orders case-insensitively (a before Z).
  assertEquals(facets.members, ["amy", "Zoe"]);
  assertEquals(facets.questions, ["Age", "Confirmation"]);
});

Deno.test("filterAndSortQueue — member filter is case-insensitive substring", () => {
  const rows = filterAndSortQueue([
    item({ findingId: "a", voName: "Jane Doe" }),
    item({ findingId: "b", voName: "John Smith" }),
  ], { member: "jane" });
  assertEquals(ids(rows), ["a"]);
});

Deno.test("filterAndSortQueue — failed-question filter matches exact membership", () => {
  const rows = filterAndSortQueue([
    item({ findingId: "a", failedQuestions: ["Age", "Pets"] }),
    item({ findingId: "b", failedQuestions: ["Confirmation"] }),
  ], { q: "Age" });
  assertEquals(ids(rows), ["a"]);
});

Deno.test("filterAndSortQueue — WGS/MCC union: either box keeps rows with that sale", () => {
  const rows = [
    item({ findingId: "w", wgs: true, mcc: false }),
    item({ findingId: "m", wgs: false, mcc: true }),
    item({ findingId: "n", wgs: false, mcc: false }),
  ];
  assertEquals(ids(filterAndSortQueue(rows, { wgs: true })), ["w"]);
  assertEquals(ids(filterAndSortQueue(rows, { mcc: true })), ["m"]);
  // Both checked → union (WGS OR MCC), never requires both.
  assertEquals(ids(filterAndSortQueue(rows, { wgs: true, mcc: true })).sort(), ["m", "w"]);
  // Neither checked → no sale restriction.
  assertEquals(ids(filterAndSortQueue(rows, {})).length, 3);
});

Deno.test("filterAndSortQueue — sort by % failed, unknown total sinks to the bottom", () => {
  const rows = filterAndSortQueue([
    item({ findingId: "low", totalQuestions: 20, failedCount: 4 }),   // 20%
    item({ findingId: "high", totalQuestions: 5, failedCount: 3 }),   // 60%
    item({ findingId: "unk", totalQuestions: undefined, failedCount: 9 }), // unknown → last
  ], { sort: "failpct" });
  assertEquals(ids(rows), ["high", "low", "unk"]);
});

Deno.test("filterAndSortQueue — recent (default) is newest addedAt first; oldest flips it", () => {
  const rows = [
    item({ findingId: "old", addedAt: 1000 }),
    item({ findingId: "new", addedAt: 3000 }),
    item({ findingId: "mid", addedAt: 2000 }),
  ];
  assertEquals(ids(filterAndSortQueue(rows, { sort: "recent" })), ["new", "mid", "old"]);
  assertEquals(ids(filterAndSortQueue(rows, { sort: "oldest" })), ["old", "mid", "new"]);
});

Deno.test("filterAndSortQueue — dept narrows to one department; empty keeps all", () => {
  const rows = [
    item({ findingId: "a", department: "ODS WFH" }),
    item({ findingId: "b", department: "GS WFH" }),
    item({ findingId: "c", department: "ODS WFH" }),
  ];
  assertEquals(ids(filterAndSortQueue(rows, { dept: "ODS WFH" })).sort(), ["a", "c"]);
  assertEquals(ids(filterAndSortQueue(rows, { dept: "" })).sort(), ["a", "b", "c"]);
});

Deno.test("filterAndSortQueue — dept match is exact, never a prefix or substring", () => {
  // 'ODS WFH' is one whole department name, so selecting it must not sweep in
  // a differently-named department that merely starts with the same token.
  const rows = [
    item({ findingId: "exact", department: "ODS WFH" }),
    item({ findingId: "other", department: "ODS WFH 2" }),
    item({ findingId: "bare", department: "ODS" }),
  ];
  assertEquals(ids(filterAndSortQueue(rows, { dept: "ODS WFH" })), ["exact"]);
});

Deno.test("filterAndSortQueue — dept drops rows with no stamped department", () => {
  // Legacy unstamped rows can't be attributed to a department, so a selected
  // department must not silently inherit them.
  const rows = [
    item({ findingId: "stamped", department: "GS WFH" }),
    item({ findingId: "unstamped" }),
  ];
  assertEquals(ids(filterAndSortQueue(rows, { dept: "GS WFH" })), ["stamped"]);
});

Deno.test("readQueueFilterParams — parses fields + an explicit window", () => {
  assertEquals(
    readQueueFilterParams(new URLSearchParams("member=jane&q=Age&wgs=1&since=1000&until=2000")),
    { member: "jane", q: "Age", wgs: true, mcc: false, sort: "recent", since: 1000, until: 2000, dept: "" },
  );
});

Deno.test("readQueueFilterParams — reads the Operations Portal's department selection", () => {
  assertEquals(readQueueFilterParams(new URLSearchParams("dept=ODS%20WFH")).dept, "ODS WFH");
  // Absent → empty, i.e. every department in scope (the manager default).
  assertEquals(readQueueFilterParams(new URLSearchParams("")).dept, "");
});

Deno.test("readQueueFilterParams — defaults to the last ~7 days", () => {
  const before = Date.now();
  const p = readQueueFilterParams(new URLSearchParams(""));
  const after = Date.now();
  assert(p.until! >= before && p.until! <= after, "until ≈ now");
  const sevenDays = 7 * 86_400_000;
  assert(p.since! >= before - sevenDays - 50 && p.since! <= after - sevenDays + 50, "since ≈ now-7d");
});

Deno.test("readQueueFilterParams — since=0 means all time (not the 7-day default)", () => {
  assertEquals(readQueueFilterParams(new URLSearchParams("since=0")).since, 0);
});

Deno.test("queueTimestamp — prefers completedAt (audit time) over addedAt, falls back", () => {
  assertEquals(queueTimestamp(item({ completedAt: 5000, addedAt: 1000 })), 5000);
  assertEquals(queueTimestamp(item({ addedAt: 1000 })), 1000);
  assertEquals(queueTimestamp(item({})), 0);
});

Deno.test("filterAndSortQueue — date window keeps only rows whose audit time is in range", () => {
  const rows = [
    item({ findingId: "old", completedAt: 1000 }),
    item({ findingId: "mid", completedAt: 5000 }),
    item({ findingId: "new", completedAt: 9000 }),
  ];
  assertEquals(ids(filterAndSortQueue(rows, { since: 4000, until: 6000, sort: "oldest" })), ["mid"]);
  // since=0 → all time (the All button).
  assertEquals(ids(filterAndSortQueue(rows, { since: 0, sort: "oldest" })).length, 3);
  // No window params → no date restriction.
  assertEquals(ids(filterAndSortQueue(rows, { sort: "oldest" })).length, 3);
});

Deno.test("filterAndSortQueue — recent sort ranks by audit time (completedAt beats a later addedAt)", () => {
  const rows = [
    item({ findingId: "a", completedAt: 9000, addedAt: 1 }),
    item({ findingId: "b", completedAt: 1000, addedAt: 999999 }),
  ];
  assertEquals(ids(filterAndSortQueue(rows, { sort: "recent", since: 0 })), ["a", "b"]);
});

Deno.test("ManagerQueue — pending table shows a Timestamp column in Eastern time", () => {
  // 18:30 UTC on Jul 15 = 2:30 PM ET (EDT in summer).
  const html = renderHTML(renderQueueTable([item({ completedAt: Date.UTC(2026, 6, 15, 18, 30) })]));
  assertContains(html, "Timestamp");
  assertContains(html, "Jul 15");
  assertContains(html, "2:30");
  assertContains(html, "ET");
});

Deno.test("ManagerQueue completed — has no Timestamp column (keeps When)", () => {
  const html = renderHTML(renderQueueTable([], { completed: true }));
  assertNotContains(html, "Timestamp");
  assertContains(html, "When");
});

Deno.test("renderQueueResults — shows the window total above the table", () => {
  const many = renderHTML(renderQueueResults([item({ findingId: "a" }), item({ findingId: "b" })]));
  assertContains(many, "Window total:");
  assertContains(many, "2");
  assertContains(many, "failures");
  const one = renderHTML(renderQueueResults([item({ findingId: "a" })]));
  assertContains(one, "failure");
  assertNotContains(one, "failures");
});

/* ── Notes column (Completed tab) ─────────────────────────────────────────
   A manager's remediation notes were write-only: a required textarea whose
   only render in the whole app was a `title` tooltip on the detail page. The
   Completed tab now carries them as a column — one clamped line plus a hover
   popout, both CSS-driven, so it survives being an HTMX fragment. */

const done = (over: Partial<QueueItem> = {}): QueueItem =>
  item({ status: "remediated", remediatedBy: "lead@monsterrg.com", remediatedAt: 1_700_000_000_000, ...over });

Deno.test("ManagerQueue — completed mode has a Notes column, pending mode does not", () => {
  const completedHtml = renderHTML(renderQueueTable([], { completed: true }));
  assertContains(completedHtml, "Notes");
  assertContains(completedHtml, "Remediated By");
  // The pending queue has no notes yet — the column would be all dashes.
  assertNotContains(renderHTML(renderQueueTable([])), "Notes");
});

Deno.test("ManagerQueue — the note renders in full for the popout, not pre-truncated", () => {
  // Truncation is CSS (clamped line + clamped popout). Cutting the string
  // server-side would make the hover useless — it would reveal nothing new.
  const long = "Discussed the missed 11% disclosure with Marcus. ".repeat(8);
  const html = renderHTML(renderQueueTable([done({ notes: long })], { completed: true }));
  assertContains(html, "rem-note-line");
  assertContains(html, "rem-note-pop");
  // Present twice: once in the clamped line, once in the popout.
  const occurrences = html.split("Discussed the missed").length - 1;
  assertEquals(occurrences, 16, "the full note must appear in both the line and the popout");
});

Deno.test("ManagerQueue — a remediation with no notes gets a dash, not an empty popout", () => {
  const html = renderHTML(renderQueueTable([done({ notes: undefined })], { completed: true }));
  assertNotContains(html, "rem-note-pop");
});

/** Count the <th> cells in the rendered header row. */
function headerCount(html: string): number {
  return (html.match(/<th[ >]/g) ?? []).length;
}

Deno.test("ManagerQueue — empty state spans every column, in all four modes", () => {
  // Derived from the header rather than hardcoded: adding a column used to
  // silently leave a ragged empty row until someone noticed the stripe. Compact
  // (the split view) drops columns, so its colspan has to shrink with them.
  for (const completed of [false, true]) {
    for (const compact of [false, true]) {
      const html = renderHTML(renderQueueTable([], { completed, compact }));
      const n = headerCount(html);
      assertContains(html, `colspan="${n}"`);
    }
  }
});

// ── Team-member buttons (replaced the free-text "Search name…" box) ──────────

const PARAMS = { member: "", q: "", wgs: false, mcc: false, sort: "recent", since: 0, until: Number.MAX_SAFE_INTEGER, dept: "" };

Deno.test("renderMemberButtons — one button per member, busiest first with a count", () => {
  const html = renderHTML(renderMemberButtons([
    item({ findingId: "a", voName: "Natalia Reyes" }),
    item({ findingId: "b", voName: "Natalia Reyes" }),
    item({ findingId: "c", voName: "Natalia Reyes" }),
    item({ findingId: "d", voName: "Lorenzo Bennett" }),
    item({ findingId: "e", voName: "Lorenzo Bennett" }),
    item({ findingId: "f", voName: "Madison Gerald" }),
  ], PARAMS as never));
  assertContains(html, "Natalia Reyes");
  assertContains(html, "Lorenzo Bennett");
  assertContains(html, "Madison Gerald");
  // Busiest first — a manager opens this to see who needs attention most.
  assert(
    html.indexOf("Natalia Reyes") < html.indexOf("Lorenzo Bennett"),
    "the member with the most open items must render first",
  );
  assert(html.indexOf("Lorenzo Bennett") < html.indexOf("Madison Gerald"));
});

Deno.test("renderMemberButtons — counts ignore the member filter so you can switch people", () => {
  // With "Natalia Reyes" selected, every OTHER member must still have a button
  // at their full count — otherwise selecting someone hides everyone else and
  // there's no way to move on without clearing first.
  const items = [
    item({ findingId: "a", voName: "Natalia Reyes" }),
    item({ findingId: "b", voName: "Lorenzo Bennett" }),
    item({ findingId: "c", voName: "Lorenzo Bennett" }),
  ];
  const html = renderHTML(renderMemberButtons(items, { ...PARAMS, member: "Natalia Reyes" } as never));
  assertContains(html, "Natalia Reyes");
  assertContains(html, "Lorenzo Bennett");
});

Deno.test("renderMemberButtons — other filters DO narrow the counts", () => {
  // The sale filter is part of the current view, so the buttons must reflect
  // it — a count that ignored active filters wouldn't match the table below.
  const items = [
    item({ findingId: "a", voName: "Natalia Reyes", wgs: true }),
    item({ findingId: "b", voName: "Lorenzo Bennett", wgs: false, mcc: false }),
  ];
  const html = renderHTML(renderMemberButtons(items, { ...PARAMS, wgs: true } as never));
  assertContains(html, "Natalia Reyes");
  assertNotContains(html, "Lorenzo Bennett");
});

Deno.test("renderMemberButtons — a member with no nameable auditee is skipped", () => {
  // owner "api" is the pipeline, not a person — it must never get a button.
  const html = renderHTML(renderMemberButtons([item({ findingId: "a", owner: "api" })], PARAMS as never));
  assertContains(html, "No team members with open items");
});

Deno.test("renderMemberButtons — clicking the selected member clears the filter", () => {
  const html = renderHTML(renderMemberButtons(
    [item({ findingId: "a", voName: "Natalia Reyes" })],
    { ...PARAMS, member: "Natalia Reyes" } as never,
  ));
  assertContains(html, "q-member");
  assertContains(html, "click for everyone");
});

Deno.test("renderMemberButtons — an 'All' chip always leads, carrying the unfiltered total", () => {
  // The way BACK has to be visible. Relying on clicking the selected name a
  // second time is invisible, and the Clear link also throws away the window
  // and sort — so picking a person read as a dead end.
  const html = renderHTML(renderMemberButtons([
    item({ findingId: "a", voName: "Natalia Reyes" }),
    item({ findingId: "b", voName: "Natalia Reyes" }),
    item({ findingId: "c", voName: "Lorenzo Bennett" }),
  ], { ...PARAMS, member: "Natalia Reyes" } as never));
  assertContains(html, ">All<");
  // The count is the WHOLE view, not the filtered 2 — it's what you get back.
  assertContains(html, "Show every team member");
  assert(
    html.indexOf(">All<") < html.indexOf("Natalia Reyes"),
    "the All chip must come first, where a reader looks for the reset",
  );
});

Deno.test("renderMemberButtons — 'All' is the active chip when nobody is selected", () => {
  const unfiltered = renderHTML(renderMemberButtons(
    [item({ findingId: "a", voName: "Natalia Reyes" })], PARAMS as never,
  ));
  // btn-ghost marks the INACTIVE chips, so an unselected view leaves All solid.
  const allChip = unfiltered.slice(unfiltered.indexOf("<button"), unfiltered.indexOf(">All<"));
  assert(!allChip.includes("btn-ghost"), "All should be the active chip with no member filter");

  const filtered = renderHTML(renderMemberButtons(
    [item({ findingId: "a", voName: "Natalia Reyes" })],
    { ...PARAMS, member: "Natalia Reyes" } as never,
  ));
  const allChipFiltered = filtered.slice(filtered.indexOf("<button"), filtered.indexOf(">All<"));
  assert(allChipFiltered.includes("btn-ghost"), "All should dim once a member is selected");
});

Deno.test("ManagerQueue — team member links to their report only when the row has an employee id", () => {
  // Two people genuinely share the name "Mariah Brown" in prod, so a link built
  // from the NAME would open the wrong person's report. No id → no link.
  const linked = renderHTML(renderQueueTable([item({ voName: "Mariah Brown", employeeId: "25335" })]));
  assertContains(linked, "/manager/team/25335");

  const unlinked = renderHTML(renderQueueTable([item({ voName: "Mariah Brown" })]));
  assertContains(unlinked, "Mariah Brown");
  assertNotContains(unlinked, "/manager/team/");
});


// ── Split view: compact tables + the Completed side ─────────────────────────
// The Manager Portal shows pending and remediated side by side on one page,
// sharing a filter bar. Compact mode is what makes two tables fit; filterCompleted
// is what keeps the right side honest about the row you just submitted.

const DAY = 86_400_000;

Deno.test("ManagerQueue compact — pending side keeps triage columns, drops the rest", () => {
  const html = renderHTML(renderQueueTable([item({ voName: "Jane Doe", department: "VBA", shift: "PM" })], { compact: true }));
  for (const kept of ["Team Member", "Failed Questions", "Score", "Timestamp", "Action"]) assertContains(html, kept);
  for (const dropped of ["Finding", "Dept / Shift", "Sale", "Email Opened", "Status"]) assertNotContains(html, `<th>${dropped}</th>`);
});

Deno.test("ManagerQueue compact — completed side is name / who / when / note", () => {
  const html = renderHTML(renderQueueTable(
    [item({ status: "remediated", voName: "Jane Doe", remediatedBy: "mgr@team.com", remediatedAt: 1, notes: "coached her" })],
    { completed: true, compact: true },
  ));
  for (const kept of ["Team Member", "Remediated By", "When", "Notes"]) assertContains(html, kept);
  // Failed Questions and Score give up their room to the note on this side.
  for (const dropped of ["Failed Questions", "Score", "Finding", "Sale"]) assertNotContains(html, `<th>${dropped}</th>`);
  assertContains(html, "coached her");
});

Deno.test("ManagerQueue compact — the full-width tables are untouched", () => {
  // /operations and /manager/completed pass no `compact` and must still get
  // every column; the split view is the only caller that trims.
  const html = renderHTML(renderQueueTable([item()], {}));
  for (const kept of ["Finding", "Dept / Shift", "Sale", "Email Opened", "Status"]) assertContains(html, `<th>${kept}</th>`);
});

Deno.test("filterCompleted — keeps only remediated rows", () => {
  const rows = filterCompleted([
    item({ findingId: "p", status: "pending" }),
    item({ findingId: "r", status: "remediated", remediatedAt: Date.now() }),
  ], { ...PARAMS });
  assertEquals(rows.map((r) => r.findingId), ["r"]);
});

Deno.test("filterCompleted — windows on remediatedAt, NOT the audit's own timestamp", () => {
  // The row a manager just closed out is the one they most need to see. An
  // audit from three weeks ago, remediated today, belongs in today's window.
  const now = Date.now();
  const rows = filterCompleted([
    item({ findingId: "old-audit-just-closed", status: "remediated", completedAt: now - 21 * DAY, remediatedAt: now }),
    item({ findingId: "new-audit-closed-long-ago", status: "remediated", completedAt: now, remediatedAt: now - 21 * DAY }),
  ], { ...PARAMS, since: now - 7 * DAY });
  assertEquals(rows.map((r) => r.findingId), ["old-audit-just-closed"]);
});

Deno.test("filterCompleted — ignores `until` so a just-submitted row can't fall off the top", () => {
  // Every open-ended preset (Today / 7D / …) freezes `until` at the moment it
  // was clicked, so honoring it would hide anything remediated after page load.
  const now = Date.now();
  const rows = filterCompleted(
    [item({ status: "remediated", remediatedAt: now })],
    { ...PARAMS, since: now - 7 * DAY, until: now - 60_000 },
  );
  assertEquals(rows.length, 1);
});

Deno.test("filterCompleted — since=0 (All time) keeps everything", () => {
  const rows = filterCompleted([item({ status: "remediated", remediatedAt: 1 })], { ...PARAMS, since: 0 });
  assertEquals(rows.length, 1);
});

Deno.test("filterCompleted — shares the member filter with the queue side", () => {
  const now = Date.now();
  const rows = filterCompleted([
    item({ findingId: "a", status: "remediated", voName: "Natalia Reyes", owner: "api", remediatedAt: now }),
    item({ findingId: "b", status: "remediated", voName: "Mar Boos", owner: "api", remediatedAt: now }),
  ], { ...PARAMS, member: "natalia" });
  assertEquals(rows.map((r) => r.findingId), ["a"]);
});

Deno.test("filterCompleted — newest remediation first, whatever the queue's sort says", () => {
  const now = Date.now();
  const rows = filterCompleted([
    item({ findingId: "older", status: "remediated", remediatedAt: now - DAY }),
    item({ findingId: "newer", status: "remediated", remediatedAt: now }),
  ], { ...PARAMS, sort: "oldest" });
  assertEquals(rows.map((r) => r.findingId), ["newer", "older"]);
});

Deno.test("renderCompletedResults — the caption names the window it is actually showing", () => {
  // This side ignores `until`, so the count has to say what dates it covers or
  // a manager is left guessing.
  const since = Date.UTC(2026, 7, 13, 12, 0, 0);
  const html = renderHTML(renderCompletedResults([item({ status: "remediated", remediatedAt: since + DAY })], { ...PARAMS, since }));
  // The count sits in its own <strong>, so assert the two halves separately.
  assertContains(html, ">1</strong>");
  assertContains(html, "remediation closed out since Aug 13, 2026");
});

Deno.test("renderCompletedResults — all-time says so instead of naming a date", () => {
  const html = renderHTML(renderCompletedResults([], { ...PARAMS, since: 0 }));
  assertContains(html, "closed out, all time");
  assertContains(html, "No completed remediations");
});

Deno.test("ManagerQueue — the row click carries `back` so a submit returns to the same filtered view", () => {
  const html = renderHTML(renderQueueTable([item()], { compact: true }));
  assertContains(html, "q.set('back',location.pathname+location.search)");
  assertContains(html, "/manager/remediate/");
});
