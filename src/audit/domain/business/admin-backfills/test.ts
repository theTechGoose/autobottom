/** Smoke tests for admin-backfills. These functions depend on Deno KV state
 *  and helper modules — full coverage lives in the e2e suite. This file's
 *  purpose is to make sure the module compiles and each entry point is
 *  callable against an empty KV without throwing. */

import { assertEquals } from "#assert";
import {
  backfillReviewScores,
  backfillAuditDoneIndex,
  backfillStaleScores,
  backfillPartnerDimensions,
} from "./mod.ts";

const kvOpts = { sanitizeResources: false, sanitizeOps: false };
const ORG = "test-backfills-" + crypto.randomUUID().slice(0, 8);

Deno.test({ name: "backfillReviewScores — empty org returns 0/0", ...kvOpts, fn: async () => {
  const res = await backfillReviewScores(ORG, 0, Date.now() + 1000);
  assertEquals(res, { scanned: 0, updated: 0 });
}});

Deno.test({ name: "backfillAuditDoneIndex — empty org returns done=true", ...kvOpts, fn: async () => {
  const res = await backfillAuditDoneIndex(ORG);
  assertEquals(res.done, true);
  assertEquals(res.scanned, 0);
}});

Deno.test({ name: "backfillStaleScores — empty org returns done=true", ...kvOpts, fn: async () => {
  const res = await backfillStaleScores(ORG);
  assertEquals(res.done, true);
  assertEquals(res.scanned, 0);
}});

Deno.test({ name: "backfillPartnerDimensions — empty org returns done=true", ...kvOpts, fn: async () => {
  const res = await backfillPartnerDimensions(ORG);
  assertEquals(res.done, true);
  assertEquals(res.scanned, 0);
}});
