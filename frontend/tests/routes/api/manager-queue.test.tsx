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

Deno.test("ManagerQueue — remediated item shows green pill", () => {
  const html = renderHTML(renderQueueTable([item({ status: "remediated" })]));
  assertContains(html, "pill-green");
  assertContains(html, "remediated");
});
