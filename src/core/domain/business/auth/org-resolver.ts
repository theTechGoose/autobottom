/** Org resolver — extracts orgId from session cookie, falls back to env default.
 *  Used by all controllers for per-request org context. */

import { authenticate } from "./mod.ts";

/** Default orgId from environment — used when no session cookie present (QStash callbacks, etc). */
export function defaultOrgId(): string {
  return Deno.env.get("CHARGEBACKS_ORG_ID") ?? Deno.env.get("DEFAULT_ORG_ID") ?? "default";
}

/** Resolve orgId from request — extracts from session cookie, falls back to env default. */
export async function resolveOrg(req: Request): Promise<string> {
  const auth = await authenticate(req);
  return auth?.orgId ?? defaultOrgId();
}
