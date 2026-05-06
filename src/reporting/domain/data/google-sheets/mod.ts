/** Google Sheets API adapter. Ported from providers/sheets.ts. */

function base64url(data: Uint8Array | string): string {
  const str = typeof data === "string" ? data : String.fromCharCode(...data);
  return btoa(str).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function parseSheetsServiceAccount(b64: string): { email: string; privateKey: string } {
  const json = JSON.parse(atob(b64));
  return { email: json.client_email, privateKey: json.private_key };
}

async function getAccessToken(email: string, privateKeyPem: string): Promise<string> {
  const keyData = privateKeyPem.replace(/-----BEGIN PRIVATE KEY-----/g, "").replace(/-----END PRIVATE KEY-----/g, "").replace(/\s/g, "");
  const keyDer = Uint8Array.from(atob(keyData), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey("pkcs8", keyDer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iss: email, scope: "https://www.googleapis.com/auth/spreadsheets", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const sigInput = new TextEncoder().encode(`${header}.${payload}`);
  const sigBytes = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, sigInput);
  const sig = base64url(new Uint8Array(sigBytes));
  const jwt = `${header}.${payload}.${sig}`;
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  if (!tokenRes.ok) throw new Error(`Google token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
  const data = await tokenRes.json();
  return data.access_token as string;
}

export async function appendSheetRows(
  sheetId: string, tabName: string, rows: string[][], email: string, privateKey: string,
): Promise<void> {
  if (!rows.length) return;
  const token = await getAccessToken(email, privateKey);
  const range = encodeURIComponent(`${tabName}!A1`);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ values: rows }) },
  );
  if (!res.ok) throw new Error(`Sheets append failed (${tabName}): ${res.status} ${await res.text()}`);
}
