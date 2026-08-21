/** Refresh the local manager-view fixture from PROD (read-only).
 *
 *  Pulls the manager-queue rows for one department plus the finding docs behind
 *  them, and writes fixtures/json/manager-view.json — the file seedManagerFixtures()
 *  loads into the in-memory store on local boot. That path is git-ignored: the
 *  findings carry real call transcripts, so the fixture stays on your machine.
 *
 *  The per-question `snippet` (the whole transcript, repeated on every question)
 *  is dropped for passing questions — 7.4MB → 2.6MB. rawTranscript still carries
 *  the full call, and the report UI falls back to it.
 *
 *  Run from the repo root:
 *    FIREBASE_SA_S3_KEY=credentials/firebase-sa.json \
 *    FIREBASE_PROJECT_ID=keystone-fs97 \
 *    DEFAULT_ORG_ID=<prod org id> \
 *    deno run -A --no-check --config ./deno.json --env-file=./autobottom.env \
 *      fixtures/scripts/pull-manager-view.ts [department] [manager email]
 */
import { getManagerQueue } from "@manager/domain/data/manager-repository/mod.ts";
import { getManagerScope } from "@admin/domain/data/admin-repository/mod.ts";
import { getFinding } from "@audit/domain/data/audit-repository/mod.ts";

const ORG = Deno.env.get("DEFAULT_ORG_ID");
if (!ORG || ORG === "default") {
  console.error("Set DEFAULT_ORG_ID to the prod org id — 'default' reads an empty local store.");
  Deno.exit(1);
}
const DEPARTMENT = Deno.args[0] ?? "VBA PM";
const MANAGER = Deno.args[1] ?? "annab@monsterrg.com";
const OUT = new URL("../json/manager-view.json", import.meta.url);

const all = await getManagerQueue(ORG);
const items = all
  .filter((i) => i.department === DEPARTMENT)
  .sort((a, b) => (a.completedAt ?? a.addedAt ?? 0) - (b.completedAt ?? b.addedAt ?? 0));
const scope = await getManagerScope(ORG, MANAGER);
console.log(`${all.length} queue rows org-wide, ${items.length} in ${DEPARTMENT}; scope ${JSON.stringify(scope)}`);

// One finding at a time, paced — prod wedges under concurrent hydration.
const findings: Record<string, unknown> = {};
for (const item of items) {
  const finding = await getFinding(ORG, item.findingId) as Record<string, unknown> | null;
  if (!finding) { console.warn(`  ${item.findingId} MISSING — skipped`); continue; }
  for (const q of (finding.answeredQuestions ?? []) as Array<Record<string, unknown>>) {
    if (String(q.answer ?? "").trim().toLowerCase() !== "no") delete q.snippet;
  }
  findings[item.findingId] = finding;
  console.log(`  ${item.findingId} ok`);
  await new Promise((r) => setTimeout(r, 300));
}

await Deno.mkdir(new URL("../json/", import.meta.url), { recursive: true });
await Deno.writeTextFile(OUT, JSON.stringify({
  note: `Prod pull, org ${ORG}, department ${DEPARTMENT}, ${new Date().toISOString().slice(0, 10)}. snippet dropped on passing questions.`,
  scope, items, findings,
}));
console.log(`wrote ${OUT.pathname} (${items.length} rows, ${Object.keys(findings).length} findings)`);
