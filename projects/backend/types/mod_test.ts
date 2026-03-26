import { assertEquals, assertThrows } from "@std/assert";
import {
  answerQuestion,
  createFinding,
  createJob,
  createQuestion,
  markAuditDone,
  pickRecords,
} from "./mod.ts";
import type { AuditJob, ILlmQuestionAnswer, IQuestionSeed } from "./mod.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(records: string[], customId?: string): AuditJob {
  return createJob("owner-a", "https://example.com/update", records, customId);
}

const SEED: IQuestionSeed = {
  header: "Was the agent polite?",
  unpopulated: "Was the agent polite?",
  populated: "Was the agent polite during the call?",
  autoYesExp: "auto-yes-expr",
};

// ---------------------------------------------------------------------------
// createJob
// ---------------------------------------------------------------------------

Deno.test("createJob — uses customId when provided", () => {
  const job = makeJob(["r1", "r2"], "fixed-id");
  assertEquals(job.id, "fixed-id");
});

Deno.test("createJob — generates an id when customId is omitted", () => {
  const job = makeJob(["r1"]);
  assertEquals(typeof job.id, "string");
  assertEquals(job.id.length > 0, true);
});

Deno.test("createJob — initial shape is correct", () => {
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
  // Only "r2" is eligible; asking for 10 should return just ["r2"]
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

// ---------------------------------------------------------------------------
// createFinding
// ---------------------------------------------------------------------------

Deno.test("createFinding — uses customId when provided", () => {
  const job = makeJob(["r1"], "job-id");
  const finding = createFinding(job, { callId: "call-abc" }, "callId", "finding-fixed");
  assertEquals(finding.id, "finding-fixed");
});

Deno.test("createFinding — generates id when customId omitted", () => {
  const job = makeJob(["r1"], "job-id");
  const finding = createFinding(job, { callId: "call-abc" }, "callId");
  assertEquals(typeof finding.id, "string");
  assertEquals(finding.id.length > 0, true);
});

Deno.test("createFinding — sets recordingId from record field", () => {
  const job = makeJob(["r1"], "job-id");
  const finding = createFinding(job, { callId: "call-xyz" }, "callId");
  assertEquals(finding.recordingId, "call-xyz");
});

Deno.test("createFinding — recordingId is undefined when field missing", () => {
  const job = makeJob(["r1"], "job-id");
  const finding = createFinding(job, { otherField: "x" }, "callId");
  assertEquals(finding.recordingId, undefined);
});

Deno.test("createFinding — propagates owner and updateEndpoint from job", () => {
  const job = makeJob(["r1"], "job-id");
  const finding = createFinding(job, {}, "callId");
  assertEquals(finding.owner, "owner-a");
  assertEquals(finding.updateEndpoint, "https://example.com/update");
  assertEquals(finding.auditJobId, "job-id");
  assertEquals(finding.findingStatus, "pending");
});

// ---------------------------------------------------------------------------
// createQuestion
// ---------------------------------------------------------------------------

Deno.test("createQuestion — fills defaults when optional fields absent", () => {
  const q = createQuestion(SEED);
  assertEquals(q.autoYesVal, false);
  assertEquals(q.autoYesMsg, "default, this should never happen");
  assertEquals(q.astResults, {});
});

Deno.test("createQuestion — preserves seed fields verbatim", () => {
  const q = createQuestion(SEED);
  assertEquals(q.header, SEED.header);
  assertEquals(q.unpopulated, SEED.unpopulated);
  assertEquals(q.populated, SEED.populated);
  assertEquals(q.autoYesExp, SEED.autoYesExp);
});

Deno.test("createQuestion — respects overrides for optional fields", () => {
  const q = createQuestion({ ...SEED, autoYesVal: true, autoYesMsg: "custom msg" });
  assertEquals(q.autoYesVal, true);
  assertEquals(q.autoYesMsg, "custom msg");
});

// ---------------------------------------------------------------------------
// answerQuestion / normalizeAnswer (tested via answerQuestion)
// ---------------------------------------------------------------------------

function makeAnswer(raw: string): ILlmQuestionAnswer {
  return { answer: raw, thinking: "thinking text", defense: "defense text" };
}

Deno.test("answerQuestion — normalizes 'yes' → 'Yes'", () => {
  const q = createQuestion(SEED);
  assertEquals(answerQuestion(q, makeAnswer("yes")).answer, "Yes");
});

Deno.test("answerQuestion — normalizes 'YES' → 'Yes'", () => {
  const q = createQuestion(SEED);
  assertEquals(answerQuestion(q, makeAnswer("YES")).answer, "Yes");
});

Deno.test("answerQuestion — normalizes 'y' → 'Yes'", () => {
  const q = createQuestion(SEED);
  assertEquals(answerQuestion(q, makeAnswer("y")).answer, "Yes");
});

Deno.test("answerQuestion — normalizes 'true' → 'Yes'", () => {
  const q = createQuestion(SEED);
  assertEquals(answerQuestion(q, makeAnswer("true")).answer, "Yes");
});

Deno.test("answerQuestion — normalizes '1' → 'Yes'", () => {
  const q = createQuestion(SEED);
  assertEquals(answerQuestion(q, makeAnswer("1")).answer, "Yes");
});

Deno.test("answerQuestion — normalizes 'no' → 'No'", () => {
  const q = createQuestion(SEED);
  assertEquals(answerQuestion(q, makeAnswer("no")).answer, "No");
});

Deno.test("answerQuestion — normalizes 'NO' → 'No'", () => {
  const q = createQuestion(SEED);
  assertEquals(answerQuestion(q, makeAnswer("NO")).answer, "No");
});

Deno.test("answerQuestion — normalizes 'n' → 'No'", () => {
  const q = createQuestion(SEED);
  assertEquals(answerQuestion(q, makeAnswer("n")).answer, "No");
});

Deno.test("answerQuestion — normalizes 'false' → 'No'", () => {
  const q = createQuestion(SEED);
  assertEquals(answerQuestion(q, makeAnswer("false")).answer, "No");
});

Deno.test("answerQuestion — normalizes '0' → 'No'", () => {
  const q = createQuestion(SEED);
  assertEquals(answerQuestion(q, makeAnswer("0")).answer, "No");
});

Deno.test("answerQuestion — unknown answer falls back to 'No'", () => {
  const q = createQuestion(SEED);
  assertEquals(answerQuestion(q, makeAnswer("maybe")).answer, "No");
});

Deno.test("answerQuestion — preserves thinking and defense fields", () => {
  const q = createQuestion(SEED);
  const answered = answerQuestion(q, makeAnswer("yes"));
  assertEquals(answered.thinking, "thinking text");
  assertEquals(answered.defense, "defense text");
});

Deno.test("answerQuestion — returned object retains all IQuestion fields", () => {
  const q = createQuestion(SEED);
  const answered = answerQuestion(q, makeAnswer("yes"));
  assertEquals(answered.header, SEED.header);
  assertEquals(answered.populated, SEED.populated);
  assertEquals(answered.autoYesVal, false);
});
