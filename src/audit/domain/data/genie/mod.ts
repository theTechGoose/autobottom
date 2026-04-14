/** Genie recording provider - fetches recording URLs and downloads audio. */


const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Real call recordings are hundreds of KB. Anything under 50KB is junk
// (HTML error pages, empty responses, redirect pages, etc).
const MIN_MEANINGFUL_BYTES = 50_000;

type AccountRole = "primary" | "secondary";

function getAccountId(role: AccountRole): number {
  return Number(role === "primary" ? Deno.env.get("GENIE_PRIMARY_ACCOUNT") ?? "" : Deno.env.get("GENIE_SECONDARY_ACCOUNT") ?? "");
}

function getHeaders(role: AccountRole): Headers {
  const token = role === "primary" ? Deno.env.get("GENIE_AUTH") ?? "" : Deno.env.get("GENIE_AUTH_TWO") ?? "";
  return new Headers({
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/x-www-form-urlencoded",
  });
}

export function isValidAudio(bytes: Uint8Array): boolean {
  const isId3 = bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
  const isMp3Frame = bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0;
  const isRiff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46; // WAV
  const isOgg = bytes[0] === 0x4F && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53;
  return isId3 || isMp3Frame || isRiff || isOgg;
}

// -- Async job search (fallback when sync API returns empty) --

interface GenieSession {
  sid: string;
  obtainedAt: number;
}

const sessions: Partial<Record<AccountRole, GenieSession>> = {};
const SESSION_TTL_MS = 23 * 60 * 60 * 1000; // 23h — refresh daily

async function getSession(role: AccountRole): Promise<string | null> {
  const cached = sessions[role];
  if (cached && Date.now() - cached.obtainedAt < SESSION_TTL_MS) return cached.sid;

  const accountId = getAccountId(role);
  const password = role === "primary" ? Deno.env.get("GENIE_SESSION_PASS_9152") ?? "" : Deno.env.get("GENIE_SESSION_PASS_9054") ?? "";
  const apirid = `${Date.now()}-1`;

  try {
    const res = await fetch(`${Deno.env.get("GENIE_BASE_URL") ?? ""}/loginsession.wr`, {
      method: "POST",
      headers: new Headers({ "Content-Type": "application/x-www-form-urlencoded" }),
      body: new URLSearchParams({ username: String(accountId), password, apirid }).toString(),
    });
    if (!res.ok) {
      console.warn(`[GENIE] ❌ login failed: role=${role} status=${res.status}`);
      return null;
    }
    const data = await res.json();
    const sid = data?.user?.session_id as string | undefined;
    if (!sid) {
      console.warn(`[GENIE] ❌ login no session_id: role=${role}`);
      return null;
    }
    sessions[role] = { sid, obtainedAt: Date.now() };
    console.log(`[GENIE] ✅ login ok: role=${role} accountId=${accountId}`);
    return sid;
  } catch (err) {
    console.error(`[GENIE] ❌ login error: role=${role}`, err);
    return null;
  }
}

function cookieHeaders(sid: string): Headers {
  return new Headers({
    "Content-Type": "application/x-www-form-urlencoded",
    "Cookie": `sid=${sid}`,
  });
}

async function searchViaJob(contract: number, role: AccountRole, tag: string): Promise<string | null> {
  const sid = await getSession(role);
  if (!sid) return null;

  const accountId = getAccountId(role);

  try {
    // Step 1: Submit search job
    const apirid = `${Date.now()}-1`;
    const jobRes = await fetch(`${Deno.env.get("GENIE_BASE_URL") ?? ""}/${accountId}/judge_makesearchresults.wr`, {
      method: "POST",
      headers: cookieHeaders(sid),
      body: new URLSearchParams({ apirid, filter_contract: String(contract) }).toString(),
    });
    if (!jobRes.ok) {
      // Stale session — invalidate and bail
      delete sessions[role];
      console.warn(`[GENIE] 🔍 job search HTTP ${jobRes.status}: contract=${contract} role=${role} ${tag}`);
      return null;
    }
    const jobData = await jobRes.json();
    const jobId = jobData?.result?.job_id as number | undefined;
    const reportId = jobData?.result?.report_id as string | undefined;
    if (!jobId || !reportId) {
      console.warn(`[GENIE] 🔍 job search bad response: contract=${contract} role=${role} ${tag}`);
      return null;
    }
    console.log(`[GENIE] 🔍 job created: contract=${contract} role=${role} jobId=${jobId} ${tag}`);

    // Step 2: Poll for completion (up to 30s)
    for (let i = 1; i <= 15; i++) {
      await sleep(2000);
      const pollApirid = `${Date.now()}-${i + 1}`;
      const pollRes = await fetch(
        `${Deno.env.get("GENIE_BASE_URL") ?? ""}/${accountId}/jobqueuestatus.wr?apirid=${pollApirid}`,
        {
          method: "POST",
          headers: cookieHeaders(sid),
          body: new URLSearchParams({ apirid: pollApirid, job_id: String(jobId) }).toString(),
        },
      );
      if (!pollRes.ok) continue;
      const pollData = await pollRes.json();
      const status = pollData?.result?.result?.status as string | undefined;
      const urlJson = pollData?.result?.result?.result?.url_json as string | undefined;

      if (status === "complete" && urlJson) {
        // Step 3: Load result JSON
        const resultRes = await fetch(urlJson, { headers: cookieHeaders(sid) });
        if (!resultRes.ok) {
          console.warn(`[GENIE] 🔍 job result HTTP ${resultRes.status}: contract=${contract} ${tag}`);
          return null;
        }
        const records = await resultRes.json();
        if (!Array.isArray(records) || records.length === 0) {
          console.warn(`[GENIE] 🔍 job result empty array: contract=${contract} ${tag}`);
          return null;
        }
        const src = records[0]?.src as string | undefined;
        if (src && src !== `${Deno.env.get("GENIE_BASE_URL") ?? ""}/` && src.trim() !== "") {
          console.log(`[GENIE] 🔍 job search found: contract=${contract} role=${role} src=${src} ${tag}`);
          return src;
        }
        console.warn(`[GENIE] 🔍 job search no src: contract=${contract} role=${role} ${tag}`);
        return null;
      }
    }

    console.warn(`[GENIE] 🔍 job search timed out: contract=${contract} role=${role} ${tag}`);
    return null;
  } catch (err) {
    console.error(`[GENIE] 🔍 job search error: contract=${contract} role=${role} ${tag}`, err);
    return null;
  }
}

