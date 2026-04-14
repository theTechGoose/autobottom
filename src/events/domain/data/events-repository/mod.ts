/** Events repository — personal events, broadcast events, prefab subscriptions.
 *  Ported from lib/kv.ts SSE events + broadcast sections. */

import { getKv, orgKey } from "@core/data/deno-kv/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

const DAY_MS = 86_400_000;

export type EventType = "audit-completed" | "review-decided" | "appeal-decided" | "remediation-submitted" | "message-received";

export interface AppEvent { id: string; type: EventType; payload: Record<string, unknown>; createdAt: number; }
export interface BroadcastEvent { id: string; type: string; triggerEmail: string; displayName: string; message: string; animationId: string | null; ts: number; }

export async function emitEvent(orgId: OrgId, targetEmail: string, type: EventType, payload: Record<string, unknown>): Promise<void> {
  const db = await getKv();
  const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  await db.set(orgKey(orgId, "app-event", targetEmail, id), { id, type, payload, createdAt: Date.now() }, { expireIn: DAY_MS });
}

export async function getEvents(orgId: OrgId, email: string, since = 0): Promise<AppEvent[]> {
  const db = await getKv();
  const results: AppEvent[] = [];
  for await (const e of db.list<AppEvent>({ prefix: orgKey(orgId, "app-event", email) })) {
    if (e.value.createdAt > since) results.push(e.value);
  }
  return results;
}

export async function deleteEvents(orgId: OrgId, email: string, eventIds: string[]): Promise<void> {
  const db = await getKv();
  for (const id of eventIds) await db.delete(orgKey(orgId, "app-event", email, id));
}

export async function getPrefabSubscriptions(orgId: OrgId): Promise<Record<string, boolean>> {
  return (await (await getKv()).get<Record<string, boolean>>(orgKey(orgId, "prefab-subscriptions"))).value ?? {};
}

export async function savePrefabSubscriptions(orgId: OrgId, subs: Record<string, boolean>): Promise<void> {
  await (await getKv()).set(orgKey(orgId, "prefab-subscriptions"), subs);
}

export async function emitBroadcastEvent(orgId: OrgId, prefabType: string, triggerEmail: string, message: string, animationId: string | null): Promise<void> {
  const db = await getKv();
  const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  await db.set(orgKey(orgId, "broadcast-event", id), { id, type: prefabType, triggerEmail, displayName: triggerEmail.split("@")[0], message, animationId, ts: Date.now() }, { expireIn: DAY_MS });
}

export async function getBroadcastEvents(orgId: OrgId, since = 0): Promise<BroadcastEvent[]> {
  const db = await getKv();
  const results: BroadcastEvent[] = [];
  for await (const e of db.list<BroadcastEvent>({ prefix: orgKey(orgId, "broadcast-event") })) {
    if (e.value.ts > since) results.push(e.value);
  }
  return results;
}

export async function checkAndEmitPrefab(orgId: OrgId, prefabType: string, email: string, message: string): Promise<void> {
  const subs = await getPrefabSubscriptions(orgId);
  if (!subs[prefabType]) return;
  await emitBroadcastEvent(orgId, prefabType, email, message, null);
}
