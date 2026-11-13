/** The queue archive rule (REQ-057): which queue items a cutoff takes off the
 *  manager and VO queues. */
import { assertEquals } from "@std/assert";
import { isArchivedFromQueue, type QueueArchive } from "@core/business/queue-archive/mod.ts";

const CUTOFF = Date.parse("2026-11-09T00:00:00-05:00"); // Monday 00:00 ET
const ARCHIVE: QueueArchive = { before: CUTOFF, at: Date.parse("2026-11-13T12:00:00-05:00"), by: "admin@monsterrg.com" };
const row = (over: Record<string, unknown> = {}) => ({ findingId: "f", status: "pending", completedAt: CUTOFF - 1, addedAt: CUTOFF - 1, ...over });

Deno.test("REQ-057: an open item that landed before the cutoff is archived", () => {
  assertEquals(isArchivedFromQueue(row(), ARCHIVE), true);
  assertEquals(isArchivedFromQueue(row({ completedAt: Date.parse("2026-08-11T12:00:00Z") }), ARCHIVE), true);
});

Deno.test("REQ-057: an item that landed ON or AFTER the cutoff stays — Monday 00:00 ET included", () => {
  assertEquals(isArchivedFromQueue(row({ completedAt: CUTOFF }), ARCHIVE), false);
  assertEquals(isArchivedFromQueue(row({ completedAt: CUTOFF + 3_600_000 }), ARCHIVE), false);
});

Deno.test("REQ-057: 'landed' is the audit's completion time, falling back to when it was queued", () => {
  assertEquals(isArchivedFromQueue(row({ completedAt: undefined, addedAt: CUTOFF - 5 }), ARCHIVE), true);
  assertEquals(isArchivedFromQueue(row({ completedAt: undefined, addedAt: CUTOFF + 5 }), ARCHIVE), false);
});

Deno.test("REQ-057: closed items are never archived — remediated, skipped, or out for appeal stay on Completed", () => {
  assertEquals(isArchivedFromQueue(row({ status: "remediated" }), ARCHIVE), false);
  assertEquals(isArchivedFromQueue(row({ status: "skipped" }), ARCHIVE), false);
  assertEquals(isArchivedFromQueue(row({ appealState: "appealed" }), ARCHIVE), false);
});

Deno.test("REQ-057: an old audit sent back by a denied appeal after the archive was set shows again", () => {
  assertEquals(isArchivedFromQueue(row({ appealDeniedAt: ARCHIVE.at + 1000 }), ARCHIVE), false);
  assertEquals(isArchivedFromQueue(row({ appealDeniedAt: ARCHIVE.at - 1000 }), ARCHIVE), true);
});

Deno.test("REQ-057: no archive set means nothing is archived", () => {
  assertEquals(isArchivedFromQueue(row(), null), false);
});
