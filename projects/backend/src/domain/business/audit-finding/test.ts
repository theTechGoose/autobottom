import { assertEquals } from "@std/assert";
import { AuditFindingService, createFinding } from "./mod.ts";
import { createJob } from "../audit-job/mod.ts";
import type { AuditJob } from "../../../../dto/audit-job.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(records: string[], customId?: string): AuditJob {
  return createJob("owner-a", "https://example.com/update", records, customId);
}

// ---------------------------------------------------------------------------
// AuditFindingService class — createFinding
// ---------------------------------------------------------------------------

Deno.test("AuditFindingService.createFinding — uses customId when provided", () => {
  const svc = new AuditFindingService();
  const job = makeJob(["r1"], "job-id");
  const finding = svc.createFinding(job, { callId: "call-abc" }, "callId", "finding-fixed");
  assertEquals(finding.id, "finding-fixed");
});

Deno.test("AuditFindingService.createFinding — generates id when customId omitted", () => {
  const svc = new AuditFindingService();
  const job = makeJob(["r1"], "job-id");
  const finding = svc.createFinding(job, { callId: "call-abc" }, "callId");
  assertEquals(typeof finding.id, "string");
  assertEquals(finding.id.length > 0, true);
});

Deno.test("AuditFindingService.createFinding — sets recordingId from record field", () => {
  const svc = new AuditFindingService();
  const job = makeJob(["r1"], "job-id");
  const finding = svc.createFinding(job, { callId: "call-xyz" }, "callId");
  assertEquals(finding.recordingId, "call-xyz");
});

Deno.test("AuditFindingService.createFinding — recordingId is undefined when field missing", () => {
  const svc = new AuditFindingService();
  const job = makeJob(["r1"], "job-id");
  const finding = svc.createFinding(job, { otherField: "x" }, "callId");
  assertEquals(finding.recordingId, undefined);
});

Deno.test("AuditFindingService.createFinding — propagates owner and updateEndpoint from job", () => {
  const svc = new AuditFindingService();
  const job = makeJob(["r1"], "job-id");
  const finding = svc.createFinding(job, {}, "callId");
  assertEquals(finding.owner, "owner-a");
  assertEquals(finding.updateEndpoint, "https://example.com/update");
  assertEquals(finding.auditJobId, "job-id");
  assertEquals(finding.findingStatus, "pending");
});

// ---------------------------------------------------------------------------
// wrapper: createFinding
// ---------------------------------------------------------------------------

Deno.test("createFinding wrapper — uses customId when provided", () => {
  const job = makeJob(["r1"], "job-id");
  const finding = createFinding(job, { callId: "call-abc" }, "callId", "finding-fixed");
  assertEquals(finding.id, "finding-fixed");
});

Deno.test("createFinding wrapper — generates id when customId omitted", () => {
  const job = makeJob(["r1"], "job-id");
  const finding = createFinding(job, { callId: "call-abc" }, "callId");
  assertEquals(typeof finding.id, "string");
  assertEquals(finding.id.length > 0, true);
});

Deno.test("createFinding wrapper — sets recordingId from record field", () => {
  const job = makeJob(["r1"], "job-id");
  const finding = createFinding(job, { callId: "call-xyz" }, "callId");
  assertEquals(finding.recordingId, "call-xyz");
});

Deno.test("createFinding wrapper — recordingId is undefined when field missing", () => {
  const job = makeJob(["r1"], "job-id");
  const finding = createFinding(job, { otherField: "x" }, "callId");
  assertEquals(finding.recordingId, undefined);
});

Deno.test("createFinding wrapper — propagates owner and updateEndpoint from job", () => {
  const job = makeJob(["r1"], "job-id");
  const finding = createFinding(job, {}, "callId");
  assertEquals(finding.owner, "owner-a");
  assertEquals(finding.updateEndpoint, "https://example.com/update");
  assertEquals(finding.auditJobId, "job-id");
  assertEquals(finding.findingStatus, "pending");
});
