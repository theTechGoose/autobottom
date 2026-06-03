/** failed-finding-repository smoke — heuristic + idempotent projection + filters. */
import { assert, assertEquals } from "#assert";
import {
  deriveFailureSource, writeFailedFindingRows, deleteFailedFindingRows,
  queryFailedFindings, setQuestionFailureSource, resetFailedFindingIndex,
} from "./mod.ts";
import { resetFirestoreCredentials } from "@core/data/firestore/mod.ts";
import { saveFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { normalizeQuestionKey } from "@audit/domain/data/question-stats-repository/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

const kvOpts = { sanitizeResources: false, sanitizeOps: false };
function uniqueOrg(tag: string): OrgId {
  return (`test-ffr-${tag}-${crypto.randomUUID().slice(0, 8)}`) as unknown as OrgId;
}

function finding(id: string, completedAt: number, questions: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}): Record<string, any> {
  return {
    id, findingStatus: "finished", completedAt,
    record: { RecordId: "R1", VoName: "VO 01 - Jane Doe", ActivatingOffice: "Sales", Shift: "AM" },
    answeredQuestions: questions, ...extra,
  };
}

Deno.test("deriveFailureSource — heuristic ordering", () => {
  assertEquals(deriveFailureSource({ failureSourceBy: "admin@x", failureSource: "vo_app", reviewAction: "confirm" }), "vo_app");
  assertEquals(deriveFailureSource({ reviewAction: "admin-flip" }), "autobot");
  assertEquals(deriveFailureSource({ judgeReason: "transcript" }), "vo_app");
  assertEquals(deriveFailureSource({ judgeReason: "fragment" }), "vo_app");
  assertEquals(deriveFailureSource({ reviewAction: "confirm" }), "team_member");
  assertEquals(deriveFailureSource({ judgeAction: "uphold" }), "team_member");
  assertEquals(deriveFailureSource({}), "unknown");
});

Deno.test({ name: "writeFailedFindingRows — only final No questions become rows", ...kvOpts, fn: async () => {
  resetFirestoreCredentials();
  const orgId = uniqueOrg("write");
  const now = Date.now();
  const f = finding("f1", now, [
    { header: "Taxes Due", answer: "No", reviewAction: "confirm", defense: "missed it" },
    { header: "Greeting", answer: "Yes" },                       // pass → no row
    { header: "Phone", answer: "No", judgeReason: "transcript" }, // vo_app
  ]);
  await saveFinding(orgId, f);
  const n = await writeFailedFindingRows(orgId, f);
  assertEquals(n, 2);
  const rows = await queryFailedFindings(orgId, now - 1000, now + 1000, {});
  assertEquals(rows.length, 2);
  const taxes = rows.find((r) => r.header === "Taxes Due")!;
  assertEquals(taxes.failureSource, "team_member");
  assertEquals(taxes.voName, "Jane Doe");
  assertEquals(taxes.department, "Sales");
  assertEquals(taxes.shift, "AM");
  const phone = rows.find((r) => r.header === "Phone")!;
  assertEquals(phone.failureSource, "vo_app");
}});

Deno.test({ name: "writeFailedFindingRows — idempotent rebuild (flip removes a stale row)", ...kvOpts, fn: async () => {
  resetFirestoreCredentials();
  const orgId = uniqueOrg("rebuild");
  const now = Date.now();
  const f = finding("f2", now, [
    { header: "A", answer: "No", reviewAction: "confirm" },
    { header: "B", answer: "No", reviewAction: "confirm" },
  ]);
  await saveFinding(orgId, f);
  await writeFailedFindingRows(orgId, f);
  assertEquals((await queryFailedFindings(orgId, now - 1000, now + 1000, {})).length, 2);
  // B flipped to pass → rebuild should drop B's row.
  f.answeredQuestions = [
    { header: "A", answer: "No", reviewAction: "confirm" },
    { header: "B", answer: "Yes", reviewAction: "flip" },
  ];
  await writeFailedFindingRows(orgId, f);
  const rows = await queryFailedFindings(orgId, now - 1000, now + 1000, {});
  assertEquals(rows.length, 1);
  assertEquals(rows[0].header, "A");
}});

Deno.test({ name: "queryFailedFindings — filters by source / department / appealedOnly", ...kvOpts, fn: async () => {
  resetFirestoreCredentials();
  const orgId = uniqueOrg("filter");
  const now = Date.now();
  const f = finding("f3", now, [
    { header: "A", answer: "No", reviewAction: "confirm" },                       // team_member
    { header: "B", answer: "No", judgeAction: "uphold", judgeReason: "transcript" }, // vo_app + denied
  ]);
  await saveFinding(orgId, f);
  await writeFailedFindingRows(orgId, f, {
    appealedQuestionKeys: new Set([normalizeQuestionKey("B")]),
    deniedQuestionKeys: new Set([normalizeQuestionKey("B")]),
  });
  assertEquals((await queryFailedFindings(orgId, now - 1000, now + 1000, { failureSource: "vo_app" })).length, 1);
  assertEquals((await queryFailedFindings(orgId, now - 1000, now + 1000, { department: "sales" })).length, 2);
  assertEquals((await queryFailedFindings(orgId, now - 1000, now + 1000, { department: "other" })).length, 0);
  const appealed = await queryFailedFindings(orgId, now - 1000, now + 1000, { appealedOnly: true });
  assertEquals(appealed.length, 1);
  assertEquals(appealed[0].header, "B");
}});

Deno.test({ name: "setQuestionFailureSource — manual override sticks across rebuild", ...kvOpts, fn: async () => {
  resetFirestoreCredentials();
  const orgId = uniqueOrg("override");
  const now = Date.now();
  const f = finding("f4", now, [{ header: "A", answer: "No", reviewAction: "confirm" }]);
  await saveFinding(orgId, f);
  await writeFailedFindingRows(orgId, f);
  // Auto-seeded team_member; admin reclassifies as vo_app.
  const res = await setQuestionFailureSource(orgId, "f4", normalizeQuestionKey("A"), "vo_app", "admin@x.com");
  assert(res.ok);
  let rows = await queryFailedFindings(orgId, now - 1000, now + 1000, {});
  assertEquals(rows[0].failureSource, "vo_app");
  // A later finalize-style rebuild must NOT clobber the manual decision.
  const reloaded = finding("f4", now, [{ header: "A", answer: "No", reviewAction: "confirm", failureSource: "vo_app", failureSourceBy: "admin@x.com" }]);
  await writeFailedFindingRows(orgId, reloaded);
  rows = await queryFailedFindings(orgId, now - 1000, now + 1000, {});
  assertEquals(rows[0].failureSource, "vo_app");
}});

Deno.test({ name: "delete + reset clear rows", ...kvOpts, fn: async () => {
  resetFirestoreCredentials();
  const orgId = uniqueOrg("reset");
  const now = Date.now();
  await saveFinding(orgId, finding("f5", now, [{ header: "A", answer: "No", reviewAction: "confirm" }]));
  await writeFailedFindingRows(orgId, finding("f5", now, [{ header: "A", answer: "No", reviewAction: "confirm" }]));
  assertEquals(await deleteFailedFindingRows(orgId, "f5"), 1);
  assertEquals((await queryFailedFindings(orgId, now - 1000, now + 1000, {})).length, 0);
  await writeFailedFindingRows(orgId, finding("f6", now, [{ header: "A", answer: "No" }]));
  const removed = await resetFailedFindingIndex(orgId);
  assert(removed >= 1);
  assertEquals((await queryFailedFindings(orgId, now - 1000, now + 1000, {})).length, 0);
}});
