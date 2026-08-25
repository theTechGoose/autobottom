/** Export a slice of prod into a snapshot file (READ ONLY).
 *
 *  Takes one department's remediation queue and pulls EVERY document the app
 *  reads for those audits — not just the queue rows. That is the difference
 *  between a manager portal that renders and one where the queue works but
 *  Audit History, the team page and the report views all come back empty:
 *
 *    manager-queue        the queue rows themselves
 *    audit-finding        the audit, chunked exactly as prod stores it
 *    audit-done-idx       what Audit History and the reports read
 *    failed-finding-idx   the per-question failure rows
 *    review-done          reviewer decisions
 *    appeal               judge appeals
 *    completed-audit-stat dashboard counters
 *    manager-scope-config which departments each manager owns
 *
 *  Writes fixtures/json/snapshot.json (git-ignored — real transcripts).
 *  Recordings come along as files under fixtures/json/emulator/s3/ when
 *  --recordings is passed, so local playback and live transcription work.
 *
 *  Usage, from the repo root:
 *    FIREBASE_SA_S3_KEY=credentials/firebase-sa.json \
 *    FIREBASE_PROJECT_ID=keystone-fs97 \
 *    DEFAULT_ORG_ID=<prod org id> \
 *    deno run -A --no-check --unstable-kv --config ./deno.json \
 *      --env-file=./autobottom.env \
 *      fixtures/scripts/pull-snapshot.ts "VBA PM" [--recordings]
 *
 *  Note the ABSENCE of emulator.env: this reads prod, so it must run with prod
 *  addresses. Importing goes the other way — see import-snapshot.ts. */

