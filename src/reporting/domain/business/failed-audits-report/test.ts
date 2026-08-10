/** Failed Audits report — the 4 views + #1 drill-down degradation. */
import { assertEquals } from "#assert";
import {
  getFailedFindings, getAppealedStillFailed, getFailureByQuestion, getFailureMatrix, getTopFailRanked,
} from "./mod.ts";
import { writeFailedFindingRows } from "@audit/domain/data/failed-finding-repository/mod.ts";
import { resetFirestoreCredentials } from "@core/data/firestore/mod.ts";
import { saveFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { normalizeQuestionKey } from "@audit/domain/data/question-stats-repository/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

function uniqueOrg(tag: string): OrgId {
  return (`test-far-${tag}-${crypto.randomUUID().slice(0, 8)}`) as unknown as OrgId;
}

interface Seed {
  id: string; vo: string; dept: string; shift: string; empId?: string;
  fails: Array<{ header: string; reviewAction?: string; judgeAction?: string; judgeReason?: string }>;
  appealedDenied?: string[]; // headers
}
async function seed(orgId: OrgId, completedAt: number, s: Seed): Promise<void> {
  const answeredQuestions = s.fails.map((f) => ({
    header: f.header, answer: "No",
    reviewAction: f.reviewAction ?? "confirm", judgeAction: f.judgeAction, judgeReason: f.judgeReason,
  }));
  const finding = {
    id: s.id, findingStatus: "finished", completedAt,
    record: {
      RecordId: s.id, VoName: s.vo, ActivatingOffice: s.dept, Shift: s.shift,
      ...(s.empId ? { RelatedEmployeeId: s.empId } : {}),
    },
    answeredQuestions,
  };
  await saveFinding(orgId, finding);
  const denied = new Set((s.appealedDenied ?? []).map(normalizeQuestionKey));
  await writeFailedFindingRows(orgId, finding, { appealedQuestionKeys: denied, deniedQuestionKeys: denied });
}

const NOW = 1_700_000_000_000;
const LO = NOW - 86_400_000;
const HI = NOW + 86_400_000;

async function seedScenario(orgId: OrgId): Promise<void> {
  // Sales: Taxes x2, Income x1.  Support: Taxes x1.
  await seed(orgId, NOW, { id: "f1", vo: "Alice", dept: "Sales", shift: "AM", fails: [{ header: "Taxes Due" }, { header: "Income" }] });
  await seed(orgId, NOW - 1000, { id: "f2", vo: "Bob", dept: "Sales", shift: "PM", fails: [{ header: "Taxes Due" }], appealedDenied: ["Taxes Due"] });
  await seed(orgId, NOW - 2000, { id: "f3", vo: "Cara", dept: "Support", shift: "AM", fails: [{ header: "Taxes Due" }] });
}

Deno.test("getFailedFindings — line items, newest first, paginated", async () => {
  resetFirestoreCredentials();
  const orgId = uniqueOrg("lines");
  await seedScenario(orgId);
  const res = await getFailedFindings(orgId, LO, HI, {}, 1, 100);
  assertEquals(res.total, 4);       // 2 + 1 + 1 failed questions
  assertEquals(res.rows.length, 4);
  assertEquals(res.rows[0].findingId, "f1"); // newest first
});

Deno.test("getAppealedStillFailed — only appealed-and-denied rows", async () => {
  resetFirestoreCredentials();
  const orgId = uniqueOrg("appealed");
  await seedScenario(orgId);
  const res = await getAppealedStillFailed(orgId, LO, HI, {});
  assertEquals(res.total, 1);
  assertEquals(res.rows[0].findingId, "f2");
  assertEquals(res.rows[0].header, "Taxes Due");
});

Deno.test("getFailureByQuestion — ranked by count", async () => {
  resetFirestoreCredentials();
  const orgId = uniqueOrg("byq");
  await seedScenario(orgId);
  const { rows } = await getFailureByQuestion(orgId, LO, HI, {});
  assertEquals(rows[0].header, "Taxes Due");
  assertEquals(rows[0].count, 3);
  assertEquals(rows[1].header, "Income");
  assertEquals(rows[1].count, 1);
});

Deno.test("getFailureMatrix — department x question counts", async () => {
  resetFirestoreCredentials();
  const orgId = uniqueOrg("matrix");
  await seedScenario(orgId);
  const m = await getFailureMatrix(orgId, LO, HI, {});
  const taxesKey = normalizeQuestionKey("Taxes Due");
  assertEquals(m.cells[taxesKey]["Sales"], 2);
  assertEquals(m.cells[taxesKey]["Support"], 1);
  assertEquals(m.rowTotals[taxesKey], 3);
  assertEquals(m.colTotals["Sales"], 3); // Taxes x2 + Income x1
  assertEquals(m.grandTotal, 4);
});

Deno.test("getTopFailRanked — #1 fail for a TM in a dept", async () => {
  resetFirestoreCredentials();
  const orgId = uniqueOrg("top");
  await seedScenario(orgId);
  const res = await getTopFailRanked(orgId, LO, HI, { voName: "Alice", department: "Sales" });
  assertEquals(res.total, 2);
  // Alice failed Taxes Due + Income once each; tie breaks alphabetically.
  assertEquals(res.rows.length, 2);
  assertEquals(res.rows[0].header, "Income");
});

Deno.test("getTopFailRanked — degrades to dept-wide when the TM has no fails", async () => {
  resetFirestoreCredentials();
  const orgId = uniqueOrg("degrade");
  await seedScenario(orgId);
  // Nobody named Ghost — should relax to dept-wide Sales.
  const res = await getTopFailRanked(orgId, LO, HI, { voName: "Ghost", department: "Sales" });
  assertEquals(res.rows[0].header, "Taxes Due");
  assertEquals(res.rows[0].count, 2);          // Sales-wide Taxes
  assertEquals(res.scope.includes("department"), true);
});

Deno.test("getTopFailRanked — empty when no data at any scope", async () => {
  resetFirestoreCredentials();
  const orgId = uniqueOrg("empty");
  const res = await getTopFailRanked(orgId, LO, HI, { department: "Nowhere" });
  assertEquals(res.total, 0);
  assertEquals(res.rows.length, 0);
});

// ── employeeId — telling two people with the same name apart ─────────────────
// Prod has two Mariah Browns (ODR and WST) who also share one email address.
// The failed-question rows feed the "what does this person miss most" panel,
// so if they key on the name, one Mariah's coaching list contains the other's
// misses.

Deno.test("getFailedFindings — employeeId returns ONE person, not everyone sharing the name", async () => {
  const orgId = uniqueOrg("empid");
  await seed(orgId, NOW, { id: "m1", vo: "ODR - Mariah Brown", dept: "ODR", shift: "PM", empId: "25335", fails: [{ header: "Taxes Due" }] });
  await seed(orgId, NOW - 1000, { id: "m2", vo: "WST ACT - Mariah Brown", dept: "WST ACT", shift: "PM", empId: "22887", fails: [{ header: "Income" }, { header: "Taxes Due" }] });

  const byName = await getFailedFindings(orgId, LO, HI, { voName: "Mariah Brown" });
  assertEquals(byName.total, 3, "the name alone matches BOTH Mariahs — that's the bug");

  const odr = await getFailedFindings(orgId, LO, HI, { employeeId: "25335" });
  assertEquals(odr.total, 1);
  assertEquals(odr.rows[0].findingId, "m1");

  const wst = await getFailedFindings(orgId, LO, HI, { employeeId: "22887" });
  assertEquals(wst.total, 2);
});

Deno.test("getFailedFindings — employeeId never falls back to the name", async () => {
  // A row with no id must NOT be swept in by a name match, or the two Mariahs
  // silently merge again on historical data.
  const orgId = uniqueOrg("nofall");
  await seed(orgId, NOW, { id: "n1", vo: "ODR - Mariah Brown", dept: "ODR", shift: "PM", fails: [{ header: "Taxes Due" }] });
  const res = await getFailedFindings(orgId, LO, HI, { employeeId: "25335" });
  assertEquals(res.total, 0, "no employeeId on the row means no match, ever");
});

Deno.test("getFailureByQuestion — scoped to one employee, not the shared name", async () => {
  const orgId = uniqueOrg("byq");
  await seed(orgId, NOW, { id: "q1", vo: "ODR - Mariah Brown", dept: "ODR", shift: "PM", empId: "25335", fails: [{ header: "Taxes Due" }] });
  await seed(orgId, NOW - 1000, { id: "q2", vo: "WST ACT - Mariah Brown", dept: "WST", shift: "PM", empId: "22887", fails: [{ header: "Income" }] });

  const odr = await getFailureByQuestion(orgId, LO, HI, { employeeId: "25335" });
  assertEquals(odr.total, 1);
  assertEquals(odr.rows[0].header, "Taxes Due");
});
