/** The single source of truth for reading genie IDs out of a raw record field.
 *
 *  QuickBase's "VO Genie #" (date legs) and "Genie Number" (packages) are free
 *  text a human types, so two recordings arrive glued together by whatever
 *  separator was at hand — "27660806,27660810", "27660806; 27660810",
 *  "27660806 / 27660810" — sometimes with a note stuck on the end
 *  ("27475188-error").
 *
 *  A genie ID is digits and nothing else, so the rule that survives all of
 *  that is: every RUN OF DIGITS in the field is one genie ID, and whatever
 *  sits between the runs is a separator. Splitting on a comma alone let a
 *  semicolon field stay one string, which then got trimmed at the first
 *  non-digit — the audit silently graded only the first call.
 *
 *  Every place that turns a raw field into IDs goes through here: the QB
 *  client (`quickbase/mod.ts`), ingest (`entrypoints/audit/mod.ts`) and the
 *  download step (`step-init/mod.ts`). Re-audits are NOT in that list: they
 *  are handed an already-split array by the caller. */

/** Every genie ID in a raw field, in the order they appear. Empty when the
 *  field holds no digits at all. */
export function splitGenieIds(raw: unknown): string[] {
  return String(raw ?? "").match(/\d+/g) ?? [];
}

/** The first genie ID in a raw field, or "" when it holds none. Use this
 *  wherever a single recording is expected — it drops a trailing note the same
 *  way the old trim-at-first-non-digit did. */
export function firstGenieId(raw: unknown): string {
  return splitGenieIds(raw)[0] ?? "";
}
