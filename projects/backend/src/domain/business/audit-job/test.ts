import { assertEquals, assertThrows } from "@std/assert";
import { AuditJobService, createJob, markAuditDone, pickRecords } from "./mod.ts";
import type { AuditJob } from "../../../../../dto/audit-job.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(records: string[], customId?: string): AuditJob {
  return createJob("owner-a", "https://example.com/update", records, customId);
}

// ---------------------------------------------------------------------------
// AuditJobService class — createJob
// ---------------------------------------------------------------------------

Deno.test("AuditJobService.createJob — uses customId when provided", () => {
  const svc = new AuditJobService();
  const job = svc.createJob("owner-a", "https://example.com/update", ["r1", "r2"], "fixed-id");
  assertEquals(job.id, "fixed-id");
});

Deno.test("AuditJobService.createJob — generates an id when customId is omitted", () => {
  const svc = new AuditJobService();
  const job = svc.createJob("owner-a", "https://example.com/update", ["r1"]);
  assertEquals(typeof job.id, "string");
  assertEquals(job.id.length > 0, true);
});

Deno.test("AuditJobService.createJob — initial shape is correct", () => {
  const svc = new AuditJobService();
  const job = svc.createJob("owner-a", "https://example.com/update", ["r1", "r2"]);
  assertEquals(job.owner, "owner-a");
  assertEquals(job.updateEndpoint, "https://example.com/update");
  assertEquals(job.status, "pending");
  assertEquals(job.doneAuditIds, []);
  assertEquals(job.recordsToAudit, ["r1", "r2"]);
  assertEquals(typeof job.timestamp, "string");
});

// ---------------------------------------------------------------------------
// wrapper: createJob
// ---------------------------------------------------------------------------

Deno.test("createJob wrapper — uses customId when provided", () => {
  const job = makeJob(["r1", "r2"], "fixed-id");
  assertEquals(job.id, "fixed-id");
});

Deno.test("createJob wrapper — generates an id when customId is omitted", () => {
  const job = makeJob(["r1"]);
  assertEquals(typeof job.id, "string");
  assertEquals(job.id.length > 0, true);
});

Deno.test("createJob wrapper — initial shape is correct", () => {
  const job = makeJob(["r1", "r2"]);
  assertEquals(job.owner, "owner-a");
  assertEquals(job.updateEndpoint, "https://example.com/update");
  assertEquals(job.status, "pending");
  assertEquals(job.doneAuditIds, []);
  assertEquals(job.recordsToAudit, ["r1", "r2"]);
  assertEquals(typeof job.timestamp, "string");
});

// ---------------------------------------------------------------------------
// pickRecords
// ---------------------------------------------------------------------------

Deno.test("pickRecords — count=0 returns all eligible records", () => {
  const job = makeJob(["r1", "r2", "r3"]);
  assertEquals(pickRecords(job, 0), ["r1", "r2", "r3"]);
});

Deno.test("pickRecords — default count (omitted) returns all eligible records", () => {
  const job = makeJob(["r1", "r2"]);
  assertEquals(pickRecords(job), ["r1", "r2"]);
});

Deno.test("pickRecords — excludes already-done records", () => {
  const job = makeJob(["r1", "r2", "r3"]);
  job.doneAuditIds.push({ auditId: "a1", auditRecord: "r1" });
  assertEquals(pickRecords(job, 0), ["r2", "r3"]);
});

Deno.test("pickRecords — count > eligible returns only eligible", () => {
  const job = makeJob(["r1", "r2"]);
  job.doneAuditIds.push({ auditId: "a1", auditRecord: "r1" });
  assertEquals(pickRecords(job, 10), ["r2"]);
});

Deno.test("pickRecords — respects exact count when count < eligible", () => {
  const job = makeJob(["r1", "r2", "r3", "r4"]);
  assertEquals(pickRecords(job, 2), ["r1", "r2"]);
});

// ---------------------------------------------------------------------------
// markAuditDone
// ---------------------------------------------------------------------------

Deno.test("markAuditDone — adds stub and returns job", () => {
  const job = makeJob(["r1"]);
  const updated = markAuditDone(job, "r1", "audit-1");
  assertEquals(updated.doneAuditIds.length, 1);
  assertEquals(updated.doneAuditIds[0], { auditId: "audit-1", auditRecord: "r1" });
});

Deno.test("markAuditDone — sets status to 'finished' when all records done", () => {
  const job = makeJob(["r1", "r2"]);
  markAuditDone(job, "r1", "audit-1");
  markAuditDone(job, "r2", "audit-2");
  assertEquals(job.status, "finished");
});

Deno.test("markAuditDone — does NOT set finished if some records remain", () => {
  const job = makeJob(["r1", "r2"]);
  markAuditDone(job, "r1", "audit-1");
  assertEquals(job.status, "pending");
});

Deno.test("markAuditDone — throws on duplicate auditId", () => {
  const job = makeJob(["r1", "r2"]);
  markAuditDone(job, "r1", "audit-1");
  assertThrows(
    () => markAuditDone(job, "r2", "audit-1"),
    Error,
    "Audit already done",
  );
});
