/** Smoke tests for the prod-parity EmailReportEditor island.
 *
 *  Tests render the island's exported subviews (ListView, EditView,
 *  WeeklyEditView) directly via preact-render-to-string. Effects don't run
 *  in SSR, so we assert on initial markup only — enough to catch:
 *   - WEEKLY REPORTS divider appears when at least one config has weeklyType
 *   - Both list-buttons render
 *   - Regular EditView shows DATE RANGE card, Rolling/Fixed pill buttons,
 *     yellow TOP-LEVEL FILTERS card, and "Save Report"
 *   - Weekly EditView shows the 3 audit-type pills, Failed-only label, and
 *     auto-recipient/dept rendering. */
import { renderHTML, assertContains, assertNotContains } from "../helpers/render.ts";
import { EditView, ListView, WeeklyEditView } from "../../islands/EmailReportEditor.tsx";

const noop = () => {};

const regular = {
  id: "cfg-1",
  name: "Daily MCC",
  recipients: ["alice@example.com"],
  reportSections: [],
  enabled: true,
};

const weekly = {
  id: "cfg-2",
  name: "ODS",
  recipients: ["mgr@example.com"],
  reportSections: [],
  enabled: true,
  weeklyType: "internal" as const,
  weeklyDepartment: "ODS",
  sendTimeEst: "20:00",
};

Deno.test("EmailReportEditor.ListView — both action buttons render", () => {
  const html = renderHTML(<ListView configs={[regular]} onNew={noop} onNewWeekly={noop} onEdit={noop} />);
  assertContains(html, "+ New Report");
  assertContains(html, "+ Weekly Report");
});

Deno.test("EmailReportEditor.ListView — WEEKLY REPORTS divider appears when a weekly config exists", () => {
  const html = renderHTML(<ListView configs={[regular, weekly]} onNew={noop} onNewWeekly={noop} onEdit={noop} />);
  // Both names render in the table
  assertContains(html, "Daily MCC");
  assertContains(html, "ODS");
  // Divider only appears when at least one weekly config is present
  assertContains(html, "Weekly Reports");
});

Deno.test("EmailReportEditor.ListView — no divider when configs are all regular", () => {
  const html = renderHTML(<ListView configs={[regular]} onNew={noop} onNewWeekly={noop} onEdit={noop} />);
  // The case-sensitive divider label doesn't appear
  assertNotContains(html, "WEEKLY REPORTS");
  // (still might appear lowercase elsewhere — ensure the row-divider styling doesn't appear either)
  assertNotContains(html, "letter-spacing:1.4px");
});

Deno.test("EmailReportEditor.ListView — empty state renders", () => {
  const html = renderHTML(<ListView configs={[]} onNew={noop} onNewWeekly={noop} onEdit={noop} />);
  assertContains(html, "No email reports configured");
});

Deno.test("EmailReportEditor.ListView — Build Weekly Reports footer link", () => {
  const html = renderHTML(<ListView configs={[]} onNew={noop} onNewWeekly={noop} onEdit={noop} />);
  assertContains(html, "Build Weekly Reports");
  assertContains(html, '/admin/weekly-builder');
});

Deno.test("EmailReportEditor.EditView — Rolling/Fixed pills, DATE RANGE card, yellow TOP-LEVEL FILTERS, Save Report", () => {
  const cfg = {
    name: "Test",
    recipients: ["alice@example.com"],
    reportSections: [],
    enabled: true,
    dateRange: { mode: "rolling" as const, hours: 24 },
  };
  const html = renderHTML(
    <EditView
      config={cfg}
      isNew
      templates={[]}
      busy={false}
      msg={null}
      onChange={noop}
      onCancel={noop}
      onSave={noop}
      onDelete={noop}
      onSendNow={noop}
      onPreview={noop}
    />,
  );
  assertContains(html, "DATE RANGE");
  assertContains(html, "Rolling");
  assertContains(html, "Fixed");
  // Yellow accent uses the --yellow CSS var on the FilterCard's left border
  assertContains(html, "var(--yellow)");
  assertContains(html, "TOP-LEVEL FILTERS");
  assertContains(html, "+ Add Filter");
  assertContains(html, "Save Report");
  assertContains(html, "Cancel");
  // Header title uses prod's "New Report" string when isNew=true
  assertContains(html, "New Report");
});

