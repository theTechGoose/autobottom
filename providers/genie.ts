/** Genie recording provider - fetches recording URLs and downloads audio. */
import { env } from "../env.ts";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Real call recordings are hundreds of KB. Anything under 50KB is junk
// (HTML error pages, empty responses, redirect pages, etc).
const MIN_MEANINGFUL_BYTES = 50_000;

type AccountRole = "primary" | "secondary";

function getAccountId(role: AccountRole): number {
  return Number(role === "primary" ? env.geniePrimaryAccount : env.genieSecondaryAccount);
}

function getHeaders(role: AccountRole): Headers {
  const token = role === "primary" ? env.genieAuth : env.genieAuthTwo;
  return new Headers({
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/x-www-form-urlencoded",
  });
}

function isValidAudio(bytes: Uint8Array): boolean {
  const isId3 = bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
  const isMp3Frame = bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0;
  const isRiff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46; // WAV
  const isOgg = bytes[0] === 0x4F && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53;
  return isId3 || isMp3Frame || isRiff || isOgg;
}

async function searchOnce(contract: number, role: AccountRole): Promise<string | null> {
  const accountId = getAccountId(role);
  try {
    const url = `${env.genieBaseUrl}/api/v1/${accountId}/judge_search.wr?filter_contract=${contract}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    const res = await fetch(url, { headers: getHeaders(role), signal: ctrl.signal }).finally(() => clearTimeout(t));
    if (!res.ok) return null;
    const json = await res.json();
    if (json?.error || !json?.data || !Array.isArray(json.data) || json.data.length === 0) return null;
    const [record] = json.data;
    if (!record?.contract || record.contract === "") return null;
    const src = record?.src as string | undefined;
    if (!src || src === `${env.genieBaseUrl}/` || src.trim() === "") return null;
    return src;
  } catch (err) {
    console.error(`[GENIE] 🔍 search error: role=${role} contract=${contract}`, err);
    return null;
  }
}

async function searchWithRetry(contract: number, role: AccountRole, maxAttempts = 5, delayMs = 2000): Promise<string | null> {
  for (let i = 1; i <= maxAttempts; i++) {
    const src = await searchOnce(contract, role);
    if (src) return src;
    if (i < maxAttempts) await sleep(delayMs);
  }
  return null;
}

async function downloadWithRetry(
  src: string,
  role: AccountRole,
  contract: number,
  maxAttempts = 3,
  delayMs = 2000,
): Promise<Uint8Array> {
  let lastError: unknown;
  console.log(`[GENIE] ⬇️ download start: contract=${contract} role=${role} src=${src}`);

  for (let i = 1; i <= maxAttempts; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 120_000);
      const res = await fetch(src, { headers: getHeaders(role), signal: ctrl.signal }).finally(() => clearTimeout(t));
      const contentType = res.headers.get("content-type") ?? "(none)";

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      if (contentType.includes("text/html") || contentType.includes("text/plain")) {
        throw new Error(`DEAD_URL: non-audio content-type: ${contentType}`);
      }

      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);

      if (bytes.byteLength < 1024) {
        throw new Error(`DEAD_URL: payload only ${bytes.byteLength} bytes`);
      }
      if (bytes.byteLength < MIN_MEANINGFUL_BYTES) {
        throw new Error(`DEAD_URL: file is ${bytes.byteLength} bytes (< ${MIN_MEANINGFUL_BYTES} min)`);
      }
      if (!isValidAudio(bytes)) {
        throw new Error(`DEAD_URL: invalid magic bytes 0x${bytes[0].toString(16).padStart(2, "0")} (size: ${bytes.byteLength})`);
      }

      console.log(`[GENIE] ✅ download ok: contract=${contract} role=${role} bytes=${bytes.byteLength}`);
      return bytes;
    } catch (err) {
      lastError = err;
      const msg = String(err);
      if (msg.includes("DEAD_URL")) {
        console.warn(`[GENIE] ❌ dead url — cascading: contract=${contract} role=${role} error=${msg}`);
        throw new Error(`Dead URL — cascade. ${msg}`);
      }
      console.warn(`[GENIE] ⚠️ download attempt ${i}/${maxAttempts} failed: contract=${contract} role=${role}`, err);
      if (i < maxAttempts) await sleep(delayMs);
    }
  }
  throw new Error(`Genie download failed after ${maxAttempts} attempts. Last: ${String(lastError)}`);
}

async function tryStrategy(role: AccountRole, contract: number, tag: string): Promise<Uint8Array | null> {
  console.log(`[GENIE] 🚀 strategy: static-${role} contract=${contract} ${tag}`);
  const src = await searchWithRetry(contract, role);
  if (!src) {
    console.warn(`[GENIE] ❌ no src found: role=${role} contract=${contract}`);
    return null;
  }
  try {
    return await downloadWithRetry(src, role, contract);
  } catch (err) {
    console.warn(`[GENIE] ❌ strategy failed: role=${role} contract=${contract}`, err);
    return null;
  }
}

/** Find recording and download bytes. Returns bytes or null if not found.
 *
 *  Strategy cascade (in order):
 *  1. static-primary   — Bearer token, primary account
 *  2. static-secondary — Bearer token, secondary account
 */
export async function downloadRecording(genieId: number, findingId?: string): Promise<Uint8Array | null> {
  const tag = findingId ?? String(genieId);
  console.log(`[GENIE] 🚀 download begin: contract=${genieId} ${tag}`);

  for (const role of ["primary", "secondary"] as AccountRole[]) {
    const bytes = await tryStrategy(role, genieId, tag);
    if (bytes) return bytes;
    console.log(`[GENIE] ⚠️ ${role} failed, trying next...`);
  }

  console.error(`[GENIE] ❌ all strategies exhausted: contract=${genieId}`);
  return null;
}

/** Get just the recording URL without downloading. */
export async function getRecordingUrl(genieId: number): Promise<string | null> {
  const primarySrc = await searchWithRetry(genieId, "primary");
  if (primarySrc) return primarySrc;
  return searchWithRetry(genieId, "secondary");
}
