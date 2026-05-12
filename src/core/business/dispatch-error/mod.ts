/** Top-level dispatch error handler.
 *
 *  Called from main.ts's [DISPATCH-CATCH] when any direct-dispatch handler or
 *  the danet router throws an uncaught error. Purpose: convert raw exceptions
 *  into structured JSON responses so the frontend never sees `500 {"message":
 *  "signal aborted"}` and can retry / show graceful state instead.
 *
 *  Pure function — no FS, no I/O beyond optional logging. Testable from a
 *  unit test that constructs synthetic Error objects + Request shapes.
 *
 *  Contract:
 *   - FS abort errors → GET returns 200 + { retry: true }, POST returns 503 + { retry: true }.
 *     200 for GETs lets the frontend's apiFetch read the body (it throws only on !res.ok),
 *     making page-level try/catch optional. 503 for POSTs preserves the "destructive op
 *     failed, don't auto-retry" semantic.
 *   - All other errors → 500 + { ok: false, error: <msg> }.
 *
 *  If you change this contract, update tests/dispatch-catch.test.ts in lockstep. */

export interface DispatchErrorContext {
  method: string;
  path: string;
}

/** True if the error message indicates an aborted Firestore call.
 *  Matched substrings cover Deno's AbortError, our explicit "signal aborted"
 *  messages, and any error mentioning "aborted" / "signal". */
export function isAbortError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("aborted") || msg.includes("AbortError") || msg.includes("signal");
}

/** Build the JSON Response for an uncaught dispatch error. */
export function buildDispatchErrorResponse(err: unknown, ctx: DispatchErrorContext): Response {
  const msg = err instanceof Error ? err.message : String(err);
  if (isAbortError(err)) {
    const status = ctx.method === "GET" ? 200 : 503;
    return Response.json(
      { retry: true, error: "Server busy, please retry", path: ctx.path, method: ctx.method },
      { status },
    );
  }
  return Response.json(
    { ok: false, error: msg, path: ctx.path, method: ctx.method },
    { status: 500 },
  );
}

/** Detect danet's auto-generated 500 body signature for FS aborts.
 *
 *  Reality of the dispatch path: danet has its OWN exception filter that
 *  catches uncaught controller exceptions BEFORE they propagate to our
 *  outer try/catch. It formats them as `{"status":500,"message":"<msg>"}`
 *  and returns a normal Response. So our exception-level safety net never
 *  fires for danet-handled paths. We have to inspect the response body to
 *  detect these.
 *
 *  Returns true when the body matches danet's abort signature so the
 *  boundary wrap can rewrite the response to `{ retry: true }`. Pure
 *  function — body must be passed as the already-read string. */
export function isDanetAbortBody(body: string): boolean {
  if (!body || body.length > 2000) return false; // danet errors are tiny
  return (
    body.includes("signal has been aborted")
    || body.includes("AbortError")
    || (body.includes('"status":500') && body.includes("aborted"))
  );
}
