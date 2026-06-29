/** Tests for email-report-engine business logic. */
import { assert, assertEquals } from "#assert";
import { renderFullEmail, renderSections } from "./mod.ts";
import type { SectionResult } from "./mod.ts";

Deno.test("email-report-engine — placeholder test", () => {
  assert(true, "email-report-engine test placeholder");
});

function bigSection(n: number): SectionResult {
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      finalizedAt: 1782000000000 + i * 60000,
      voName: "Marlon Murcia",
      department: "VBA AM",
      score: [100, 84, 72, 0, 60][i % 5],
      recordId: String(484960 + i),
      findingId: "J19rr-NCYHZW7kFkjQeA1xx" + i,
    });
  }
  return { header: "VBA AM", columns: ["finalizedAt", "voName", "department", "score", "recordId", "findingId"], rows };
}

Deno.test("renderer — styles live in one <style> block, not repeated inline on every cell", () => {
  const html = renderSections([bigSection(3)]); // 3 rows x 6 cols = 18 data cells
  assert(html.includes("<style>"), "ships a shared <style> block");
  assert(html.includes(".art"), "defines the report-table classes");
  assert(html.includes("<td>"), "cells are bare <td> (style comes from the class)");
  // The <td> bulk style must appear ONCE (in the class), not on all 18 cells.
  const occurrences = html.split("vertical-align:top").length - 1;
  assertEquals(occurrences, 1);
});

Deno.test("renderer — a 120-row report stays well under Gmail's ~102 KB clip limit", () => {
  const html = renderFullEmail(null, renderSections([bigSection(120)]), "VBA Audits");
  const kb = html.length / 1024;
  assert(kb < 102, `120-row report is ${kb.toFixed(1)} KB, must stay < 102 KB so no finding is clipped`);
  // Comfortable margin: each row should cost well under ~600 bytes now.
  assert(html.length / 120 < 600, `~${Math.round(html.length / 120)} bytes/row — slimming regressed`);
});

Deno.test("renderer — score colour + finding link still render (via classes)", () => {
  const html = renderSections([bigSection(1)]);
  assertEquals(html.includes('class="g"'), true); // 100% → green class
  assert(/<a href="[^"]*\/audit\/report\?id=[^"]*">J19rr/.test(html), "finding id is a link to its report");
});
