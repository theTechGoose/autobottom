/** Shape-only test for getAuditHistory — keeps the feature folder spec-compliant
 *  (every business/<feature>/ must have mod.ts + test.ts).
 *
 *  The real coverage is integration-shaped (queries audit-done-idx, hydrates from
 *  Firestore, joins reviewed/appeal state, scopes by manager dept/shift), which
 *  belongs in an int.test.ts when we add one. This file pins the exported surface
 *  so renames or signature drift fail fast. */
import { assert } from "#assert";
import { getAuditHistory } from "./mod.ts";

Deno.test("audit-history — getAuditHistory is exported and callable", () => {
  assert(typeof getAuditHistory === "function");
});
