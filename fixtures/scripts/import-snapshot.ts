/** Load a snapshot into whatever store the environment points at.
 *
 *  Run it with emulator.env and it fills the Firestore emulator; run it with
 *  prod credentials and it would fill prod, which is why it refuses unless
 *  EMULATOR=true. Documents go back through the same `setStored` /
 *  `setStoredChunked` calls the app itself uses, so chunking, key encoding and
 *  metadata are identical to a document the pipeline wrote.
 *
 *  Also creates the local login accounts. Prod password hashes are deliberately
 *  NOT copied — you would have accounts nobody can sign into. These are made
 *  through `createUser()`, exactly as the admin screen makes them.
 *
 *  Idempotent: re-running overwrites the same documents.
 *
 *    deno task emulator:seed [--shift-weeks]
 */

import { setStored, setStoredChunked } from "@core/data/firestore/mod.ts";
import { createUser, getUser } from "@core/business/auth/mod.ts";
import { isEmulator } from "@core/config/endpoints.ts";

interface SnapshotDoc {
  type: string;
  key: (string | number)[];
  value: Record<string, unknown>;
  chunked?: boolean;
}

interface Snapshot {
  org: string;
  department?: string;
  docs: SnapshotDoc[];
}

if (!isEmulator()) {
  console.error(
    "Refusing to import: EMULATOR is not true, so this would write into prod.\n" +
      "Run `deno task emulator:seed`, which loads emulator.env.",
  );
  Deno.exit(1);
}

const SNAPSHOT = new URL("../json/snapshot.json", import.meta.url).pathname;
const ORG = Deno.env.get("DEFAULT_ORG_ID")!;
const SHIFT = Deno.args.includes("--shift-weeks");

let snapshot: Snapshot;
try {
  snapshot = JSON.parse(await Deno.readTextFile(SNAPSHOT));
} catch {
  console.error(`No snapshot at ${SNAPSHOT}. Pull one first — see fixtures/scripts/pull-snapshot.ts.`);
  Deno.exit(1);
}

if (snapshot.org !== ORG) {
  console.warn(
    `⚠️  snapshot org ${snapshot.org} != DEFAULT_ORG_ID ${ORG}. Importing under ${snapshot.org} ` +
      `so document keys stay identical; set DEFAULT_ORG_ID to match or the app will read a different org.`,
  );
}
const org = snapshot.org;

// ── Optional: slide the whole snapshot forward by whole weeks ───────────────
// Whole weeks, so every audit keeps its weekday and time of day, and the
// Today / This week / Last week presets keep showing data as a snapshot ages.
const WEEK = 7 * 24 * 60 * 60 * 1000;
const TIME_FIELDS = [
  "completedAt", "addedAt", "remediatedAt", "startedAt", "reviewedAt", "ts",
  "emailSentAt", "emailOpenedAt", "assemblyAiSubmittedAt", "createdAt", "doneAt",
];
let shiftMs = 0;
if (SHIFT) {
  const newest = Math.max(
    0,
    ...snapshot.docs.flatMap((d) =>
      TIME_FIELDS.map((f) => Number((d.value as Record<string, unknown>)[f] ?? 0)).filter((n) => n > 0)
    ),
  );
  shiftMs = newest ? Math.round((Date.now() - newest) / WEEK) * WEEK : 0;
}

function shiftValue(value: Record<string, unknown>): Record<string, unknown> {
  if (!shiftMs) return value;
  const out = { ...value };
  for (const f of TIME_FIELDS) {
    if (typeof out[f] === "number" && (out[f] as number) > 0) out[f] = (out[f] as number) + shiftMs;
  }
  return out;
}

/** audit-done-idx encodes the timestamp INTO its key, so a shifted document
 *  must move to the matching key or the window query and the row disagree. */
function shiftKey(doc: SnapshotDoc): (string | number)[] {
  if (!shiftMs || doc.type !== "audit-done-idx") return doc.key;
  const completedAt = Number((doc.value as Record<string, unknown>).completedAt ?? 0);
  if (!completedAt) return doc.key;
  return [String(completedAt + shiftMs).padStart(15, "0"), ...doc.key.slice(1)];
}

// ── Documents ───────────────────────────────────────────────────────────────
const counts: Record<string, number> = {};
for (const doc of snapshot.docs) {
  const value = shiftValue(doc.value);
  const key = shiftKey(doc);
  if (doc.chunked) await setStoredChunked(doc.type, org, key, value);
  else await setStored(doc.type, org, key, value);
  counts[doc.type] = (counts[doc.type] ?? 0) + 1;
}

// ── Local accounts ──────────────────────────────────────────────────────────
const PASSWORD = Deno.env.get("DEV_PASSWORD") ?? "0000";
const ACCOUNTS: Array<{ email: string; role: Parameters<typeof createUser>[3] }> = [
  { email: "admin@local.dev", role: "admin" },
  { email: "manager@local.dev", role: "manager" },
  { email: "judge@local.dev", role: "judge" },
  { email: "reviewer@local.dev", role: "reviewer" },
  { email: "agent@local.dev", role: "user" },
];
for (const account of ACCOUNTS) {
  if (await getUser(org, account.email)) continue;
  await createUser(org, account.email, PASSWORD, account.role);
}

// The imported manager scopes belong to real prod managers. Give the local
// manager the same department so the seeded queue is actually visible.
const scopes = snapshot.docs.filter((d) => d.type === "manager-scope-config");
const departments = snapshot.department ? [snapshot.department] : [];
await setStored("manager-scope-config", org, ["manager@local.dev"], { departments, shifts: [] });

console.log(`\nimported into org ${org}${shiftMs ? ` (dates shifted +${shiftMs / WEEK} week(s))` : ""}`);
for (const [type, n] of Object.entries(counts).sort()) console.log(`  ${type.padEnd(22)} ${n}`);
console.log(`  accounts               ${ACCOUNTS.length} (password "${PASSWORD}")`);
console.log(`  manager scopes         ${scopes.length} from prod + manager@local.dev → ${JSON.stringify(departments)}`);
