/** Unit tests for parseDateToMs — the pure, payroll-gating date parser behind the
 *  Data Maintenance "Backfill Chargeback Entries" tool. (The until<=since range
 *  rejection lives in the handler's POST, not here.) */
import { assertEquals } from "@std/assert";
import { parseDateToMs } from "../../../routes/api/admin/modal/maintenance/chargeback-backfill-start.tsx";

Deno.test("parseDateToMs — From parses to UTC midnight", () => {
  assertEquals(parseDateToMs("2026-06-30"), Date.parse("2026-06-30T00:00:00Z"));
});

Deno.test("parseDateToMs — To (endOfDay) is inclusive to the last ms of the picked day", () => {
  const start = Date.parse("2026-06-30T00:00:00Z");
  assertEquals(parseDateToMs("2026-06-30", true), start + 86_400_000 - 1); // 23:59:59.999
});

Deno.test("parseDateToMs — empty / invalid input → null", () => {
  assertEquals(parseDateToMs(""), null);
  assertEquals(parseDateToMs("", true), null);
  assertEquals(parseDateToMs("not-a-date"), null);
});

Deno.test("parseDateToMs — the inclusive window covers the whole picked day, no overlap into the next", () => {
  const since = parseDateToMs("2026-06-22")!;          // start of the 22nd
  const until = parseDateToMs("2026-06-22", true)!;    // end of the 22nd
  const nextDayStart = Date.parse("2026-06-23T00:00:00Z");
  // A finding completed any time on the 22nd (UTC) falls in [since, until]...
  assertEquals(since <= until, true);
  assertEquals(until < nextDayStart, true, "the inclusive end stops before the next day begins");
});
