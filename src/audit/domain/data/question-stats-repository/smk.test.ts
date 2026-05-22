/** Smoke test — pin the per-question counter math and rollup semantics.
 *  The interesting cases are: (1) flipToPass actually undoes the prior
 *  fail count, so the report's "net failures" stays honest; (2) the
 *  range read aggregates across month buckets. */
import { assert, assertEquals } from "#assert";
import {
  incrFailed, incrFlipToPass, incrFlipToFail,
  readQuestionFailRange, normalizeQuestionKey, configKeyForFinding, yyyymm,
} from "./mod.ts";
import { resetFirestoreCredentials } from "@core/data/firestore/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

function uniqueOrg(): OrgId {
  return (`test-qs-${crypto.randomUUID().slice(0, 8)}`) as unknown as OrgId;
}

const kvOpts = { sanitizeResources: false, sanitizeOps: false };

Deno.test({
  name: "normalizeQuestionKey — slugs headers consistently",
  ...kvOpts,
  fn: () => {
    assertEquals(normalizeQuestionKey("Did the agent greet?"), "did-the-agent-greet");
    assertEquals(normalizeQuestionKey("  Trailing & SPECIAL!!  "), "trailing-special");
    assertEquals(normalizeQuestionKey(""), "_unknown_");
  },
});

Deno.test({
  name: "configKeyForFinding — qlab name beats destination beats default",
  ...kvOpts,
  fn: () => {
    assertEquals(configKeyForFinding({ qlabConfig: "Premium" }), "ql:Premium");
    assertEquals(configKeyForFinding({ record: { RelatedDestinationId: "DEST-9" } }), "qb:DEST-9");
    assertEquals(configKeyForFinding({}), "default");
  },
});

Deno.test({
  name: "incrFailed → incrFlipToPass — flipped pass undoes prior fail count",
  ...kvOpts,
  fn: async () => {
    resetFirestoreCredentials();
    const orgId = uniqueOrg();
    const now = Date.now();
    const month = yyyymm(now);
    await incrFailed(orgId, "ql:X", "Greeting given", "fid1", now);
    await incrFailed(orgId, "ql:X", "Greeting given", "fid2", now);
    await incrFailed(orgId, "ql:X", "Greeting given", "fid3", now);
    let rows = await readQuestionFailRange(orgId, month, month);
    assertEquals(rows.length, 1);
    assertEquals(rows[0].failed, 3);
    assertEquals(rows[0].flippedToPass, 0);

    // Flip fid2 to pass — counter should drop by 1, flippedToPass go up by 1.
    await incrFlipToPass(orgId, "ql:X", "Greeting given", "fid2", now);
    rows = await readQuestionFailRange(orgId, month, month);
    assertEquals(rows[0].failed, 2);
    assertEquals(rows[0].flippedToPass, 1);
  },
});

Deno.test({
  name: "incrFlipToFail — pass-to-fail bumps the fail count",
  ...kvOpts,
  fn: async () => {
    resetFirestoreCredentials();
    const orgId = uniqueOrg();
    const now = Date.now();
    const month = yyyymm(now);
    await incrFlipToFail(orgId, "ql:Y", "Disclosure check", "fid-pf", now);
    const rows = await readQuestionFailRange(orgId, month, month);
    assertEquals(rows[0].failed, 1);
    assertEquals(rows[0].flippedToFail, 1);
    assert(rows[0].sampleFindingIds.includes("fid-pf"));
  },
});

Deno.test({
  name: "readQuestionFailRange — aggregates across month buckets",
  ...kvOpts,
  fn: async () => {
    resetFirestoreCredentials();
    const orgId = uniqueOrg();
    const now = Date.now();
    const earlier = now - 35 * 86_400_000;
    await incrFailed(orgId, "ql:Z", "Compliance question", "f1", now);
    await incrFailed(orgId, "ql:Z", "Compliance question", "f2", earlier);
    const rows = await readQuestionFailRange(orgId, yyyymm(earlier), yyyymm(now));
    assertEquals(rows.length, 1);
    assertEquals(rows[0].failed, 2);
    assertEquals(rows[0].months.length, 2);
  },
});
