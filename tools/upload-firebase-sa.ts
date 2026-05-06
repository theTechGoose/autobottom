/** One-shot S3 uploader for the Firebase service-account JSON.
 *
 *  Reuses the project's S3 client (sigv4, no AWS SDK), so the same env vars
 *  the rest of the app uses also drive this script. No extra credentials.
 *
 *  ── Usage ──────────────────────────────────────────────────────────────────
 *
 *    deno run -A --env tools/upload-firebase-sa.ts <local-path> [s3-key]
 *
 *    - <local-path>: path to the SA JSON you downloaded from Firebase
 *    - [s3-key]:     S3 object key, default `credentials/firebase-sa.json`
 *
 *  Required env (already in your .env for the rest of the app):
 *    S3_BUCKET (or AWS_S3_BUCKET)
 *    AWS_ACCESS_KEY_ID
 *    AWS_SECRET_ACCESS_KEY
 *    AWS_REGION
 *
 *  What it does:
 *    1. Reads the local JSON
 *    2. Asserts it has `client_email` + `private_key` (catches "wrong file")
 *    3. PUTs to s3://<bucket>/<s3-key>
 *    4. GETs it back and confirms a round-trip
 *    5. Prints the env-var values you should set: FIREBASE_SA_S3_KEY +
 *       FIREBASE_PROJECT_ID  */

import { S3Ref } from "@core/data/s3/mod.ts";

const args = Deno.args;
if (args.length < 1) {
  console.error("Usage: deno run -A --env tools/upload-firebase-sa.ts <local-path> [s3-key]");
  Deno.exit(1);
}
const localPath = args[0];
const s3Key = args[1] ?? "credentials/firebase-sa.json";

const bucket = Deno.env.get("S3_BUCKET") ?? Deno.env.get("AWS_S3_BUCKET") ?? "";
if (!bucket) {
  console.error("❌ S3_BUCKET (or AWS_S3_BUCKET) env var not set.");
  Deno.exit(1);
}
if (!Deno.env.get("AWS_ACCESS_KEY_ID") || !Deno.env.get("AWS_SECRET_ACCESS_KEY")) {
  console.error("❌ AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY env vars not set.");
  Deno.exit(1);
}

console.log(`📂 [SA-UPLOAD] reading ${localPath}...`);
let bytes: Uint8Array;
try {
  bytes = await Deno.readFile(localPath);
} catch (err) {
  console.error(`❌ failed to read ${localPath}:`, err);
  Deno.exit(1);
}

let parsed: { client_email?: string; private_key?: string; project_id?: string };
try {
  parsed = JSON.parse(new TextDecoder().decode(bytes));
} catch (err) {
  console.error(`❌ ${localPath} is not valid JSON:`, err);
  Deno.exit(1);
}

if (!parsed.client_email || !parsed.private_key) {
  console.error(`❌ ${localPath} is missing client_email / private_key — wrong file?`);
  Deno.exit(1);
}

console.log(`✓ valid SA: client_email=${parsed.client_email}`);
console.log(`📤 [SA-UPLOAD] uploading to s3://${bucket}/${s3Key} (${bytes.byteLength} bytes)...`);

const ref = new S3Ref(bucket, s3Key);
try {
  await ref.save(bytes);
} catch (err) {
  console.error(`❌ S3 upload failed:`, err);
  Deno.exit(1);
}

console.log(`✓ uploaded.`);
console.log(`🔁 [SA-UPLOAD] verifying round-trip...`);

const read = await ref.get();
if (!read || read.byteLength !== bytes.byteLength) {
  console.error(`❌ round-trip verify failed: expected ${bytes.byteLength} bytes, got ${read?.byteLength ?? 0}`);
  Deno.exit(1);
}

console.log(`✅ [SA-UPLOAD] done. Set these env vars:\n`);
console.log(`    FIREBASE_PROJECT_ID=${parsed.project_id ?? "<MISSING — copy from JSON>"}`);
console.log(`    FIREBASE_SA_S3_KEY=${s3Key}`);
console.log(``);
console.log(`Optional, only if your Firestore database ID isn't '(default)':`);
console.log(`    FIREBASE_DATABASE_ID=<your-db-id>`);
console.log(``);
console.log(`Optional, only if you want a different collection name than 'autobottom':`);
console.log(`    FIREBASE_COLLECTION=<collection-name>`);
