/** Emulator runner — one command that stands up every local service.
 *
 *  Starts the official Firestore emulator (a child process; needs Java) plus
 *  the small in-repo stand-ins for S3, Google token/Sheets, QStash, Postmark,
 *  Pinecone, and the QuickBase/Genie record-replay proxy.
 *
 *  Also plants the dummy Firebase service account in the local S3 store, with
 *  a real RSA key, so the app's credential path runs unchanged: fetch the SA
 *  from S3 → sign a JWT → exchange it for a token → call Firestore. Every step
 *  is production code; only the addresses are local.
 *
 *  Firestore data is imported from and exported to fixtures/json/emulator/
 *  firestore, so a seeded database survives restarts. */

import { EMULATOR_PORTS } from "@core/config/endpoints.ts";
import { startS3, S3_ROOT } from "./s3.ts";
import { startGoogle } from "./google.ts";
import { startQStash } from "./qstash.ts";
import { startPostmark } from "./postmark.ts";
import { startPinecone } from "./pinecone.ts";
import { startReplay } from "./replay.ts";

const FIRESTORE_DATA = new URL("../../fixtures/json/emulator/firestore/", import.meta.url).pathname;

function pemEncode(der: ArrayBuffer): string {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  const lines = b64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n`;
}

/** Write the fake service account into the local S3 bucket, once. The key is
 *  real — the app signs a genuine RS256 JWT with it, and the token stub
 *  accepts it. Regenerating on every boot would be fine too; we keep it
 *  stable so recorded traffic stays comparable. */
async function ensureServiceAccount(): Promise<void> {
  const bucket = Deno.env.get("S3_BUCKET") ?? "autobottom-emulator";
  const key = Deno.env.get("FIREBASE_SA_S3_KEY") ?? "credentials/firebase-sa.json";
  const path = `${S3_ROOT}${bucket}/${key}`;
  try {
    await Deno.stat(path);
    return;
  } catch { /* create it */ }

  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  ) as CryptoKeyPair;
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const sa = {
    type: "service_account",
    project_id: Deno.env.get("FIREBASE_PROJECT_ID") ?? "autobottom-emulator",
    private_key: pemEncode(pkcs8),
    client_email: "emulator@autobottom.local",
    token_uri: "https://oauth2.googleapis.com/token",
  };
  await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  await Deno.writeTextFile(path, JSON.stringify(sa, null, 2));
  console.log(`🔐 [EMULATOR] generated service account at ${bucket}/${key}`);
}

function javaPath(): string | null {
  for (const candidate of ["/opt/homebrew/opt/openjdk/bin", "/usr/local/opt/openjdk/bin"]) {
    try {
      Deno.statSync(`${candidate}/java`);
      return candidate;
    } catch { /* try next */ }
  }
  return null;
}

async function startFirestore(): Promise<Deno.ChildProcess> {
  await Deno.mkdir(FIRESTORE_DATA, { recursive: true });
  const extraPath = javaPath();
  const env: Record<string, string> = {};
  if (extraPath) env.PATH = `${extraPath}:${Deno.env.get("PATH") ?? ""}`;

  const cmd = new Deno.Command("firebase", {
    args: [
      "emulators:start",
      "--only", "firestore",
      "--project", Deno.env.get("FIREBASE_PROJECT_ID") ?? "autobottom-emulator",
      "--import", FIRESTORE_DATA,
      "--export-on-exit", FIRESTORE_DATA,
    ],
    env,
    stdout: "inherit",
    stderr: "inherit",
  });
  return cmd.spawn();
}

/** Poll the Firestore emulator until it answers, so callers can seed straight after. */
async function waitForFirestore(timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const url = `http://127.0.0.1:${EMULATOR_PORTS.firestore}/`;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      await res.body?.cancel();
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return false;
}

if (import.meta.main) {
  await ensureServiceAccount();

  startS3();
  startGoogle();
  startQStash();
  startPostmark();
  startPinecone();
  startReplay();

  const firestore = await startFirestore();
  const up = await waitForFirestore();

  console.log(`
🧪 Emulators up${up ? "" : "  ⚠️ Firestore did not answer — is Java installed?"}
   firestore  :${EMULATOR_PORTS.firestore}   (official Firebase emulator)
   s3         :${EMULATOR_PORTS.s3}
   qstash     :${EMULATOR_PORTS.qstash}
   google     :${EMULATOR_PORTS.google}   (token + sheets)
   replay     :${EMULATOR_PORTS.replay}   (quickbase + genie)
   pinecone   :${EMULATOR_PORTS.pinecone}
   postmark   :${EMULATOR_PORTS.postmark}   mailbox → http://127.0.0.1:${EMULATOR_PORTS.postmark}/
`);

  const shutdown = () => {
    try { firestore.kill("SIGINT"); } catch { /* already gone */ }
  };
  Deno.addSignalListener("SIGINT", () => { shutdown(); Deno.exit(0); });
  Deno.addSignalListener("SIGTERM", () => { shutdown(); Deno.exit(0); });
  await firestore.status;
}

export { startFirestore, waitForFirestore };
