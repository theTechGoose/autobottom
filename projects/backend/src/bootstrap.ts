/**
 * Application bootstrap — shared utilities and app wiring.
 */

/** Standard JSON response helper. Used by all entrypoints. */
export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
