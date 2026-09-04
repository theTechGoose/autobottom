/** Pull findings whose QuickBase date-leg carried MORE THAN ONE genie number
 *  (READ ONLY) into fixtures/mutliple-genies/.
 *
 *  A multi-genie audit can arise two ways and they look identical on the
 *  finding's `genieIds`:
 *
 *    QuickBase field   a human typed several numbers into the date leg's
 *                      "VO Genie #" field (fid 145), so the RAW record value
 *                      `record[recordingIdField]` contains a comma.
 *    re-audit chain    a re-recording appeal added a leg; the record is copied
 *                      from the original, so its raw field is untouched and
 *                      `appealSourceFindingId` is set.
 *
 *  Only the FIRST kind is written here — that is what "comes from quickbase
 *  directly" means. Re-audit chains are counted and reported, not saved.
 *
 *  Scan is cheap: completed-audit-stat rows carry a comma-joined `genies`
 *  field, so the fat finding docs (~282 KB each) are only fetched for rows
 *  that already look multi-genie.
 *
 *  Usage, from the repo root:
 *    FIREBASE_SA_S3_KEY=credentials/firebase-sa.json \
 *    FIREBASE_PROJECT_ID=keystone-fs97 \
 *    DEFAULT_ORG_ID=<prod org id> \
 *    deno run -A --no-check --unstable-kv --config ./deno.json \
 *      --env-file=./autobottom.env \
 *      fixtures/scripts/pull-multi-genie.ts [--days 90] [--max 50]
 *
 *  No emulator.env: this reads prod. It never writes to prod. */

import { listStoredByCompletedAt } from "@core/data/firestore/mod.ts";
import { getFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { splitGenieIds } from "@core/business/genie-ids/mod.ts";

const ORG = Deno.env.get("DEFAULT_ORG_ID") ?? "";
const OUT_DIR = new URL("../mutliple-genies/", import.meta.url).pathname;

function argOf(name: string, fallback: number): number {
  const i = Deno.args.indexOf(`--${name}`);
  const v = i >= 0 ? Number(Deno.args[i + 1]) : NaN;
  return Number.isFinite(v) ? v : fallback;
}

const DAYS = argOf("days", 90);
const MAX = argOf("max", 50);
/** How many full finding docs (~282 KB each) to write to disk. Every
 *  qualifying finding is always listed in index.json; this only caps the fat
 *  copies, so a wide scan doesn't dump hundreds of megabytes into the repo. */
const SAVE = argOf("save", MAX);
const outArg = Deno.args.indexOf("--out");
const DIR = outArg >= 0 ? Deno.args[outArg + 1].replace(/\/?$/, "/") : OUT_DIR;

if (!ORG || ORG === "default") {
  console.error("Set DEFAULT_ORG_ID to the prod org id.");
  Deno.exit(1);
}

interface CompletedStat {
  findingId?: string;
  genies?: string;
  ts?: number;
  score?: number;
  department?: string;
  voName?: string;
  recordId?: string;
  isPackage?: boolean;
}

/** The raw QuickBase value for the recording-number field, before the app
 *  split it into genieIds. Commas here mean QuickBase itself held several. */
function rawGenieField(finding: Record<string, any>): string {
  const field = String(finding.recordingIdField ?? "VoGenie");
  return String(finding.record?.[field] ?? "");
}

const now = Date.now();
const since = now - DAYS * 24 * 60 * 60 * 1000;

console.log(`Scanning completed-audit-stat for the last ${DAYS} days...`);
const stats = await listStoredByCompletedAt<CompletedStat>(
  "completed-audit-stat",
  ORG,
  since,
  now,
  { fieldName: "ts", limit: 80000 },
);
console.log(`  ${stats.length} completed rows`);

const candidates = stats.filter((s) => (s.genies ?? "").includes(","));
console.log(`  ${candidates.length} carry more than one genie`);

await Deno.mkdir(DIR, { recursive: true });

const saved: Array<Record<string, unknown>> = [];
let reaudits = 0;
let missing = 0;

let scanned = 0;
for (const stat of candidates) {
  if (scanned >= MAX) break;
  scanned++;
  const findingId = stat.findingId;
  if (!findingId) continue;

  const finding = await getFinding(ORG, findingId, { cache: false });
  if (!finding) {
    missing++;
    continue;
  }

  const raw = rawGenieField(finding);
  const fromQuickbase = splitGenieIds(raw).length > 1;
  if (!fromQuickbase) {
    reaudits++;
    continue;
  }

  let bytes = 0;
  if (saved.length < SAVE) {
    const file = `${DIR}${findingId}.json`;
    await Deno.writeTextFile(file, JSON.stringify(finding, null, 2));
    bytes = (await Deno.stat(file)).size;
  }
  saved.push({
    findingId,
    recordId: String(finding.record?.RecordId ?? ""),
    recordingIdField: String(finding.recordingIdField ?? ""),
    rawGenieField: raw,
    genieIds: finding.genieIds ?? [],
    legs: (finding.s3RecordingKeys ?? []).length,
    score: stat.score,
    department: stat.department,
    voName: stat.voName,
    completedAt: stat.ts,
    isReaudit: !!finding.appealSourceFindingId,
    bytes,
  });
  console.log(`  saved ${findingId} — raw "${raw}" → ${JSON.stringify(finding.genieIds ?? [])}`);
}

await Deno.writeTextFile(
  `${DIR}index.json`,
  JSON.stringify({
    generatedAt: new Date(now).toISOString(),
    windowDays: DAYS,
    completedRowsScanned: stats.length,
    multiGenieRows: candidates.length,
    candidatesInspected: scanned,
    fromQuickbaseField: saved.length,
    reauditChainsSkipped: reaudits,
    findingDocMissing: missing,
    findings: saved,
  }, null, 2),
);

console.log(
  `\nDone. ${saved.length} QuickBase multi-genie findings written to fixtures/mutliple-genies/ ` +
  `(${reaudits} re-audit chains skipped, ${missing} finding docs missing).`,
);
