/** S3 stand-in: one folder on disk, path-style addressing.
 *
 *  Speaks the slice of the S3 REST API this app uses — GET (whole object and
 *  byte ranges, which the recording player needs), PUT, HEAD, DELETE — and
 *  ignores the SigV4 signature, the same way the Firestore emulator ignores
 *  bearer tokens. The signing code still runs in the app; nothing about the
 *  request changes except where it lands.
 *
 *  Objects live at <root>/<bucket>/<key>, key separators kept as directories. */

import { EMULATOR_PORTS } from "@core/config/endpoints.ts";

const ROOT = new URL("../../fixtures/json/emulator/s3/", import.meta.url).pathname;

function objectPath(bucket: string, key: string): string {
  return `${ROOT}${bucket}/${key}`;
}

/** Parse `bytes=start-end`. Returns null for a whole-object request. */
function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  if (rawStart === "" && rawEnd === "") return null;
  if (rawStart === "") {
    const len = Number(rawEnd);
    return { start: Math.max(0, size - len), end: size - 1 };
  }
  const start = Number(rawStart);
  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  return start > end ? null : { start, end };
}

function contentType(key: string): string {
  if (key.endsWith(".json")) return "application/json";
  if (key.endsWith(".mp3")) return "audio/mpeg";
  if (key.endsWith(".wav")) return "audio/wav";
  return "application/octet-stream";
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\//, "").split("/");
  const bucket = parts.shift() ?? "";
  const key = decodeURIComponent(parts.join("/"));
  if (!bucket || !key) return new Response("missing bucket or key", { status: 400 });
  const path = objectPath(bucket, key);

  if (req.method === "PUT") {
    await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    await Deno.writeFile(path, new Uint8Array(await req.arrayBuffer()));
    return new Response(null, { status: 200, headers: { etag: `"${key.length}"` } });
  }

  if (req.method === "DELETE") {
    await Deno.remove(path).catch(() => {});
    return new Response(null, { status: 204 });
  }

  let stat: Deno.FileInfo;
  try {
    stat = await Deno.stat(path);
  } catch {
    // Same shape the real thing returns — the app greps the body for NoSuchKey.
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchKey</Code><Key>${key}</Key></Error>`,
      { status: 404, headers: { "content-type": "application/xml" } },
    );
  }

  const headers: Record<string, string> = {
    "content-type": contentType(key),
    "accept-ranges": "bytes",
    "last-modified": (stat.mtime ?? new Date()).toUTCString(),
  };

  if (req.method === "HEAD") {
    return new Response(null, { status: 200, headers: { ...headers, "content-length": String(stat.size) } });
  }

  const range = parseRange(req.headers.get("range"), stat.size);
  if (!range) {
    const body = await Deno.readFile(path);
    return new Response(body, { status: 200, headers: { ...headers, "content-length": String(stat.size) } });
  }

  const file = await Deno.open(path, { read: true });
  await file.seek(range.start, Deno.SeekMode.Start);
  const length = range.end - range.start + 1;
  const buf = new Uint8Array(length);
  let read = 0;
  while (read < length) {
    const n = await file.read(buf.subarray(read));
    if (n === null) break;
    read += n;
  }
  file.close();
  return new Response(buf.subarray(0, read), {
    status: 206,
    headers: {
      ...headers,
      "content-length": String(read),
      "content-range": `bytes ${range.start}-${range.start + read - 1}/${stat.size}`,
    },
  });
}

export function startS3(): Deno.HttpServer {
  return Deno.serve({ port: EMULATOR_PORTS.s3, onListen: () => {} }, handle);
}

export const S3_ROOT = ROOT;
