import { assertEquals } from "@std/assert";
import { AuditJobSchema } from "./audit-job.ts";

Deno.test("AuditJob schema snapshot — required fields only", () => {
  const fixture = {
    id: "job-001",
    doneAuditIds: [],
    status: "pending",
    timestamp: "2024-01-01T00:00:00.000Z",
    owner: "api",
    updateEndpoint: "https://example.com/update",
    recordsToAudit: [],
  };
  const parsed = AuditJobSchema.parse(fixture);
  assertEquals(parsed, fixture);
});

Deno.test("AuditJob schema snapshot — all fields filled", () => {
  const fixture = {
    id: "job-002",
    doneAuditIds: [
      { auditId: "a1", auditRecord: "r1" },
      { auditId: "a2", auditRecord: "r2" },
    ],
    status: "running",
    timestamp: "2024-06-15T12:00:00.000Z",
    owner: "user-xyz",
    updateEndpoint: "https://example.com/update",
    recordsToAudit: ["r1", "r2", "r3"],
  };
  const parsed = AuditJobSchema.parse(fixture);
  assertEquals(parsed, fixture);
});
