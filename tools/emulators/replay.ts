/** Record/replay proxy for the read-only external systems: QuickBase and Genie.
 *
 *  Neither has an emulator, and hand-writing one means inventing response
 *  shapes — so instead we keep the real ones. Run once with
 *  `EMULATOR_RECORD=true` and real credentials: every request is forwarded
 *  upstream and the response saved under fixtures/json/emulator/http/. From
 *  then on the same request is served from disk, offline and deterministic.
 *
 *  The app is unchanged either way — it makes the identical QuickBase and
 *  Genie calls with the identical bodies. Only the host differs.
 *
 *  A request with no recording fails loudly rather than returning something
 *  invented: a silent empty result would look like "this record doesn't
 *  exist", which is exactly the kind of false signal this whole exercise is
 *  meant to remove. */

import { EMULATOR_PORTS } from "@core/config/endpoints.ts";

const ROOT = new URL("../../fixtures/json/emulator/http/", import.meta.url).pathname;

interface Recording {
  request: { method: string; url: string; body: string };
  response: { status: number; contentType: string; body: string };
}

const UPSTREAM: Record<string, () => string> = {
  quickbase: () => "https://api.quickbase.com",
  genie: () => Deno.env.get("GENIE_BASE_URL") ?? "",
};

function isRecording(): boolean {
  return Deno.env.get("EMULATOR_RECORD") === "true";
}

async function hash(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const [, service, ...rest] = url.pathname.split("/");
  const upstreamBase = UPSTREAM[service]?.();
  if (upstreamBase === undefined) {
    return Response.json({ error: `unknown service "${service}"` }, { status: 404 });
  }

  const suffix = "/" + rest.join("/") + url.search;
  const body = req.method === "GET" || req.method === "HEAD" ? "" : await req.text();
  const key = await hash(`${req.method} ${suffix} ${body}`);
  const file = `${ROOT}${service}/${key}.json`;

  try {
    const saved = JSON.parse(await Deno.readTextFile(file)) as Recording;
    return new Response(saved.response.body, {
      status: saved.response.status,
      headers: { "content-type": saved.response.contentType },
    });
  } catch { /* not recorded yet — fall through */ }

  if (!isRecording()) {
    console.error(`[REPLAY] no recording for ${req.method} /${service}${suffix}`);
    return Response.json({
      error: "no recording for this request",
      service,
      request: `${req.method} ${suffix}`,
      hint: "re-run with EMULATOR_RECORD=true and real credentials to capture it",
    }, { status: 502 });
  }

  if (!upstreamBase) {
    return Response.json({ error: `${service} upstream not configured` }, { status: 502 });
  }

  // Forward verbatim: same method, same headers (credentials included), same body.
  const headers = new Headers(req.headers);
  headers.delete("host");
  const upstream = await fetch(`${upstreamBase}${suffix}`, {
    method: req.method,
    headers,
    body: body || undefined,
  });
  const text = await upstream.text();
  const contentType = upstream.headers.get("content-type") ?? "application/json";

  await Deno.mkdir(`${ROOT}${service}`, { recursive: true });
  const recording: Recording = {
    request: { method: req.method, url: suffix, body },
    response: { status: upstream.status, contentType, body: text },
  };
  await Deno.writeTextFile(file, JSON.stringify(recording, null, 2));
  console.log(`[REPLAY] recorded ${req.method} /${service}${suffix.slice(0, 80)} → ${upstream.status}`);

  return new Response(text, { status: upstream.status, headers: { "content-type": contentType } });
}

export function startReplay(): Deno.HttpServer {
  return Deno.serve({ port: EMULATOR_PORTS.replay, onListen: () => {} }, handle);
}
