/** REQ-011: close the appeals REQ-010's bug left stuck. Before that fix,
 *  postJudgedAudit read decisions through a 1000-row-capped scan, so once an
 *  org passed 1000 judge decisions an appeal could be fully judged yet stay
 *  "pending" with its answers uncorrected. A stuck appeal is one still
 *  "pending" whose every appealed question has a judge decision; closing it
 *  re-runs postJudgedAudit WITHOUT the appeal-result email. */
import type { OrgId } from "@core/data/deno-kv/mod.ts";
import type { AppealRecord, JudgeDecision } from "@core/dto/types.ts";
import { getStored, listStoredWithKeysAll } from "@core/data/firestore/mod.ts";
import { postJudgedAudit } from "@judge/domain/data/judge-repository/mod.ts";

export interface StuckAppeal { findingId: string; judge: string; appealedAt: number }

/** Every stuck appeal filed at or after `sinceMs`, oldest first. With `apply`
 *  each is closed; without, nothing is written. */
export async function backfillStuckAppeals(
  orgId: OrgId,
  opts: { sinceMs: number; apply: boolean },
): Promise<StuckAppeal[]> {
  const appeals = (await listStoredWithKeysAll<AppealRecord>("appeal", orgId))
    .map(({ value }) => value)
    .filter((a) => a?.status === "pending" && a.appealedAt >= opts.sinceMs && a.appealedQuestions?.length)
    .sort((a, b) => a.appealedAt - b.appealedAt);

  const stuck: StuckAppeal[] = [];
  for (const a of appeals) {
    const decisions = await Promise.all(
      a.appealedQuestions!.map((q) => getStored<JudgeDecision>("judge-decided", orgId, a.findingId, Number(q))),
    );
    if (decisions.some((d) => !d)) continue; // a judge still has questions to decide
    const last = (decisions as JudgeDecision[]).reduce((x, y) => (y.decidedAt > x.decidedAt ? y : x));
    stuck.push({ findingId: a.findingId, judge: last.judge, appealedAt: a.appealedAt });
  }

  if (opts.apply) {
    for (const s of stuck) await postJudgedAudit(orgId, s.findingId, s.judge, { notify: false });
  }
  return stuck;
}
