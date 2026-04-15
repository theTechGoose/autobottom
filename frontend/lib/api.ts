/** API client — forwards session cookie to backend, returns typed JSON. */

const API_URL = () => Deno.env.get("API_URL") ?? "http://localhost:3000";

export async function apiFetch<T = unknown>(
  path: string,
  req: Request,
  init?: RequestInit,
): Promise<T> {
  const cookie = req.headers.get("cookie") ?? "";
  const url = `${API_URL()}${path}`;
  console.log(`[API_FETCH] ${init?.method ?? "GET"} ${url} cookie=${cookie ? "yes" : "no"}`);
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers as Record<string, string> | undefined),
      cookie,
      "content-type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
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
