/** Every external service address, resolved in ONE place.
 *
 *  This module exists so dev and prod run the same code. A client module must
 *  never ask "am I local?" — it asks this file for a base URL and then makes
 *  the identical request it makes in prod: same signing, same headers, same
 *  parsing, same error handling. The only thing that changes is where the
 *  request lands.
 *
 *  `EMULATOR=true` points the stateful services at local stand-ins (the
 *  official Firestore emulator plus the small ones under tools/emulators/).
 *  Unset — the default — every address is the real one, which means a local
 *  run reads AND writes prod: real Firestore documents, real email, real
 *  queue. That is deliberate; the flag is the only thing separating them.
 *
 *  AI services (Groq, OpenAI, AssemblyAI) are deliberately absent: they are
 *  stateless and are called live in both modes, so nothing here overrides
 *  them. Audio reaches AssemblyAI as uploaded bytes, not as a URL, so live
 *  transcription works against a local recording too.
 *
 *  IMPORTANT: `EMULATOR` must be read here and nowhere else. A branch on it
 *  anywhere in business logic is exactly the drift this module removes. */

/** Loopback rather than "localhost" — Deno resolves the name to ::1 first on
 *  some machines, and the emulators bind IPv4. */
const HOST = "127.0.0.1";

export const EMULATOR_PORTS = {
  firestore: 8099, // official Firebase emulator (8080 is often taken)
  s3: 9001,
  qstash: 9002,
  google: 9003, // OAuth token exchange + Sheets
  replay: 9004, // QuickBase + Genie record/replay
  pinecone: 9005,
  postmark: 9006,
} as const;

export function isEmulator(): boolean {
  return Deno.env.get("EMULATOR") === "true";
}

/** Refuse to boot an emulator-mode process on Deno Deploy. Emulator mode
 *  points at loopback addresses that do not exist there, so this would fail
 *  anyway — but it would fail one confusing request at a time instead of
 *  once, loudly, at startup. */
export function assertEmulatorNotOnDeploy(): void {
  if (isEmulator() && Deno.env.get("DENO_DEPLOYMENT_ID")) {
    throw new Error(
      "EMULATOR=true on a Deno Deploy deployment — refusing to boot. " +
        "Emulator mode is for local development only.",
    );
  }
}

function emulatorOrigin(port: number): string {
  return `http://${HOST}:${port}`;
}

// ── Google ──────────────────────────────────────────────────────────────────

/** Firestore REST root, including the version segment. */
export function firestoreBaseUrl(): string {
  return isEmulator()
    ? `${emulatorOrigin(EMULATOR_PORTS.firestore)}/v1`
    : "https://firestore.googleapis.com/v1";
}

/** Service-account token exchange. The emulator ignores the bearer token it
 *  is handed, but we still mint one: the signing path is production code and
 *  gets exercised on every local boot. */
export function googleTokenUrl(): string {
  return isEmulator()
    ? `${emulatorOrigin(EMULATOR_PORTS.google)}/token`
    : "https://oauth2.googleapis.com/token";
}

export function sheetsBaseUrl(): string {
  return isEmulator()
    ? `${emulatorOrigin(EMULATOR_PORTS.google)}/v4`
    : "https://sheets.googleapis.com/v4";
}

// ── AWS ─────────────────────────────────────────────────────────────────────

/** Final URL for a signed S3 object request. `encodedKey` arrives with its
 *  leading slash, already percent-encoded by the signer.
 *
 *  Real S3 is virtual-host style (bucket in the hostname); the local stand-in
 *  is path style (bucket as the first path segment) so one process can serve
 *  every bucket. The SigV4 signature is computed identically either way — the
 *  stand-in ignores it, exactly as the Firestore emulator ignores auth. */
export function s3ObjectUrl(bucket: string, region: string, encodedKey: string): string {
  return isEmulator()
    ? `${emulatorOrigin(EMULATOR_PORTS.s3)}/${bucket}${encodedKey}`
    : `https://${bucket}.s3.${region}.amazonaws.com${encodedKey}`;
}

// ── Everything else ─────────────────────────────────────────────────────────

export function postmarkUrl(): string {
  return isEmulator()
    ? `${emulatorOrigin(EMULATOR_PORTS.postmark)}/email`
    : "https://api.postmarkapp.com/email";
}

export function quickbaseBaseUrl(): string {
  return isEmulator()
    ? `${emulatorOrigin(EMULATOR_PORTS.replay)}/quickbase/v1`
    : "https://api.quickbase.com/v1";
}

export function genieBaseUrl(): string {
  const configured = Deno.env.get("GENIE_BASE_URL") ?? "";
  return isEmulator() ? `${emulatorOrigin(EMULATOR_PORTS.replay)}/genie` : configured;
}

export function qstashBaseUrl(): string {
  return isEmulator()
    ? emulatorOrigin(EMULATOR_PORTS.qstash)
    : (Deno.env.get("QSTASH_URL") ?? "https://qstash.upstash.io");
}

export function pineconeControlUrl(): string {
  return isEmulator()
    ? `${emulatorOrigin(EMULATOR_PORTS.pinecone)}/control`
    : "https://api.pinecone.io";
}

/** Pinecone data-plane calls address the index's own host, which the control
 *  plane hands back. In emulator mode that host is ours, so route it home. */
export function pineconeDataUrl(indexHost: string): string {
  return isEmulator()
    ? `${emulatorOrigin(EMULATOR_PORTS.pinecone)}/data`
    : `https://${indexHost}`;
}
