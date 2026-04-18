/** Google Sheets API v4 client — JWT → access token → spreadsheets.values.append.
 *  Minimal implementation for chargeback/wire deduction reporting. Requires a
 *  service-account JSON in env:
 *
 *    GOOGLE_SA_JSON   — full service-account key as JSON string
 *    GOOGLE_SHEET_ID  — target spreadsheet
 *
 *  Throws a clear config error if either is missing so the caller can surface
 *  it in the UI. No external deps; signing uses crypto.subtle.
 *
 *  Port of main's appendSheetRows helper. */

export interface SheetsCredentials {
  clientEmail: string;
  privateKey: string;
  sheetId: string;
}

export function readSheetsCredentials(): SheetsCredentials | null {
  const raw = Deno.env.get("GOOGLE_SA_JSON") ?? "";
  const sheetId = Deno.env.get("GOOGLE_SHEET_ID") ?? "";
  if (!raw || !sheetId) return null;
  try {
    const parsed = JSON.parse(raw) as { client_email?: string; private_key?: string };
    if (!parsed.client_email || !parsed.private_key) return null;
    return { clientEmail: parsed.client_email, privateKey: parsed.private_key, sheetId };
  } catch {
    return null;
  }
}

function b64urlEncode(bytes: Uint8Array | string): string {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let bin = "";
  for (const b of data) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

async function signJwt(clientEmail: string, privateKeyPem: string, scope: string): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: clientEmail,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const toSign = `${b64urlEncode(JSON.stringify(header))}.${b64urlEncode(JSON.stringify(claim))}`;
  const keyBuf = pemToArrayBuffer(privateKeyPem);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyBuf,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(toSign)));
  return `${toSign}.${b64urlEncode(sig)}`;
}

async function getAccessToken(creds: SheetsCredentials): Promise<string> {
  const jwt = await signJwt(creds.clientEmail, creds.privateKey, "https://www.googleapis.com/auth/spreadsheets");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${encodeURIComponent(jwt)}`,
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const token = data.access_token as string | undefined;
  if (!token) throw new Error("Google token response missing access_token");
  return token;
}

/** Append rows to a given sheet tab. Tab must already exist.
 *  Rows are `(string | number)[][]` (no header — caller includes it if wanted). */
export async function appendSheetRows(
  creds: SheetsCredentials,
  tabName: string,
  rows: (string | number)[][],
): Promise<{ appended: number }> {
  if (!rows.length) return { appended: 0 };
  const token = await getAccessToken(creds);
  const range = encodeURIComponent(`${tabName}!A:Z`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(creds.sheetId)}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ values: rows }),
  });
  if (!res.ok) throw new Error(`Sheets append failed: ${res.status} ${await res.text()}`);
  return { appended: rows.length };
}
