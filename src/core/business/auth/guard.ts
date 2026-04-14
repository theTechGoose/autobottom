/** Auth guard for danet controllers — extracts orgId from session cookie.
 *  Use @UseGuard(AuthGuard) on controllers or methods that need auth.
 *  Access auth context via getAuthFromContext(context) in the controller. */

import { Injectable } from "@danet/core";
import { authenticate } from "./mod.ts";
import type { AuthContext } from "./mod.ts";

// Store auth context keyed by request ID so controllers can retrieve it
const authContextMap = new Map<string, AuthContext>();

@Injectable()
export class AuthGuard {
  async canActivate(context: any): Promise<boolean> {
    const req = context.req?.raw as Request | undefined;
    if (!req) return false;

    const auth = await authenticate(req);
    if (!auth) return false;

    // Store auth in context for controller access
    const requestId = context.get?.("_id") ?? crypto.randomUUID();
    authContextMap.set(requestId, auth);

    // Clean up after 60s to prevent memory leaks
    setTimeout(() => authContextMap.delete(requestId), 60_000);

    return true;
  }
}

/** Retrieve the authenticated user's context from within a controller method.
 *  Call this with the @Context() injected execution context. */
export function getAuthFromContext(context: any): AuthContext | null {
  const requestId = context?.get?.("_id") ?? context?._id;
  if (!requestId) return null;
  return authContextMap.get(requestId) ?? null;
}

/** Helper for controllers that don't use the guard — parses auth from raw request.
 *  Returns orgId or throws. Used as: `const orgId = await resolveOrgId(req)` */
export async function resolveOrgId(req: Request): Promise<string> {
  const auth = await authenticate(req);
  if (!auth) throw new Error("Unauthorized");
  return auth.orgId;
}