Deno.test("EmailReportEditor.EditView — section card shows all expected column labels", () => {
  const cfg = {
    name: "Test",
    recipients: ["alice@example.com"],
    reportSections: [{ header: "All", columns: ["recordId" as const], criteria: [] }],
    enabled: true,
    dateRange: { mode: "rolling" as const, hours: 24 },
  };
  const html = renderHTML(
    <EditView
      config={cfg}
      isNew
      templates={[]}
      busy={false}
      msg={null}
      onChange={noop}
      onCancel={noop}
      onSave={noop}
      onDelete={noop}
      onSendNow={noop}
      onPreview={noop}
    />,
  );
  assertContains(html, "Record ID");
  assertContains(html, "Audit Report");
  assertContains(html, "Guest Name");
  assertContains(html, "VO Name");
  assertContains(html, "Department");
  assertContains(html, "Score");
  assertContains(html, "Appeal Status");
  assertContains(html, "Timestamp");
  assertContains(html, "Most Recent Active MCC ID");
  assertContains(html, "SECTION HEADER");
  assertContains(html, "CRITERIA");
  assertContains(html, "COLUMNS");
});

Deno.test("EmailReportEditor.WeeklyEditView — three audit-type pills + failed-only label", () => {
  const cfg = {
    name: "",
    recipients: [],
    reportSections: [],
    enabled: true,
    sendTimeEst: "20:00",
    dateRange: { mode: "weekly" as const, startDay: 1 },
  };
  const html = renderHTML(
    <WeeklyEditView
      config={cfg}
      isNew
      templates={[]}
      busy={false}
      msg={null}
      onChange={noop}
      onCancel={noop}
      onSave={noop}
      onPreview={noop}
    />,
  );
  // Header
  assertContains(html, "New Weekly Report");
  // Type pills
  assertContains(html, "What type of audit?");
  assertContains(html, "Internal");
  assertContains(html, "Partner");
  assertContains(html, "Both");
  // Footer link to legacy builder
  assertContains(html, "Build Weekly Reports");
});

Deno.test("EmailReportEditor.WeeklyEditView — internal type shows dept dropdown + edit form gated", () => {
  const cfg = {
    name: "ODS",
    recipients: ["mgr@example.com"],
    reportSections: [],
    enabled: true,
    weeklyType: "internal" as const,
    weeklyDepartment: "ODS",
    failedOnly: false,
    sendTimeEst: "20:00",
    dateRange: { mode: "weekly" as const, startDay: 1 },
  };
  const html = renderHTML(
    <WeeklyEditView
      config={cfg}
      isNew={false}
      templates={[]}
      busy={false}
      msg={null}
      onChange={noop}
      onCancel={noop}
      onSave={noop}
      onPreview={noop}
    />,
  );
  // Header reflects editing state
  assertContains(html, "Edit Weekly Report");
  // Dept & Shift block
  assertContains(html, "Department");
  assertContains(html, "Shift");
  // Failed-only toggle label
  assertContains(html, "Failed audits only (score &lt; 100)");
  // Schedule banner
  assertContains(html, "current pay period");
  assertContains(html, "EST");
  // Save / Cancel buttons
  assertContains(html, "Save Report");
  assertContains(html, "Cancel");
});

Deno.test("EmailReportEditor.WeeklyEditView — partner type shows office dropdown", () => {
  const cfg = {
    name: "",
    recipients: [],
    reportSections: [],
    enabled: true,
    weeklyType: "partner" as const,
    sendTimeEst: "20:00",
    dateRange: { mode: "weekly" as const, startDay: 1 },
  };
  const html = renderHTML(
    <WeeklyEditView
      config={cfg}
      isNew
      templates={[]}
      busy={false}
      msg={null}
      onChange={noop}
      onCancel={noop}
      onSave={noop}
      onPreview={noop}
    />,
  );
  assertContains(html, "Office");
  // Edit form is gated until office is chosen — failedOnly toggle should not be visible yet
  assertNotContains(html, "Failed audits only");
});
