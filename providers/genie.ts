/** Genie recording provider - fetches recording URLs and downloads audio. */
import { env } from "../env.ts";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type AccountId = 9152 | 9054;

function getHeaders(accountId: AccountId): Headers {
  const token = accountId === 9152
    ? Deno.env.get("GENIE_AUTH")!
    : Deno.env.get("GENIE_AUTH_TWO")!;
  return new Headers({
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/x-www-form-urlencoded",
  });
}

async function tryAccountOnce(contract: number, accountId: AccountId): Promise<string | null> {
  try {
    const url = `${env.genieBaseUrl}/api/v1/${accountId}/judge_search.wr?filter_contract=${contract}`;
    const res = await fetch(url, { headers: getHeaders(accountId) });
    if (!res.ok) return null;
    const json = await res.json();
    if (json?.error || !json?.data || !Array.isArray(json.data) || json.data.length === 0) return null;
    const [record] = json.data;
    if (!record?.contract || record.contract === "") return null;
    const src = record?.src as string | undefined;
    if (!src || src === `${env.genieBaseUrl}/` || src.trim() === "") return null;
    return src;
  } catch (err) {
    console.error(`[GENIE] tryAccountOnce error: accountId=${accountId} contract=${contract}`, err);
    return null;
  }
}

async function tryWithRetry(contract: number, accountId: AccountId, maxAttempts = 5, delayMs = 2000): Promise<string | null> {
  for (let i = 1; i <= maxAttempts; i++) {
    const src = await tryAccountOnce(contract, accountId);
    if (src) return src;
    if (i < maxAttempts) await sleep(delayMs);
  }
  return null;
}

async function downloadRecordingData(src: string, accountId: AccountId, contract: number, maxAttempts = 3, delayMs = 2000): Promise<Uint8Array> {
  let lastError: unknown;
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      const res = await fetch(src, { headers: getHeaders(accountId) });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);
      if (bytes.byteLength < 1024) throw new Error(`Payload too small: ${bytes.byteLength} bytes`);
      return bytes;
    } catch (err) {
      lastError = err;
      console.warn(`[GENIE] download attempt ${i} failed: contract=${contract} accountId=${accountId}`, err);
      if (i < maxAttempts) await sleep(delayMs);
    }
  }
  throw new Error(`Genie download failed after ${maxAttempts} attempts. Last: ${String(lastError)}`);
}

/** Find recording URL and download bytes. Returns bytes or null if not found. */
export async function downloadRecording(genieId: number): Promise<Uint8Array | null> {
  // Strategy 1: Primary account (9152)
  const primarySrc = await tryWithRetry(genieId, 9152);
  if (primarySrc) {
    try {
      const bytes = await downloadRecordingData(primarySrc, 9152, genieId);
      console.log(`[GENIE] download ok: contract=${genieId} accountId=9152`);
      return bytes;
    } catch (err) {
      console.warn(`[GENIE] primary download failed, trying secondary: contract=${genieId}`, err);
    }
  }

  // Strategy 2: Secondary account (9054)
  const secondarySrc = await tryWithRetry(genieId, 9054);
  if (secondarySrc) {
    try {
      const bytes = await downloadRecordingData(secondarySrc, 9054, genieId);
      console.log(`[GENIE] download ok: contract=${genieId} accountId=9054`);
      return bytes;
    } catch (err) {
      console.error(`[GENIE] secondary download failed: contract=${genieId}`, err);
    }
  }

  return null;
}

/** Get just the recording URL without downloading. */
export async function getRecordingUrl(genieId: number): Promise<string | null> {
  const primarySrc = await tryWithRetry(genieId, 9152);
  if (primarySrc) return primarySrc;
  const secondarySrc = await tryWithRetry(genieId, 9054);
  return secondarySrc;
}
