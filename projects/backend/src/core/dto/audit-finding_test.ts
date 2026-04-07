import { assertEquals } from "@std/assert";
import { AuditFindingSchema } from "./audit-finding.ts";

const baseJob = {
  id: "job-001",
  doneAuditIds: [],
  status: "pending",
  timestamp: "2024-01-01T00:00:00.000Z",
  owner: "api",
  updateEndpoint: "https://example.com/update",
  recordsToAudit: ["r1"],
};

const baseFeedback = {
  heading: "Call Review",
  text: "Agent performed well.",
  viewUrl: "https://example.com/view/001",
};

Deno.test("AuditFinding schema snapshot — required fields only", () => {
  const fixture = {
    id: "finding-001",
    auditJobId: "job-001",
    feedback: baseFeedback,
    job: baseJob,
    record: { callId: "abc123", agentName: "Alice" },
    recordingIdField: "callId",
  };
  const parsed = AuditFindingSchema.parse(fixture);
  assertEquals(parsed, fixture);
});

Deno.test("AuditFinding schema snapshot — all optional fields filled", () => {
  const fixture = {
    id: "finding-002",
    auditJobId: "job-001",
    findingStatus: "finished",
    recordingPath: "/recordings/abc123.mp3",
    recordingId: "abc123",
    rawTranscript: "Agent: Hello, how can I help?",
    fixedTranscript: "Agent: Hello, how can I help you?",
    diarizedTranscript: "[Agent] Hello, how can I help you?",
    unpopulatedQuestions: [
      {
        header: "Greeting",
        unpopulated: "Did the agent greet?",
        populated: "Did the agent greet the customer?",
        autoYesExp: "",
      },
    ],
    populatedQuestions: [
      {
        header: "Greeting",
        unpopulated: "Did the agent greet?",
        populated: "Did the agent greet John?",
        autoYesExp: "",
        astResults: {},
        autoYesVal: false,
        autoYesMsg: "default",
      },
    ],
    answeredQuestions: [
      {
        header: "Greeting",
        unpopulated: "Did the agent greet?",
        populated: "Did the agent greet John?",
        autoYesExp: "",
        astResults: {},
        autoYesVal: false,
        autoYesMsg: "default",
        answer: "Yes",
        thinking: "Agent said hello.",
        defense: "Transcript line 1.",
        snippet: "Hello!",
      },
    ],
    feedback: {
      heading: "Call Review",
      text: "Agent performed well.",
      viewUrl: "https://example.com/view/002",
      recordingUrl: "https://example.com/recordings/abc123.mp3",
      disputeUrl: "https://example.com/dispute/002",
    },
    job: {
      ...baseJob,
      id: "job-001",
      status: "running",
      doneAuditIds: [{ auditId: "a1", auditRecord: "r1" }],
    },
    record: { callId: "abc123", agentName: "Alice", duration: 120 },
    recordingIdField: "callId",
    owner: "user-xyz",
    updateEndpoint: "https://example.com/update",
    s3RecordingKey: "recordings/abc123.mp3",
    s3RecordingKeys: ["recordings/abc123.mp3", "recordings/abc123-part2.mp3"],
    qlabConfig: "config-v1",
    genieIds: ["genie-1", "genie-2"],
    snipStart: 5,
    snipEnd: 120,
    appealSourceFindingId: "finding-001",
    appealType: "redo",
    appealComment: "Recording was cut off.",
    reAuditedAt: 1704067200000,
  };
  const parsed = AuditFindingSchema.parse(fixture);
  assertEquals(parsed, fixture);
});
