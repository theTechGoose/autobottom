/** Default org resolver — used by controllers until auth middleware is fully wired.
 *  Returns CHARGEBACKS_ORG_ID from env, or "default" if not set.
 *  When the frontend starts sending session cookies, controllers should
 *  switch to using orgFromReq(req) or the AuthGuard + getAuthFromContext(). */

export function defaultOrgId(): string {
  return Deno.env.get("CHARGEBACKS_ORG_ID") ?? Deno.env.get("DEFAULT_ORG_ID") ?? "default";
}
