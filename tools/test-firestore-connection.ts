/** Firestore connectivity probe — writes one test doc, leaves it in place.
 *
 *  Hard safety guarantees:
 *    1. Asserts the configured collection is EXACTLY "autobottom" — refuses
 *       to run otherwise. We never touch a different collection (e.g.
 *       "recordings") under any env-var misconfiguration.
 *    2. Writes only — never reads, lists, or deletes anything outside the
 *       single test doc we're creating.
 *    3. Test doc ID is namespaced under type="firestore-connectivity-test"
 *       so it's clearly disposable and won't collide with real data.
 *
 *  Run after uploading the SA JSON + setting FIREBASE_* env vars:
 *    deno run -A --env tools/test-firestore-connection.ts */

import { loadFirestoreCredentials, setStored, getStored } from "@core/data/firestore/mod.ts";

console.log(`🔌 [FS-PROBE] loading Firestore credentials from S3...`);
const creds = await loadFirestoreCredentials();
if (!creds) {
  console.error(`❌ creds came back null — check S3_BUCKET, FIREBASE_SA_S3_KEY, FIREBASE_PROJECT_ID env vars.`);
  Deno.exit(1);
}
console.log(`✓ creds loaded:`);
console.log(`  project    = ${creds.projectId}`);
console.log(`  collection = ${creds.collection}`);
console.log(`  database   = ${creds.databaseId}`);
console.log(`  client     = ${creds.clientEmail}`);

// ── HARD SAFETY: refuse to run against any collection except "autobottom" ──
if (creds.collection !== "autobottom") {
  console.error(`\n❌ ABORT: configured collection is "${creds.collection}", not "autobottom".`);
  console.error(`   This script is hard-coded to refuse any other collection so we`);
  console.error(`   can't accidentally touch the 'recordings' collection or anything else.`);
  console.error(`   If you really meant to use a different collection, edit this script.`);
  Deno.exit(1);
}
console.log(`\n🛡️  [FS-PROBE] safety check passed — collection is "autobottom".`);

const ts = Date.now();
const probeKey = `probe-${ts}`;
const payload = {
  note: "Firestore connectivity probe — safe to leave or delete",
  writtenAt: new Date(ts).toISOString(),
  writtenBy: creds.clientEmail,
  arr: [1, 2, 3],
  nested: { hello: "world", count: 42 },
};

console.log(`\n📝 [FS-PROBE] writing test doc...`);
console.log(`  type = firestore-connectivity-test`);
console.log(`  org  = probe`);
console.log(`  key  = ${probeKey}`);
try {
  await setStored("firestore-connectivity-test", "probe", [probeKey], payload);
  console.log(`✓ write succeeded.`);
} catch (err) {
  console.error(`❌ write failed:`, (err as Error).message);
  console.error(`\nLikely causes:`);
  console.error(`  - Firestore database not created yet (Firebase Console → Build → Firestore Database → Create database)`);
  console.error(`  - Wrong FIREBASE_DATABASE_ID (current: '${creds.databaseId}')`);
  console.error(`  - SA missing Firestore write permission`);
  Deno.exit(1);
}

console.log(`\n📖 [FS-PROBE] reading it back to confirm round-trip...`);
const got = await getStored<typeof payload>("firestore-connectivity-test", "probe", probeKey);
if (!got) {
  console.error(`❌ read returned null — wrote but couldn't read?`);
  Deno.exit(1);
}
if (got.note !== payload.note || got.nested.count !== 42) {
  console.error(`❌ round-trip mismatch:`, got);
  Deno.exit(1);
}
console.log(`✓ round-trip clean.`);

const docId = `firestore-connectivity-test__probe__${probeKey}`;
console.log(`\n✅ [FS-PROBE] done. Test doc is visible at:`);
console.log(``);
console.log(`   Firebase Console → ${creds.projectId} → Firestore Database`);
console.log(`   Collection: autobottom`);
console.log(`   Document ID: ${docId}`);
console.log(``);
console.log(`The doc is left in place — delete it manually from the console whenever you want.`);
