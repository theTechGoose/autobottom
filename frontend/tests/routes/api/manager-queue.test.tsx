/** Tests for the Manager Portal queue table renderer.
 *
 *  Regression guard for the field-mapping bug: the queue fragment must read
 *  the backend `ManagerQueueItem` shape (`owner` + `failedCount`/
 *  `totalQuestions`), NOT the never-populated `agentEmail`/`score` it used to
 *  reference — those rendered as em-dashes for every row. */
import { renderHTML, assertContains, assertNotContains } from "../../helpers/render.ts";
import { renderQueueTable, type QueueItem } from "../../../routes/api/manager/queue.tsx";

function item(over: Partial<QueueItem> = {}): QueueItem {
  return { findingId: "abc12345xyz", owner: "agent@team.com", status: "pending", totalQuestions: 10, failedCount: 2, ...over };
}

Deno.test("ManagerQueue — empty state renders 'No items in queue'", () => {
  const html = renderHTML(renderQueueTable([]));
  assertContains(html, "No items in queue");
});

Deno.test("ManagerQueue — column headers render", () => {
  const html = renderHTML(renderQueueTable([]));
  for (const header of ["Finding", "Agent", "Score", "Status", "Action"]) assertContains(html, header);
});

Deno.test("ManagerQueue — agent column shows owner (not blank)", () => {
  const html = renderHTML(renderQueueTable([item({ owner: "jane@team.com" })]));
  assertContains(html, "jane@team.com");
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

Deno.test("ManagerQueue — row wires finding-detail + remediate modal triggers", () => {
  const html = renderHTML(renderQueueTable([item({ findingId: "fid-001" })]));
  assertContains(html, "/api/manager/finding?findingId=fid-001");
  assertContains(html, "finding-detail-modal");
  assertContains(html, "remediate-modal");
  assertContains(html, "rem-findingId");
});

Deno.test("ManagerQueue — quote-bearing findingId can't break out of URL or JS", () => {
  // A `'` in the id used to close the inlined JS string early (DOM-XSS-prone).
  const html = renderHTML(renderQueueTable([item({ findingId: "x';alert(1)//" })]));
  // (1) hx-get encodes the query-significant separators (`;` and `/`) so the
  //     id can't corrupt or truncate the findingId param. The raw, unencoded
  //     separator form must not appear in the URL.
  assertContains(html, "findingId=x'%3Balert(1)%2F%2F");
  assertNotContains(html, "findingId=x';alert");
  // (2) Remediate handler reads the id off the data-attribute — never inlined
  //     into a single-quoted JS string, so there is no `value='…'` to escape out of.
  //     (The raw id living inside the double-quoted data-attribute is safe.)
  assertContains(html, "this.dataset.findingId");
  assertNotContains(html, "value='");
});

Deno.test("ManagerQueue — remediated item shows green pill", () => {
  const html = renderHTML(renderQueueTable([item({ status: "remediated" })]));
  assertContains(html, "pill-green");
  assertContains(html, "remediated");
});
