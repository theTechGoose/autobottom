/** Events repository — personal events, broadcast events, prefab subscriptions.
 *  Firestore-backed. */

import {
  getStored, setStored, deleteStored, listStoredWithKeys,
} from "@core/data/firestore/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

const DAY_MS = 86_400_000;

export type EventType = "audit-completed" | "review-decided" | "appeal-decided" | "remediation-submitted" | "message-received";

export interface AppEvent { id: string; type: EventType; payload: Record<string, unknown>; createdAt: number; }
export interface BroadcastEvent { id: string; type: string; triggerEmail: string; displayName: string; message: string; animationId: string | null; ts: number; }

export async function emitEvent(orgId: OrgId, targetEmail: string, type: EventType, payload: Record<string, unknown>): Promise<void> {
  const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  await setStored(
    "app-event", orgId, [targetEmail, id],
    { id, type, payload, createdAt: Date.now() },
    { expireInMs: DAY_MS },
  );
}

export async function getEvents(orgId: OrgId, email: string, since = 0): Promise<AppEvent[]> {
  const rows = await listStoredWithKeys<AppEvent>("app-event", orgId);
  const out: AppEvent[] = [];
  for (const { key, value } of rows) {
    if (key[0] !== email) continue;
    if (value.createdAt > since) out.push(value);
  }
  return out;
}

export async function deleteEvents(orgId: OrgId, email: string, eventIds: string[]): Promise<void> {
  for (const id of eventIds) await deleteStored("app-event", orgId, email, id);
}

export async function getPrefabSubscriptions(orgId: OrgId): Promise<Record<string, boolean>> {
  return (await getStored<Record<string, boolean>>("prefab-subscriptions", orgId)) ?? {};
}

export async function savePrefabSubscriptions(orgId: OrgId, subs: Record<string, boolean>): Promise<void> {
  await setStored("prefab-subscriptions", orgId, [], subs);
}

export async function emitBroadcastEvent(orgId: OrgId, prefabType: string, triggerEmail: string, message: string, animationId: string | null): Promise<void> {
  const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  await setStored(
    "broadcast-event", orgId, [id],
    { id, type: prefabType, triggerEmail, displayName: triggerEmail.split("@")[0], message, animationId, ts: Date.now() },
    { expireInMs: DAY_MS },
  );
}

export async function getBroadcastEvents(orgId: OrgId, since = 0): Promise<BroadcastEvent[]> {
  const rows = await listStoredWithKeys<BroadcastEvent>("broadcast-event", orgId);
  return rows.map(({ value }) => value).filter((v) => v.ts > since);
}

export async function checkAndEmitPrefab(orgId: OrgId, prefabType: string, email: string, message: string): Promise<void> {
  const subs = await getPrefabSubscriptions(orgId);
  if (!subs[prefabType]) return;
  await emitBroadcastEvent(orgId, prefabType, email, message, null);
}
