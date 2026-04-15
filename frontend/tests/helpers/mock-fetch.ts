/** Shared fetch mock — replaces globalThis.fetch, records calls, returns configurable responses. */

export interface MockResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

export interface MockFetchResult {
  restore: () => void;
  calls: FetchCall[];
  callCount: () => number;
}

/**
 * Replace globalThis.fetch with a mock that matches URL path suffixes.
 * Routes map path suffixes to responses. Arrays shift through sequentially.
 */
export function mockFetch(routes: Record<string, MockResponse | MockResponse[]>): MockFetchResult {
  const original = globalThis.fetch;
  const calls: FetchCall[] = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers as Record<string, string>;
      for (const [k, v] of Object.entries(h)) headers[k] = v;
    } else if (input instanceof Request) {
      input.headers.forEach((v, k) => headers[k] = v);
    }
    let body: string | null = null;
    if (init?.body) body = typeof init.body === "string" ? init.body : JSON.stringify(init.body);
    else if (input instanceof Request) body = await input.clone().text().catch(() => null);

    calls.push({ url, method, headers, body });

    // Match route
    for (const [suffix, resp] of Object.entries(routes)) {
      if (url.includes(suffix)) {
        const r = Array.isArray(resp) ? (resp.shift() ?? { status: 500, body: { error: "no more mocked responses" } }) : resp;
        return new Response(JSON.stringify(r.body ?? {}), {
          status: r.status ?? 200,
          headers: { "content-type": "application/json", ...(r.headers ?? {}) },
        });
      }
    }

    return new Response(JSON.stringify({ error: "unmocked: " + url }), { status: 500 });
  }) as typeof fetch;

  return {
    restore: () => { globalThis.fetch = original; },
    calls,
    callCount: () => calls.length,
  };
}

/** Create a minimal Fresh-like context for testing route handlers. */
export function createCtx(url: string, opts?: {
  method?: string;
  body?: unknown;
  cookie?: string;
  state?: Record<string, unknown>;
}) {
  const method = opts?.method ?? "GET";
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts?.cookie) headers["cookie"] = opts.cookie;
  const reqInit: RequestInit = { method, headers };
  if (opts?.body) reqInit.body = JSON.stringify(opts.body);
  const req = new Request(`http://localhost${url}`, reqInit);
  return { req, state: (opts?.state ?? {}) as Record<string, unknown> };
}
