/** In-memory pub/sub for real-time event delivery (chat + broadcast events).
 *  Per-isolate scope — on Deno Deploy with multiple isolates a publish from
 *  isolate A is NOT seen by subscribers in isolate B. Acceptable v1 limitation;
 *  polling fallback in the toast/chat clients picks up cross-isolate misses
 *  within 5-10s.
 *
 *  Two channels:
 *    - per-user: `subscribeUser(orgId, email, cb)` — app-events targeting
 *      a specific recipient (chat new-message, message-received, etc.)
 *    - per-org:  `subscribeOrg(orgId, cb)` — broadcast events (badge_earned,
 *      perfect_score, level_up, streak_milestone, ...).
 *
 *  Subscribers receive a wrapped `BusEvent` carrying the original payload
 *  + a transport hint (`type: "app" | "broadcast"`). Each `subscribe*` call
 *  returns an unsubscribe function the SSE handler must invoke when its
 *  ReadableStream is cancelled.
 *
 *  Errors thrown by subscribers are caught and logged so one slow/broken
 *  client never wedges the publish loop. */

export type BusEvent =
  | { kind: "app"; type: string; payload: unknown }
  | { kind: "broadcast"; type: string; payload: unknown };

type Listener = (event: BusEvent) => void;

const userSubs = new Map<string, Set<Listener>>();
const orgSubs = new Map<string, Set<Listener>>();

function userKey(orgId: string, email: string): string {
  return `${orgId}::${email}`;
}

export function subscribeUser(orgId: string, email: string, cb: Listener): () => void {
  const key = userKey(orgId, email);
  let set = userSubs.get(key);
  if (!set) {
    set = new Set();
    userSubs.set(key, set);
  }
  set.add(cb);
  return () => {
    const s = userSubs.get(key);
    if (!s) return;
    s.delete(cb);
    if (s.size === 0) userSubs.delete(key);
  };
}

export function subscribeOrg(orgId: string, cb: Listener): () => void {
  let set = orgSubs.get(orgId);
  if (!set) {
    set = new Set();
    orgSubs.set(orgId, set);
  }
  set.add(cb);
  return () => {
    const s = orgSubs.get(orgId);
    if (!s) return;
    s.delete(cb);
    if (s.size === 0) orgSubs.delete(orgId);
  };
}

export function publishToUser(orgId: string, email: string, type: string, payload: unknown): void {
  const set = userSubs.get(userKey(orgId, email));
  if (!set || set.size === 0) return;
  const event: BusEvent = { kind: "app", type, payload };
  for (const cb of set) {
    try { cb(event); } catch (err) {
      console.warn(`[EVENT-BUS] user listener for ${email} threw:`, err);
    }
  }
}

export function publishToOrg(orgId: string, type: string, payload: unknown): void {
  const set = orgSubs.get(orgId);
  if (!set || set.size === 0) return;
  const event: BusEvent = { kind: "broadcast", type, payload };
  for (const cb of set) {
    try { cb(event); } catch (err) {
      console.warn(`[EVENT-BUS] org listener for ${orgId} threw:`, err);
    }
  }
}

/** Test helper — wipe all subscriptions. Never call from prod code. */
export function _resetBusForTesting(): void {
  userSubs.clear();
  orgSubs.clear();
}

/** Diagnostic — current subscriber counts (used by /admin/dev-tools). */
export function busStats(): { userKeys: number; orgKeys: number; totalListeners: number } {
  let totalListeners = 0;
  for (const s of userSubs.values()) totalListeners += s.size;
  for (const s of orgSubs.values()) totalListeners += s.size;
  return {
    userKeys: userSubs.size,
    orgKeys: orgSubs.size,
    totalListeners,
  };
}