import {
  getStored,
  listStored,
  listStoredByCompletedAtWithKeys,
  listStoredByKeyPrefix,
  listStoredWithKeys,
} from "@core/data/firestore/mod.ts";
import { getFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { S3Ref } from "@core/data/s3/mod.ts";

interface SnapshotDoc {
  type: string;
  key: (string | number)[];
  value: unknown;
  /** audit-finding is written with setStoredChunked; replay it the same way. */
  chunked?: boolean;
}

const ORG = Deno.env.get("DEFAULT_ORG_ID") ?? "";
const DEPARTMENT = Deno.args.find((a) => !a.startsWith("--")) ?? "VBA PM";
const WITH_RECORDINGS = Deno.args.includes("--recordings");
const OUT = new URL("../json/snapshot.json", import.meta.url).pathname;
const S3_OUT = new URL("../json/emulator/s3/", import.meta.url).pathname;

if (!ORG || ORG === "default") {
  console.error("Set DEFAULT_ORG_ID to the prod org id.");
  Deno.exit(1);
}

const pace = () => new Promise((r) => setTimeout(r, 250));

const docs: SnapshotDoc[] = [];
const add = (type: string, key: (string | number)[], value: unknown, chunked = false) => {
  if (value != null) docs.push({ type, key, value, chunked });
};

// ── The queue rows drive everything else ────────────────────────────────────
const queue = (await listStored<Record<string, unknown>>("manager-queue", ORG))
  .filter((i) => i.department === DEPARTMENT);
console.log(`manager-queue: ${queue.length} rows in ${DEPARTMENT}`);
for (const item of queue) add("manager-queue", [String(item.findingId)], item);

// ── Everything each audit needs ─────────────────────────────────────────────
// completed-audit-stat is one of the biggest collections in prod, so pull it
// by window rather than listing the type (a plain list caps at 1000 rows and
// would miss the very audits we are exporting).
const HOUR = 60 * 60 * 1000;

/** One index row for one audit, found by scanning a tight window around it.
 *
 *  These collections are keyed by timestamp, not by findingId, so we search
 *  rather than compute the key — and never scan the whole range, because prod
 *  pages cap at 5000 rows and would silently drop what we came for.
 *
 *  Two candidate timestamps, because they genuinely disagree: an audit-done-idx
 *  row carries the REVIEW-finalize time (same as the queue row), while the
 *  finding carries the time the audit ran. On this data set they sit ~17 hours
 *  apart, so a window around the wrong one finds nothing. */
async function indexRowFor(
  type: string, fieldName: string, findingId: string, candidates: number[],
): Promise<{ key: string[]; value: unknown } | null> {
  for (const around of candidates.filter((n) => n > 0)) {
    const rows = await listStoredByCompletedAtWithKeys<{ findingId?: string }>(
      type, ORG, around - 12 * HOUR, around + 12 * HOUR, { fieldName },
    );
    const hit = rows.find((r) => r.value.findingId === findingId);
    if (hit) return hit;
  }
  return null;
}

for (const item of queue) {
  const findingId = String(item.findingId);
  const finding = await getFinding(ORG, findingId) as Record<string, unknown> | null;
  if (!finding) {
    console.warn(`  ${findingId}: finding missing — skipped`);
    continue;
  }

  // The per-question `snippet` repeats the whole transcript on every question.
  // rawTranscript already carries it and the report UI falls back to that, so
  // keep snippets only where a manager actually reads them: failed questions.
  for (const q of (finding.answeredQuestions ?? []) as Array<Record<string, unknown>>) {
    if (String(q.answer ?? "").trim().toLowerCase() !== "no") delete q.snippet;
  }
  add("audit-finding", [findingId], finding, true);

  const times = [Number(item.completedAt ?? 0), Number(finding.completedAt ?? 0)];
  const done = await indexRowFor("audit-done-idx", "completedAt", findingId, times);
  if (done) add("audit-done-idx", done.key, done.value);
  else console.warn(`  ${findingId}: no audit-done-idx row — Audit History will not show it`);
  const stat = await indexRowFor("completed-audit-stat", "ts", findingId, times);
  if (stat) add("completed-audit-stat", stat.key, stat.value);
  add("review-done", [findingId], await getStored("review-done", ORG, findingId));
  add("appeal", [findingId], await getStored("appeal", ORG, findingId));

  for (const row of await listStoredByKeyPrefix<unknown>("failed-finding-idx", ORG, findingId)) {
    add("failed-finding-idx", row.key, row.value);
  }

  if (WITH_RECORDINGS) {
    const keys = [
      ...(finding.s3RecordingKeys as string[] ?? []),
      ...(finding.s3RecordingKey ? [finding.s3RecordingKey as string] : []),
    ];
    for (const key of keys) {
      const path = `${S3_OUT}autobottom-emulator/${key}`;
      try {
        await Deno.stat(path);
        continue; // already downloaded
      } catch { /* fetch it */ }
      const bytes = await new S3Ref(Deno.env.get("S3_BUCKET")!, key).get();
      if (!bytes) continue;
      await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
      await Deno.writeFile(path, bytes);
      console.log(`  recording ${key} (${Math.round(bytes.length / 1024)}KB)`);
    }
  }

  console.log(`  ${findingId} ok`);
  await pace(); // prod wedges under concurrent hydration — stay single file
}

// ── Manager scopes: without these the queue renders empty for every manager ──
for (const { key, value } of await listStoredWithKeys<unknown>("manager-scope-config", ORG)) {
  add("manager-scope-config", key, value);
}

await Deno.writeTextFile(OUT, JSON.stringify({
  note: `Prod snapshot, org ${ORG}, department ${DEPARTMENT}, ${new Date().toISOString().slice(0, 10)}`,
  org: ORG,
  department: DEPARTMENT,
  docs,
}));

const byType = docs.reduce<Record<string, number>>((acc, d) => {
  acc[d.type] = (acc[d.type] ?? 0) + 1;
  return acc;
}, {});
console.log(`\nwrote ${OUT}`);
for (const [type, n] of Object.entries(byType).sort()) console.log(`  ${type.padEnd(22)} ${n}`);
