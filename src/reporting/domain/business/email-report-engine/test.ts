/** Tests for email-report-engine business logic. */
import { assert, assertEquals } from "#assert";
import {
  buildCsv,
  findingUrl,
  recordUrl,
  trimSectionsForEmail,
  weeklyReportSlug,
} from "./mod.ts";
import type { SectionResult } from "./mod.ts";

Deno.test("email-report-engine — placeholder test", () => {
  assert(true, "email-report-engine test placeholder");
});

const COLS = ["finalizedAt", "voName", "department", "score", "recordId", "findingId"] as const;
function section(header: string, n: number): SectionResult {
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      finalizedAt: 1782000000000 + i * 60000,
      voName: "Marlon Murcia",
      department: header,
      score: 100,
      recordId: String(484960 + i),
      findingId: "fid" + i,
    });
  }
  return { header, columns: [...COLS], rows };
}

Deno.test("weeklyReportSlug — deterministic per (report, week), differs across weeks/reports", async () => {
  const a = await weeklyReportSlug("org", "cfg-1", 1_000);
  const b = await weeklyReportSlug("org", "cfg-1", 1_000); // same → same slug
  const otherWeek = await weeklyReportSlug("org", "cfg-1", 2_000);
  const otherReport = await weeklyReportSlug("org", "cfg-2", 1_000);
  assertEquals(a, b);
  assert(a !== otherWeek, "different week → different slug");
  assert(a !== otherReport, "different report → different slug");
  assert(/^[0-9a-f]{24}$/.test(a), "slug is 24 hex chars, unguessable");
});

Deno.test("buildCsv — clean id columns + appended URL columns", () => {
  const csv = buildCsv([section("DS MB", 2)]);
  const lines = csv.trim().split("\r\n");
  const header = lines[0];
  assert(header.includes("Record ID URL"), "has Record ID URL column");
  assert(header.includes("Audit Report URL"), "has Audit Report URL column");
  // First data row: the id cell stays clean, the URL cell carries the link.
  const row = lines[1];
  assert(row.includes(",484960,"), "record id stays a plain value");
  assert(row.includes("quickbase.com"), "record URL column populated");
  assert(row.includes("/audit/report?id=fid0"), "audit report URL column populated");
});

Deno.test("buildCsv — no URL columns when those id columns aren't in the report", () => {
  const csv = buildCsv([{ header: "x", columns: ["voName", "score"], rows: [{ voName: "A", score: 100 }] }]);
  assert(!csv.includes("Record ID URL"));
  assert(!csv.includes("Audit Report URL"));
});

Deno.test("trimSectionsForEmail — spreads the budget across sections (even split)", () => {
  const { sections, shown, total } = trimSectionsForEmail([section("A", 25), section("B", 25)], 30);
  assertEquals(total, 50);
  assertEquals(shown, 30);
  assertEquals(sections[0].rows.length, 15); // 30 split across 2 sections → 15 each
  assertEquals(sections[1].rows.length, 15);
});

Deno.test("trimSectionsForEmail — a section with audits NEVER shows as empty (the WST Inbound bug)", () => {
  // 74 + 107 = 181, budget 30 → both sections must show rows, neither starved to 0.
  const { sections, shown } = trimSectionsForEmail([section("IDS A3N", 74), section("GS WST", 107)], 30);
  assertEquals(shown, 30);
  assert(sections[0].rows.length > 0, "IDS A3N shows rows");
  assert(sections[1].rows.length > 0, "GS WST shows rows (not a false 'No records')");
});

Deno.test("trimSectionsForEmail — small sections fill fully, only truly-empty stay empty", () => {
  const { sections, shown } = trimSectionsForEmail([section("tiny", 2), section("empty", 0), section("big", 100)], 10);
  assertEquals(sections[0].rows.length, 2); // tiny shows all it has
  assertEquals(sections[1].rows.length, 0); // genuinely empty → stays empty (correct "No records")
  assertEquals(sections[2].rows.length, 8); // big gets the rest
  assertEquals(shown, 10);
});

Deno.test("recordUrl / findingUrl — point at QuickBase and the audit-report page", () => {
  assert(recordUrl("485817").startsWith("https://monsterrg.quickbase.com/"));
  assert(recordUrl("485817").endsWith("485817"));
  assert(findingUrl("abc").includes("/audit/report?id=abc"));
});
