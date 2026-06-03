/** Failed Audits controller e2e — wiring against the in-mem store. */
import { assert, assertEquals } from "#assert";
import { resetFirestoreCredentials } from "@core/data/firestore/mod.ts";
import { saveFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { writeFailedFindingRows } from "@audit/domain/data/failed-finding-repository/mod.ts";
import { normalizeQuestionKey } from "@audit/domain/data/question-stats-repository/mod.ts";

const kvOpts = { sanitizeResources: false, sanitizeOps: false };

Deno.test("failed-audits e2e — placeholder", () => assert(true));

Deno.test({ name: "FailedAuditsController — views + manual source override", ...kvOpts, fn: async () => {
  resetFirestoreCredentials();
  const ORG = "test-org-fa-" + crypto.randomUUID().slice(0, 8);
  Deno.env.set("DEFAULT_ORG_ID", String(ORG));

  const now = Date.now();
  const finding = {
    id: "fa-1", findingStatus: "finished", completedAt: now,
    record: { RecordId: "R1", VoName: "Alice", ActivatingOffice: "Sales", Shift: "AM" },
    answeredQuestions: [
      { header: "Taxes Due", answer: "No", reviewAction: "confirm" },
      { header: "Income", answer: "Yes" },
    ],
  };
  await saveFinding(ORG, finding);
  await writeFailedFindingRows(ORG, finding);

  const { FailedAuditsController } = await import("./mod.ts");
  const c = new FailedAuditsController();
  const since = String(now - 86_400_000);
  const until = String(now + 86_400_000);

  const findings = await c.findings(since, until, "", "", "", "", "", "1");
  assertEquals(findings.total, 1);
  assertEquals(findings.rows[0].header, "Taxes Due");

  const byQ = await c.byQuestion(since, until, "", "", "", "");
  assertEquals(byQ.rows[0].header, "Taxes Due");
  assertEquals(byQ.rows[0].count, 1);

  const top = await c.topFail(since, until, "Alice", "Sales", "", "");
  assertEquals(top.rows[0].header, "Taxes Due");

  // Manual override → reclassify, confirm it surfaces under the new source.
  const ok = await c.setSource({ data: {}, findingId: "fa-1", questionKey: normalizeQuestionKey("Taxes Due"), source: "vo_app", by: "admin@x.com" } as never);
  assert((ok as { ok: boolean }).ok);
  const voApp = await c.findings(since, until, "", "", "", "", "vo_app", "1");
  assertEquals(voApp.total, 1);
}});