// -- Sync search (fast path, used first) --

async function searchOnce(contract: number, role: AccountRole, tag: string): Promise<string | null> {
  const accountId = getAccountId(role);
  try {
    const url = `${Deno.env.get("GENIE_BASE_URL") ?? ""}/api/v1/${accountId}/judge_search.wr?filter_contract=${contract}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    const res = await fetch(url, { headers: getHeaders(role), signal: ctrl.signal }).finally(() => clearTimeout(t));
    if (!res.ok) {
      console.warn(`[GENIE] 🔍 search HTTP ${res.status}: contract=${contract} role=${role} ${tag}`);
      return null;
    }
    const json = await res.json();
    if (json?.error) {
      console.warn(`[GENIE] 🔍 search API error: contract=${contract} role=${role} error=${JSON.stringify(json.error)} ${tag}`);
      return null;
    }
    if (!json?.data || !Array.isArray(json.data) || json.data.length === 0) {
      console.warn(`[GENIE] 🔍 search empty: contract=${contract} role=${role} data=${JSON.stringify(json?.data)} ${tag}`);
      return null;
    }
    const [record] = json.data;
    if (!record?.contract || record.contract === "") {
      console.warn(`[GENIE] 🔍 search no contract field: contract=${contract} role=${role} record=${JSON.stringify(record)} ${tag}`);
      return null;
    }
    const src = record?.src as string | undefined;
    if (!src || src === `${Deno.env.get("GENIE_BASE_URL") ?? ""}/` || src.trim() === "") {
      console.warn(`[GENIE] 🔍 search no src: contract=${contract} role=${role} src=${src} ${tag}`);
      return null;
    }
    console.log(`[GENIE] 🔍 search found: contract=${contract} role=${role} src=${src} ${tag}`);
    return src;
  } catch (err) {
    console.error(`[GENIE] 🔍 search error: role=${role} contract=${contract} ${tag}`, err);
    return null;
  }
}

async function searchWithRetry(contract: number, role: AccountRole, tag: string, maxAttempts = 5): Promise<string | null> {
  const accountId = getAccountId(role);
  for (let i = 1; i <= maxAttempts; i++) {
    console.log(`[GENIE] 🔍 search attempt ${i}/${maxAttempts}: contract=${contract} role=${role} accountId=${accountId} ${tag}`);
    const src = await searchOnce(contract, role, tag);
    if (src) return src;
    if (i < maxAttempts) await sleep(2 ** i * 1000);
  }
  console.warn(`[GENIE] 🔍 search exhausted ${maxAttempts} attempts: contract=${contract} role=${role} accountId=${accountId} ${tag}`);
  return null;
}

async function downloadWithRetry(
  src: string,
  role: AccountRole,
  contract: number,
  tag: string,
  maxAttempts = 3,
): Promise<Uint8Array> {
  let lastError: unknown;
  console.log(`[GENIE] ⬇️ download start: contract=${contract} role=${role} src=${src} ${tag}`);

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

      console.log(`[GENIE] ✅ download ok: contract=${contract} role=${role} bytes=${bytes.byteLength} ${tag}`);
      return bytes;
    } catch (err) {
      lastError = err;
      const msg = String(err);
      if (msg.includes("DEAD_URL")) {
        console.warn(`[GENIE] ❌ dead url — cascading: contract=${contract} role=${role} error=${msg} ${tag}`);
        throw new Error(`Dead URL — cascade. ${msg}`);
      }
      console.warn(`[GENIE] ⚠️ download attempt ${i}/${maxAttempts} failed: contract=${contract} role=${role} ${tag}`, err);
      if (i < maxAttempts) await sleep(2 ** i * 1000);
    }
  }
  throw new Error(`Genie download failed after ${maxAttempts} attempts. Last: ${String(lastError)}`);
}

async function tryStrategy(role: AccountRole, contract: number, tag: string): Promise<Uint8Array | null> {
  console.log(`[GENIE] 🚀 strategy: static-${role} contract=${contract} ${tag}`);

  // Fast path: sync search API
  let src = await searchWithRetry(contract, role, tag);

  // Fallback: async job search (uses different index, finds recordings sync API misses)
  if (!src) {
    console.log(`[GENIE] 🔍 sync exhausted, trying async job fallback: contract=${contract} role=${role} ${tag}`);
    src = await searchViaJob(contract, role, tag);
  }

  if (!src) {
    console.warn(`[GENIE] ❌ no src found: role=${role} contract=${contract} ${tag}`);
    return null;
  }
  try {
    return await downloadWithRetry(src, role, contract, tag);
  } catch (err) {
    console.warn(`[GENIE] ❌ strategy failed: role=${role} contract=${contract} ${tag}`, err);
    return null;
  }
}

/** Find recording and download bytes. Returns bytes or null if not found.
 *
 *  Strategy cascade (in order):
 *  1. static-primary   — sync search, then async job fallback
 *  2. static-secondary — sync search, then async job fallback
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
