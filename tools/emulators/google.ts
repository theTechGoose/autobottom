/** Google stand-in: service-account token exchange + the Sheets calls used by
 *  the weekly export.
 *
 *  The token endpoint accepts the real signed JWT the app mints and hands back
 *  an opaque string. It does not verify the signature — the Firestore emulator
 *  would ignore the resulting token anyway — but because the endpoint exists,
 *  `loadFirestoreCredentials()` → `signJwt()` → `getAccessToken()` all run
 *  locally exactly as they do in prod. That path used to be skipped entirely.
 *
 *  Sheets data lives in one JSON file per spreadsheet id, so an export you run
 *  locally is inspectable afterwards. */

import { EMULATOR_PORTS } from "@core/config/endpoints.ts";

const ROOT = new URL("../../fixtures/json/emulator/sheets/", import.meta.url).pathname;

async function readSheet(id: string): Promise<string[][]> {
  try {
    return JSON.parse(await Deno.readTextFile(`${ROOT}${id}.json`)) as string[][];
  } catch {
    return [];
  }
}

async function writeSheet(id: string, rows: string[][]): Promise<void> {
  await Deno.mkdir(ROOT, { recursive: true });
  await Deno.writeTextFile(`${ROOT}${id}.json`, JSON.stringify(rows, null, 2));
}

/** Columns-major view of a row-major sheet, which is what `majorDimension=COLUMNS` asks for. */
function toColumns(rows: string[][]): string[][] {
  const width = Math.max(0, ...rows.map((r) => r.length));
  return Array.from({ length: width }, (_, c) => rows.map((r) => r[c] ?? ""));
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  if (path === "/token" && req.method === "POST") {
    // Consume the body so the assertion is at least read, mirroring a real exchange.
    await req.text();
    // "owner" is the Firestore emulator's admin token — it accepts that exact
    // string as a bearer and grants full access. Anything else comes back as
    // "invalid jwt", because the emulator does parse the header it is given.
    return Response.json({
      access_token: "owner",
      expires_in: 3600,
      token_type: "Bearer",
    });
  }

  const batchGet = /^\/v4\/spreadsheets\/([^/]+)\/values:batchGet$/.exec(path);
  if (batchGet) {
    const id = decodeURIComponent(batchGet[1]);
    const rows = await readSheet(id);
    const ranges = url.searchParams.getAll("ranges");
    const columns = url.searchParams.get("majorDimension") === "COLUMNS";
    return Response.json({
      spreadsheetId: id,
      valueRanges: (ranges.length ? ranges : ["Sheet1"]).map((range) => ({
        range,
        majorDimension: columns ? "COLUMNS" : "ROWS",
        values: columns ? toColumns(rows) : rows,
      })),
    });
  }

  const append = /^\/v4\/spreadsheets\/([^/]+)\/values\/([^:]+):append$/.exec(path);
  if (append && req.method === "POST") {
    const id = decodeURIComponent(append[1]);
    const body = await req.json().catch(() => ({})) as { values?: string[][] };
    const incoming = body.values ?? [];
    const rows = await readSheet(id);
    rows.push(...incoming);
    await writeSheet(id, rows);
    console.log(`[SHEETS-EMU] appended ${incoming.length} row(s) to ${id} (${rows.length} total)`);
    return Response.json({
      spreadsheetId: id,
      updates: { updatedRows: incoming.length, updatedRange: append[2] },
    });
  }

  return Response.json({ error: `unhandled ${req.method} ${path}` }, { status: 404 });
}

export function startGoogle(): Deno.HttpServer {
  return Deno.serve({ port: EMULATOR_PORTS.google, onListen: () => {} }, handle);
}
