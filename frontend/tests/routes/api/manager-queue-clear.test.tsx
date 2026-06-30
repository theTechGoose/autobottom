/** Render tests for the admin Manager Queue maintenance fragment (preview /
 *  commit / empty + the filter summary). The clear LOGIC is covered by the
 *  backend clearManagerQueue tests; this pins the admin-facing display. */
import { renderHTML, assertContains, assertNotContains } from "../../helpers/render.ts";
import { assertEquals } from "@std/assert";
import { renderManagerQueueClear, filterSummary, dayMs, type ClearResult } from "../../../routes/api/admin/manager-queue-clear.tsx";

function result(over: Partial<ClearResult> = {}): ClearResult {
  return { total: 5, matched: 0, deleted: 0, dryRun: true, sample: [], ...over };
}

Deno.test("dayMs — parses to UTC midnight (matches fmtDate's UTC basis, no off-by-one)", () => {
  // Goes through the REAL parse (not a hand-built Date.UTC) to pin that the
  // From/through preview lands on the picked day regardless of server timezone.
  assertEquals(dayMs("2026-06-25"), Date.UTC(2026, 5, 25));
  assertEquals(dayMs("2026-06-25", true), Date.UTC(2026, 5, 26)); // exclusive: +1 day
  assertEquals(dayMs(""), undefined);
  assertEquals(dayMs("not-a-date"), undefined);
  // Round-trip: the inclusive To date the summary shows == the picked day.
  const until = dayMs("2026-06-30", true)!;
  assertContains(filterSummary("", "", dayMs("2026-06-25"), until), "from 2026-06-25");
  assertContains(filterSummary("", "", dayMs("2026-06-25"), until), "through 2026-06-30");
});

Deno.test("filterSummary — composes the active filters", () => {
  assertEquals(filterSummary("2ND", "AM"), ` for dept "2ND" · shift "AM"`);
  assertEquals(filterSummary("", ""), "");
  // until is exclusive (one day ahead); the summary shows the inclusive To date.
  const day = 86_400_000;
  const since = Date.UTC(2026, 5, 25);
  const until = Date.UTC(2026, 5, 30) + day;
  assertContains(filterSummary("", "", since, until), "from 2026-06-25");
  assertContains(filterSummary("", "", since, until), "through 2026-06-30");
});

Deno.test("renderManagerQueueClear — preview lists matches + a Clear button", () => {
  const html = renderHTML(renderManagerQueueClear(
    result({ matched: 2, sample: [
      { findingId: "fAAAAAAAAAAA", owner: "a@x.com", department: "2ND", shift: "AM", date: Date.UTC(2026, 5, 29) },
      { findingId: "fBBBBBBBBBBB", owner: "b@x.com", department: "2ND", shift: "PM", date: Date.UTC(2026, 5, 28) },
    ] }),
    { commit: false, summary: ` for dept "2ND"` },
  ));
  assertContains(html, "2</strong> of 5 queue items match");
  assertContains(html, "a@x.com");
  assertContains(html, "2026-06-29");
  // The commit action is wired (hx-vals JSON is attribute-escaped by Preact).
  assertContains(html, "&quot;mode&quot;:&quot;commit&quot;");
  assertContains(html, "Clear 2 items");
  assertContains(html, "hx-confirm");
});

Deno.test("renderManagerQueueClear — empty match shows nothing-to-clear", () => {
  const html = renderHTML(renderManagerQueueClear(result({ matched: 0, total: 7 }), { commit: false, summary: ` for shift "AM"` }));
  assertContains(html, "No items match");
  assertContains(html, "7 in the queue");
  assertNotContains(html, "Clear 0 items");
});

Deno.test("renderManagerQueueClear — commit shows the cleared count, no Clear button", () => {
  const html = renderHTML(renderManagerQueueClear(result({ matched: 3, deleted: 3, dryRun: false }), { commit: true, summary: ` for dept "2ND"` }));
  assertContains(html, "Cleared <strong>3</strong> manager-queue items");
  assertNotContains(html, "&quot;mode&quot;:&quot;commit&quot;");
});

Deno.test("renderManagerQueueClear — singular/plural wording", () => {
  const one = renderHTML(renderManagerQueueClear(result({ matched: 1, sample: [{ findingId: "f1" }] }), { commit: false, summary: "" }));
  assertContains(one, "Clear 1 item<");
  const committed = renderHTML(renderManagerQueueClear(result({ matched: 1, deleted: 1, dryRun: false }), { commit: true, summary: "" }));
  assertContains(committed, "manager-queue item.");
});
