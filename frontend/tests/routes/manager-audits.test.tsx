/** Frontend tests for the Manager Audit History page.
 *
 *  We exercise the rendering helper `renderAuditHistoryTable` directly with
 *  fixture data — that's what both the SSR page and the HTMX wrapper call,
 *  so it's the right unit to assert against. */
import { renderHTML, assertContains, assertNotContains } from "../helpers/render.ts";
import { assertEquals } from "@std/assert";
import {
  renderAuditHistoryTable, renderFilterSelects, parseOobSelects, type AuditHistoryData,
} from "../../routes/api/manager/audit-history.tsx";

function fixture(over: Partial<AuditHistoryData> = {}): AuditHistoryData {
  return {
    items: [],
    total: 0,
    pages: 1,
    page: 1,
    owners: [],
    shifts: [],
    departments: [],
    ...over,
  };
}

Deno.test("ManagerAudits — empty state renders 'No audits match the current filters'", () => {
  const html = renderHTML(renderAuditHistoryTable(fixture()));
  assertContains(html, "No audits match the current filters");
});

Deno.test("ManagerAudits — table renders all expected column headers", () => {
  const html = renderHTML(renderAuditHistoryTable(fixture()));
  for (const header of ["Finding", "Team Member", "Office / Dept", "Shift", "Score", "Sale", "Reviewed", "Appeal", "Started"]) {
    assertContains(html, header);
  }
});

Deno.test("ManagerAudits — summary line carries the WGS/MCC counts", () => {
  const html = renderHTML(renderAuditHistoryTable(fixture({ total: 20, wgsCount: 7, mccCount: 4, saleUnknownCount: 0 })));
  assertContains(html, "WGS");
  assertContains(html, "MCC");
  assertContains(html, "7");
  assertContains(html, "4");
});

Deno.test("ManagerAudits — sale-pending hint renders when legacy rows lack flags", () => {
  const html = renderHTML(renderAuditHistoryTable(fixture({ total: 20, wgsCount: 2, mccCount: 1, saleUnknownCount: 9 })));
  assertContains(html, "9 pending");
});

Deno.test("ManagerAudits — most-missed panel renders top questions with counts", () => {
  const html = renderHTML(renderAuditHistoryTable(fixture({
    total: 12,
    topMissed: [
      { header: "Confirmed travel dates", count: 7 },
      { header: "Active Bankruptcy", count: 1 },
    ],
  })));
  assertContains(html, "Most Missed Questions");
  assertContains(html, "Confirmed travel dates");
  assertContains(html, "7 misses");
  assertContains(html, "1 miss");
});

Deno.test("ManagerAudits — most-missed panel hidden when there are no misses", () => {
  const html = renderHTML(renderAuditHistoryTable(fixture({ total: 5, topMissed: [] })));
  assertNotContains(html, "Most Missed Questions");
});

Deno.test("ManagerAudits — sale tags render per row (WGS + MCC pills)", () => {
  const html = renderHTML(renderAuditHistoryTable(fixture({
    total: 1, page: 1, pages: 1,
    items: [{ findingId: "fid-sale", ts: Date.now(), score: 100, wgs: true, mcc: true }],
  })));
  assertContains(html, ">WGS<");
  assertContains(html, ">MCC<");
});

Deno.test("ManagerAudits — unknown sale flags render a dash, not tags", () => {
  const html = renderHTML(renderAuditHistoryTable(fixture({
    total: 1, page: 1, pages: 1,
    items: [{ findingId: "fid-nosale", ts: Date.now(), score: 100 }],
  })));
  assertNotContains(html, ">WGS<");
  assertNotContains(html, ">MCC<");
});

Deno.test("ManagerAudits — summary line: audit count, window dates, pass/fail split, sales", () => {
  const html = renderHTML(renderAuditHistoryTable(
    fixture({ total: 105, scoredCount: 105, passedCount: 65, wgsCount: 83, mccCount: 22, page: 2, pages: 5 }),
    { since: new Date(2026, 6, 27).getTime(), until: new Date(2026, 7, 2).getTime() },
  ));
  assertContains(html, "105");
  assertContains(html, "audits");
  assertContains(html, "Jul 27");
  assertContains(html, "Aug 2");
  assertContains(html, ">61.9%</strong> passing");   // 65 of 105 perfect
  assertContains(html, ">38.1%</strong> failing");
  assertContains(html, "83");
  assertContains(html, "22");
  // The stat-card grid is gone — including the "on this page" / page cards.
  assertNotContains(html, "Total in window");
  assertNotContains(html, "On this page");
  assertNotContains(html, "stat-card");
});

Deno.test("ManagerAudits — passing and failing always sum to 100", () => {
  const html = renderHTML(renderAuditHistoryTable(fixture({ total: 3, scoredCount: 3, passedCount: 1 })));
  assertContains(html, ">33.3%</strong> passing");
  assertContains(html, ">66.7%</strong> failing");
});

Deno.test("ManagerAudits — no scored audits says so instead of printing NaN%", () => {
  const html = renderHTML(renderAuditHistoryTable(fixture({ total: 0, scoredCount: 0, passedCount: 0 })));
  assertContains(html, "no scored audits");
  assertNotContains(html, "NaN");
});

