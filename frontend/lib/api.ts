/** API client — forwards session cookie to backend, returns typed JSON. */

const API_URL = () => Deno.env.get("API_URL") ?? "http://localhost:3000";

export async function apiFetch<T = unknown>(
  path: string,
  req: Request,
  init?: RequestInit,
): Promise<T> {
  const cookie = req.headers.get("cookie") ?? "";
  const url = `${API_URL()}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers as Record<string, string> | undefined),
      cookie,
      // Tell the unified server's dispatcher this is a JSON request — needed
      // for paths in FRONTEND_EXACT_PAGES (e.g. /admin/users) where the page
      // and the backend JSON endpoint share a URL. Without this the dispatcher
      // routes to Fresh, the page handler calls apiFetch on its own URL, and
      // we infinite-recurse.
      "accept": "application/json",
      "content-type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`❌ [API_FETCH] ${init?.method ?? "GET"} ${url} → ${res.status}: ${text.slice(0, 200)}`);
    throw new ApiError(res.status, path, text);
  }
  return res.json() as Promise<T>;
}

export async function apiPost<T = unknown>(
  path: string,
  req: Request,
  body: unknown,
): Promise<T> {
  return apiFetch<T>(path, req, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export class ApiError extends Error {
  status: number;
  path: string;
  constructor(status: number, path: string, body: string) {
    super(`API ${status}: ${path} — ${body}`);
    this.status = status;
    this.path = path;
  }
}

/** Parse an HTMX-or-fetch-submitted body into a plain object.
 *  HTMX `hx-vals` posts as application/x-www-form-urlencoded; islands
 *  using `fetch()` post JSON. Handles both, and auto-coerces integer
 *  strings (e.g. questionIndex="0" → 0) so backend DTO validation holds. */
export async function parseHtmxBody(req: Request): Promise<Record<string, unknown>> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    return await req.json() as Record<string, unknown>;
  }
  const fd = await req.formData();
  const out: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    const s = typeof v === "string" ? v : String(v);
    if (/^-?\d+$/.test(s)) {
      const n = Number(s);
      if (Number.isSafeInteger(n) && String(n) === s) { out[k] = n; continue; }
    }
    out[k] = s;
  }
  return out;
}
