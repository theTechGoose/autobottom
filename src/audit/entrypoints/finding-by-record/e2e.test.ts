/** GET /audit/finding-by-record — bearer auth, request errors, and the full read
 *  path (record index → finding docs) against the emulator. */
import { assert, assertEquals } from "#assert";
import { handleFindingByRecord } from "./mod.ts";

const kvOpts = { sanitizeResources: false, sanitizeOps: false };
const SECRET = "finding-api-test-secret";
const BASE = "https://x.deno.net/audit/finding-by-record";

function lookup(recordId: string | null, init: RequestInit = {}, extraQuery = ""): Promise<Response> {
  const url = recordId === null ? BASE : `${BASE}?recordId=${encodeURIComponent(recordId)}${extraQuery}`;
  return handleFindingByRecord(new Request(url, {
    ...init,
    headers: { Authorization: `Bearer ${SECRET}`, ...(init.headers ?? {}) },
  }));
}

/** Fresh org per test: the record search caches per org+record for 60s, and the
 *  emulator database persists between runs. */
function useFreshOrg(): string {
  const org = "test-fbr-" + crypto.randomUUID().slice(0, 8);
  Deno.env.set("DEFAULT_ORG_ID", org);
  Deno.env.set("FINDING_API_SECRET", SECRET);
  return org;
}

Deno.test("handleFindingByRecord — non-GET → 405", async () => {
  useFreshOrg();
  const res = await lookup("1", { method: "POST" });
  assertEquals(res.status, 405);
});

Deno.test("handleFindingByRecord — 500 when secret not configured", async () => {
  useFreshOrg();
  Deno.env.delete("FINDING_API_SECRET");
  const res = await lookup("1");
  assertEquals(res.status, 500);
});

Deno.test("handleFindingByRecord — missing or wrong bearer → 401", async () => {
  useFreshOrg();
  const noHeader = await handleFindingByRecord(new Request(`${BASE}?recordId=1`));
  assertEquals(noHeader.status, 401);
  const wrong = await lookup("1", { headers: { Authorization: "Bearer nope" } });
  assertEquals(wrong.status, 401);
});

Deno.test("handleFindingByRecord — missing or blank recordId → 400", async () => {
  useFreshOrg();
  assertEquals((await lookup(null)).status, 400);
  assertEquals((await lookup("   ")).status, 400);
});

Deno.test({ name: "handleFindingByRecord — unknown record → 404", ...kvOpts, fn: async () => {
  useFreshOrg();
  const res = await lookup("no-such-record-" + crypto.randomUUID().slice(0, 6));
  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.ok, false);
  assertEquals(body.findingIds, []);
}});

Deno.test({ name: "handleFindingByRecord — returns full findings, newest first", ...kvOpts, fn: async () => {
  const org = useFreshOrg();
  const { saveFinding } = await import("@audit/domain/data/audit-repository/mod.ts");
  const { writeAuditDoneIndex } = await import("@audit/domain/data/stats-repository/mod.ts");
  const rid = "REC-" + crypto.randomUUID().slice(0, 6);
  const now = Date.now();

  await saveFinding(org, { id: "fbr-old", findingStatus: "finished", record: { RecordId: rid }, rawTranscript: "old call", diarizedTranscript: "old call", utteranceTimes: [0] });
  await saveFinding(org, { id: "fbr-new", findingStatus: "finished", record: { RecordId: rid }, rawTranscript: "new call", diarizedTranscript: "new call", utteranceTimes: [0] });
  await writeAuditDoneIndex(org, { findingId: "fbr-old", completedAt: now - 60_000, score: 80, completed: true, recordId: rid });
  await writeAuditDoneIndex(org, { findingId: "fbr-new", completedAt: now, score: 100, completed: true, recordId: rid });

  const res = await lookup(rid);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.ok, true);
  assertEquals(body.recordId, rid);
  assertEquals(body.findingIds, ["fbr-new", "fbr-old"]);
  assertEquals(body.findings.map((f: { id: string }) => f.id), ["fbr-new", "fbr-old"]);
  assertEquals(body.findings[0].rawTranscript, "new call");
  assertEquals(body.findings[0].record.RecordId, rid);
}});

Deno.test({ name: "handleFindingByRecord — skips an index row whose finding was deleted", ...kvOpts, fn: async () => {
  const org = useFreshOrg();
  const { saveFinding } = await import("@audit/domain/data/audit-repository/mod.ts");
  const { writeAuditDoneIndex } = await import("@audit/domain/data/stats-repository/mod.ts");
  const rid = "REC-" + crypto.randomUUID().slice(0, 6);
  const now = Date.now();

  await saveFinding(org, { id: "fbr-kept", findingStatus: "finished", record: { RecordId: rid }, rawTranscript: "x", diarizedTranscript: "x", utteranceTimes: [0] });
  await writeAuditDoneIndex(org, { findingId: "fbr-kept", completedAt: now - 60_000, score: 90, completed: true, recordId: rid });
  await writeAuditDoneIndex(org, { findingId: "fbr-gone", completedAt: now, score: 50, completed: true, recordId: rid });

  const body = await (await lookup(rid)).json();
  assertEquals(body.ok, true);
  assertEquals(body.findingIds, ["fbr-gone", "fbr-kept"]);
  assertEquals(body.findings.length, 1);
  assertEquals(body.findings[0].id, "fbr-kept");
}});

