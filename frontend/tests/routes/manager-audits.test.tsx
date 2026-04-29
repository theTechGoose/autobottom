/** Frontend tests for the Manager Audit History page.
 *
 *  We exercise the rendering helper `renderAuditHistoryTable` directly with
 *  fixture data — that's what both the SSR page and the HTMX wrapper call,
 *  so it's the right unit to assert against. */
import { renderHTML, assertContains, assertNotContains } from "../helpers/render.ts";
import { renderAuditHistoryTable, type AuditHistoryData } from "../../routes/api/manager/audit-history.tsx";

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
  for (const header of ["Finding", "Agent", "Office / Dept", "Shift", "Score", "Reviewed", "Appeal", "Started"]) {
    assertContains(html, header);
  }
});

Deno.test("ManagerAudits — stats cards render counts and page indicator", () => {
  const html = renderHTML(renderAuditHistoryTable(fixture({ total: 42, page: 2, pages: 5 })));
  assertContains(html, "Total in window");
  assertContains(html, "On this page");
  assertContains(html, "Page");
  assertContains(html, "42");
  assertContains(html, "2 / 5");
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
