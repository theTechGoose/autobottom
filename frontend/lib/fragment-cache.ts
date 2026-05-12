/** Per-isolate cache for rendered HTML fragments served to HTMX panels.
 *
 *  The dashboard polls 4 panels every 10s. With multiple admin tabs +
 *  concurrent isolates, parallel requests routinely fire at the same
 *  millisecond. Without coordination each one runs the full apiFetch +
 *  Preact render pipeline against the backend, multiplying load on
 *  Firestore and turning a steady-state poll into a thundering herd.
 *
 *  withFragmentCache wraps a fragment renderer with:
 *    1) A short result cache (default 5s) keyed by `key`.
 *    2) In-flight promise dedup — concurrent cache-misses share a single
 *       render. The dedup map is cleared after the render resolves.
 *    3) Stale-while-revalidate semantics inherited from upstream backend
 *       caches; this layer just collapses parallel polls into one call.
 *
 *  The wrapped renderer must NEVER throw out — it should return its own
 *  fallback HTML on error, so we don't poison the cache with rejected
 *  promises (Deno would crash the isolate on an unhandled rejection
 *  exactly like commit 6fc28ee bit us). We treat any throw as a
 *  transient miss: log, evict pending, return the renderer's error.
 */

interface CacheEntry { html: string; expiresAt: number }

const _cache = new Map<string, CacheEntry>();
const _pending = new Map<string, Promise<string>>();

const DEFAULT_TTL_MS = 5_000;

/** Test-only: clear the module-scope cache + pending maps. Needed because
 *  tests sharing the same isolate would otherwise see entries that a prior
 *  test populated, which breaks test isolation (e.g. test A's success path
 *  poisons test B's expected-error-fallback path). Call from beforeEach /
 *  setUp in any test file that exercises withFragmentCache(). */
export function _resetFragmentCacheForTests(): void {
  _cache.clear();
  _pending.clear();
}

export async function withFragmentCache(
  key: string,
  renderer: () => Promise<string>,
  opts: { ttlMs?: number } = {},
): Promise<string> {
  const ttl = opts.ttlMs ?? DEFAULT_TTL_MS;
  const now = Date.now();
  const cached = _cache.get(key);
  if (cached && cached.expiresAt > now) return cached.html;

  let pending = _pending.get(key);
  if (!pending) {
    pending = (async () => {
      try {
        const html = await renderer();
        _cache.set(key, { html, expiresAt: Date.now() + ttl });
        return html;
      } catch (e) {
        // Renderer rejected despite its own try/catch (e.g. apiFetch threw,
        // Preact render crashed on bad data). Convert to soft fallback so
        // the IIFE always resolves and `_pending` never holds a rejected
        // promise. Without this, every concurrent caller awaiting the same
        // key would receive the rejection and the route would 500. We do
        // NOT cache the fallback — next request retries fresh.
        console.warn(`[FRAGMENT-CACHE] ${key} renderer rejected:`, e);
        return `<div style="color:var(--text-dim);font-size:11px;">refreshing…</div>`;
      } finally {
        _pending.delete(key);
      }
    })();
    _pending.set(key, pending);
  }
  return pending;
}