Deno.test({ name: "handleFindingByRecord — finding with no transcript fields gets them from the transcript store", ...kvOpts, fn: async () => {
  const org = useFreshOrg();
  const { saveFinding, saveTranscript } = await import("@audit/domain/data/audit-repository/mod.ts");
  const { writeAuditDoneIndex } = await import("@audit/domain/data/stats-repository/mod.ts");
  const rid = "REC-" + crypto.randomUUID().slice(0, 6);

  await saveFinding(org, { id: "fbr-bare", findingStatus: "finished", record: { RecordId: rid } });
  await saveTranscript(org, "fbr-bare", "line one\nline two", "Agent: line one\nGuest: line two", [100, 2000]);
  await writeAuditDoneIndex(org, { findingId: "fbr-bare", completedAt: Date.now(), score: 90, completed: true, recordId: rid });

  const body = await (await lookup(rid)).json();
  const f = body.findings[0];
  assert(f, "finding returned");
  assertEquals(f.rawTranscript, "line one\nline two");
  assertEquals(f.diarizedTranscript, "Agent: line one\nGuest: line two");
  assertEquals(f.utteranceTimes, [100, 2000]);
}});

Deno.test({ name: "handleFindingByRecord — snippets=false drops snippets without touching the cached finding", ...kvOpts, fn: async () => {
  const org = useFreshOrg();
  const { saveFinding } = await import("@audit/domain/data/audit-repository/mod.ts");
  const { writeAuditDoneIndex } = await import("@audit/domain/data/stats-repository/mod.ts");
  const rid = "REC-" + crypto.randomUUID().slice(0, 6);

  await saveFinding(org, {
    id: "fbr-snip", findingStatus: "finished", record: { RecordId: rid },
    rawTranscript: "call", diarizedTranscript: "call", utteranceTimes: [0],
    answeredQuestions: [
      { header: "Q1", answer: "Yes", thinking: "t1", snippet: "call text 1" },
      { header: "Q2", answer: "No", thinking: "t2", snippet: "call text 2" },
    ],
  });
  await writeAuditDoneIndex(org, { findingId: "fbr-snip", completedAt: Date.now(), score: 50, completed: true, recordId: rid });

  const slim = await (await lookup(rid, {}, "&snippets=false")).json();
  const slimQs = slim.findings[0].answeredQuestions;
  assertEquals(slimQs.length, 2);
  assert(slimQs.every((q: Record<string, unknown>) => !("snippet" in q)), "no question keeps a snippet");
  assertEquals(slimQs[1].answer, "No");
  assertEquals(slimQs[1].thinking, "t2");

  // The cached finding must still be whole for the next caller.
  const full = await (await lookup(rid)).json();
  assertEquals(full.findings[0].answeredQuestions.map((q: { snippet: string }) => q.snippet), ["call text 1", "call text 2"]);
  const { getFinding } = await import("@audit/domain/data/audit-repository/mod.ts");
  assertEquals((await getFinding(org, "fbr-snip"))?.answeredQuestions[0].snippet, "call text 1");
}});

Deno.test("withoutSnippets — a finding with no answeredQuestions comes back unchanged", async () => {
  const { withoutSnippets } = await import("./mod.ts");
  const f = { id: "x", findingStatus: "finished" };
  assertEquals(withoutSnippets(f), f);
});

Deno.test({ name: "handleFindingByRecord — fields returns only id + the named fields, score from the index", ...kvOpts, fn: async () => {
  const org = useFreshOrg();
  const { saveFinding } = await import("@audit/domain/data/audit-repository/mod.ts");
  const { writeAuditDoneIndex } = await import("@audit/domain/data/stats-repository/mod.ts");
  const rid = "REC-" + crypto.randomUUID().slice(0, 6);

  // Judge-overturn shape: the finding still carries the pre-appeal reviewScore,
  // while the index row holds the final score.
  await saveFinding(org, {
    id: "fbr-fields", findingStatus: "finished", record: { RecordId: rid }, reviewScore: 80,
    rawTranscript: "[AGENT]: hi", diarizedTranscript: "[AGENT]: hi", utteranceTimes: [0],
    answeredQuestions: [{ header: "Q1", answer: "Yes", snippet: "big" }],
  });
  await writeAuditDoneIndex(org, { findingId: "fbr-fields", completedAt: Date.now(), score: 100, completed: true, recordId: rid });

  const body = await (await lookup(rid, {}, "&fields=" + encodeURIComponent("rawTranscript, score,,notAField"))).json();
  assertEquals(body.ok, true);
  assertEquals(body.findingIds, ["fbr-fields"]);
  assertEquals(body.findings, [{ id: "fbr-fields", rawTranscript: "[AGENT]: hi", score: 100, notAField: null }]);
}});

Deno.test({ name: "handleFindingByRecord — fields + snippets=false strips snippets from picked questions", ...kvOpts, fn: async () => {
  const org = useFreshOrg();
  const { saveFinding } = await import("@audit/domain/data/audit-repository/mod.ts");
  const { writeAuditDoneIndex } = await import("@audit/domain/data/stats-repository/mod.ts");
  const rid = "REC-" + crypto.randomUUID().slice(0, 6);

  await saveFinding(org, {
    id: "fbr-fq", findingStatus: "finished", record: { RecordId: rid },
    rawTranscript: "x", diarizedTranscript: "x", utteranceTimes: [0],
    answeredQuestions: [{ header: "Q1", answer: "No", snippet: "big" }],
  });
  await writeAuditDoneIndex(org, { findingId: "fbr-fq", completedAt: Date.now(), score: 0, completed: true, recordId: rid });

  const body = await (await lookup(rid, {}, "&fields=answeredQuestions&snippets=false")).json();
  assertEquals(body.findings, [{ id: "fbr-fq", answeredQuestions: [{ header: "Q1", answer: "No" }] }]);
}});

Deno.test("parseFields — blank or missing means everything", async () => {
  const { parseFields } = await import("./mod.ts");
  assertEquals(parseFields(null), null);
  assertEquals(parseFields(" , "), null);
  assertEquals(parseFields("score, rawTranscript,score"), ["score", "rawTranscript"]);
});