Deno.test("ManagerAudits — an all-time window reads 'all time', not the epoch", () => {
  const html = renderHTML(renderAuditHistoryTable(
    fixture({ total: 9, scoredCount: 9, passedCount: 9 }),
    { since: 0, until: new Date(2026, 7, 2).getTime() },
  ));
  assertContains(html, "all time to");
  assertNotContains(html, "Jan 1, 1970");
});

Deno.test("ManagerAudits — a window spanning years shows the year on both ends", () => {
  const html = renderHTML(renderAuditHistoryTable(
    fixture({ total: 4, scoredCount: 4, passedCount: 2 }),
    { since: new Date(2025, 11, 28).getTime(), until: new Date(2026, 0, 4).getTime() },
  ));
  assertContains(html, "Dec 28, 2025");
  assertContains(html, "Jan 4, 2026");
});

Deno.test("ManagerAudits — items render with finding link to /audit/report", () => {
  const html = renderHTML(renderAuditHistoryTable(fixture({
    total: 1, page: 1, pages: 1,
    items: [{
      findingId: "fid-deadbeef-0001",
      ts: Date.now(),
      score: 92,
      voName: "Jane Doe",
      department: "DS-MB",
      shift: "DAY",
      reviewed: true,
      appealStatus: "pending",
    }],
  })));
  assertContains(html, "/audit/report?id=fid-deadbeef-0001");
  assertContains(html, "Jane Doe");
  assertContains(html, "DS-MB");
  assertContains(html, "DAY");
  assertContains(html, "92%");
  assertContains(html, "Reviewed");
  assertContains(html, "Pending");
  assertNotContains(html, "No audits match");
});

Deno.test("ManagerAudits — pagination renders only when pages > 1", () => {
  const single = renderHTML(renderAuditHistoryTable(fixture({ total: 0, pages: 1, page: 1 })));
  assertNotContains(single, "Page 1 of 1");
  assertNotContains(single, "Prev");
  assertNotContains(single, "Next");

  const multi = renderHTML(renderAuditHistoryTable(fixture({ total: 100, pages: 4, page: 2 })));
  assertContains(multi, "Page 2 of 4");
  assertContains(multi, "Prev");
  assertContains(multi, "Next");
});

Deno.test("ManagerAudits — auto-pass items show 'Auto' badge from reason=perfect_score", () => {
  const html = renderHTML(renderAuditHistoryTable(fixture({
    total: 1, page: 1, pages: 1,
    items: [{
      findingId: "fid-auto",
      ts: Date.now(),
      score: 100,
      reason: "perfect_score",
    }],
  })));
  assertContains(html, "Auto");
});

Deno.test("ManagerAudits — invalid_genie items show 'Invalid Genie' badge", () => {
  const html = renderHTML(renderAuditHistoryTable(fixture({
    total: 1, page: 1, pages: 1,
    items: [{
      findingId: "fid-invalid",
      ts: Date.now(),
      score: 0,
      reason: "invalid_genie",
    }],
  })));
  assertContains(html, "Invalid Genie");
});

Deno.test("ManagerAudits — unreviewed items render em-dash placeholders for badges", () => {
  const html = renderHTML(renderAuditHistoryTable(fixture({
    total: 1, page: 1, pages: 1,
    items: [{
      findingId: "fid-unreviewed",
      ts: Date.now(),
      score: 60,
      reviewed: false,
      appealStatus: null,
    }],
  })));
  // No "Auto" / "Pending" / "Complete" pills for an unreviewed item with no appeal.
  // (The header still says "Reviewed" so we can't simply assertNotContains "Reviewed".)
  assertNotContains(html, "pill-yellow\">Pending");
  assertNotContains(html, "pill-blue\">Complete");
  assertNotContains(html, "pill-green\">Auto");
});

// ── Filter dropdowns ────────────────────────────────────────────────────────
// They sit in the filter form, outside the swapped table, so the HTMX fragment
// has to send them back out-of-band or they keep the first load's names.

Deno.test("filter selects — options come from the current window, with the selection kept", () => {
  const html = renderHTML(renderFilterSelects(
    fixture({ owners: ["Andrew Torsiello", "Destiny Peterson"], departments: ["ODR"], shifts: ["AM"] }),
    { owner: "Destiny Peterson", department: "", shift: "" },
    { oob: true },
  ));
  assertContains(html, "Destiny Peterson");
  assertContains(html, 'id="ah-owner"');
  assertContains(html, 'hx-swap-oob="true"');
});

Deno.test("filter selects — a selection missing from the window is still offered, not dropped", () => {
  const html = renderHTML(renderFilterSelects(
    fixture({ owners: ["Andrew Torsiello"] }),
    { owner: "Someone With No Audits This Week", department: "", shift: "" },
  ));
  assertContains(html, "Someone With No Audits This Week");
  assertNotContains(html, "hx-swap-oob");
});

Deno.test("parseOobSelects — blank means all three; a list narrows it", () => {
  assertEquals(parseOobSelects(null), ["owner", "department", "shift"]);
  assertEquals(parseOobSelects(""), ["owner", "department", "shift"]);
  // The Operations portal has no Department select — swapping one would error.
  assertEquals(parseOobSelects("owner,shift"), ["owner", "shift"]);
  assertEquals(parseOobSelects("bogus"), []);
});
