/** REQ-010: closing an appeal must find the judge's decisions no matter how
 *  many decisions the org has. postJudgedAudit used to scan the org's whole
 *  judge-decided set capped at 1000 rows; prod passed 1321 and appeals whose
 *  decisions fell past the cap silently stayed "pending" with the score
 *  uncorrected (x6StebJgPkhggCpqwdFQ5, 2026-10-12). */
import { assertEquals } from "#assert";
import { postJudgedAudit, saveAppeal, getAppeal } from "./mod.ts";
import { setStored } from "@core/data/firestore/mod.ts";
import { saveFinding, getFinding } from "@audit/domain/data/audit-repository/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

const kvOpts = { sanitizeResources: false, sanitizeOps: false };

Deno.test({ name: "REQ-010: a judged appeal closes even with over 1000 decisions in the org", ...kvOpts, fn: async () => {
  const org = ("test-req010-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
  // Other audits' decisions fill the first 1000 rows; this audit's id sorts
  // after all of them, so a capped scan can never reach its decision.
  for (let i = 0; i < 1000; i++) {
    await setStored("judge-decided", org, ["a-other-" + String(i).padStart(4, "0"), 0], {
      findingId: "a-other-" + i, questionIndex: 0, decision: "uphold", judge: "j@x.com", decidedAt: i,
    });
  }
  const fid = "zzz-req010-finding";
  await saveFinding(org, {
    id: fid,
    findingStatus: "finished",
    answeredQuestions: [
      { header: "Q0", answer: "Yes" },
      { header: "# in Room", answer: "No" },
    ],
    completedAt: Date.now(),
  } as unknown as Parameters<typeof saveFinding>[1]);
  await saveAppeal(org, {
    findingId: fid, appealedAt: Date.now(), status: "pending",
    auditor: "vo@x.com", appealedQuestions: ["1"],
  });
  await setStored("judge-decided", org, [fid, 1], {
    findingId: fid, questionIndex: 1, header: "# in Room", answer: "No",
    decision: "overturn", judge: "judge@x.com", decidedAt: Date.now(),
  });

  await postJudgedAudit(org, fid, "judge@x.com");

  assertEquals((await getAppeal(org, fid))?.status, "complete", "the appeal must close");
  const q = ((await getFinding(org, fid))?.answeredQuestions as Array<Record<string, unknown>>)[1];
  assertEquals(q.answer, "Yes", "the overturned answer must flip to Yes");
  assertEquals(q.judgeAction, "overturn");
}});
