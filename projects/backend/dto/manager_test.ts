import { assertEquals } from "@std/assert";
import {
  ManagerQueueItemSchema,
  ManagerRemediationSchema,
} from "./manager.ts";

Deno.test("ManagerQueueItem schema snapshot — pending status", () => {
  const fixture = {
    findingId: "finding-001",
    owner: "alice",
    recordId: "rec-abc",
    recordingId: "recording-xyz",
    totalQuestions: 10,
    failedCount: 3,
    completedAt: 1700000000000,
    jobTimestamp: "2024-01-15T10:00:00Z",
    status: "pending" as const,
  };
  const parsed = ManagerQueueItemSchema.parse(fixture);
  assertEquals(parsed, fixture);
});

Deno.test("ManagerQueueItem schema snapshot — addressed status", () => {
  const fixture = {
    findingId: "finding-002",
    owner: "bob",
    recordId: "rec-def",
    recordingId: "recording-uvw",
    totalQuestions: 8,
    failedCount: 1,
    completedAt: 1700000001000,
    jobTimestamp: "2024-01-16T09:30:00Z",
    status: "addressed" as const,
  };
  const parsed = ManagerQueueItemSchema.parse(fixture);
  assertEquals(parsed, fixture);
});

Deno.test("ManagerRemediation schema snapshot", () => {
  const fixture = {
    findingId: "finding-001",
    notes: "Agent was coached on greeting protocol.",
    addressedBy: "manager-carol",
    addressedAt: 1700000002000,
  };
  const parsed = ManagerRemediationSchema.parse(fixture);
  assertEquals(parsed, fixture);
});
