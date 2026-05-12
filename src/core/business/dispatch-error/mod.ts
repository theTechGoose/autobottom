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
