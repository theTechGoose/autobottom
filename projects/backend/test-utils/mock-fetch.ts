/**
 * Fetch mock for integration tests. Intercepts fetch calls and returns
 * canned responses. Restores original fetch on cleanup.
 */

type FetchHandler = (url: string | URL | Request, init?: RequestInit) => Promise<Response> | Response;

interface MockRoute {
  pattern: string | RegExp;
  handler: FetchHandler;
}

const _originalFetch = globalThis.fetch;
let _routes: MockRoute[] = [];

/** Register a mock route. Pattern can be a string (substring match) or RegExp. */
export function mockFetch(pattern: string | RegExp, handler: FetchHandler): void {
  _routes.push({ pattern, handler });
  installMock();
}

/** Register a mock that returns a JSON response. */
export function mockFetchJson(pattern: string | RegExp, body: unknown, status = 200): void {
  mockFetch(pattern, () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })
  );
}

/** Remove all mocks and restore original fetch. */
export function restoreFetch(): void {
  _routes = [];
  globalThis.fetch = _originalFetch;
}

function installMock(): void {
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    for (const route of _routes) {
      const match = typeof route.pattern === "string"
        ? url.includes(route.pattern)
        : route.pattern.test(url);
      if (match) {
        return await route.handler(url, init);
      }
    }

    throw new Error(`Unmocked fetch: ${url}`);
  };
}
