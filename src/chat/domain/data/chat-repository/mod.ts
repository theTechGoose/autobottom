/** Chat/messaging repository. Firestore-backed. */

import {
  getStored, setStored, listStoredWithKeys,
} from "@core/data/firestore/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

export interface Message { id: string; from: string; to: string; body: string; ts: number; read: boolean; }

export async function sendMessage(orgId: OrgId, from: string, to: string, body: string): Promise<Message> {
  const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const msg: Message = { id, from, to, body, ts: Date.now(), read: false };
  // Store in both participants' conversation keys
  await setStored("message", orgId, [from, to, id], msg);
  await setStored("message", orgId, [to, from, id], msg);
  // Increment unread count for recipient (read-modify-write; race acceptable)
  const current = (await getStored<number>("unread-count", orgId, to)) ?? 0;
  await setStored("unread-count", orgId, [to], current + 1);
  return msg;
}

export async function getConversation(orgId: OrgId, ownerEmail: string, otherEmail: string, limit = 50): Promise<Message[]> {
  // Filter all messages for this owner to only those between ownerEmail and otherEmail
  const rows = await listStoredWithKeys<Message>("message", orgId);
  const out: Message[] = [];
  for (const { key, value } of rows) {
    if (key[0] === ownerEmail && key[1] === otherEmail) out.push(value);
    if (out.length >= limit) break;
  }
  return out.reverse(); // newest last
}

export async function getUnreadCount(orgId: OrgId, email: string): Promise<number> {
  return (await getStored<number>("unread-count", orgId, email)) ?? 0;
}

export async function markConversationRead(orgId: OrgId, ownerEmail: string, otherEmail: string): Promise<void> {
  const rows = await listStoredWithKeys<Message>("message", orgId);
  let readCount = 0;
  for (const { key, value: msg } of rows) {
    if (key[0] !== ownerEmail || key[1] !== otherEmail) continue;
    if (msg && !msg.read && msg.from !== ownerEmail) {
      await setStored("message", orgId, key, { ...msg, read: true });
      readCount++;
    }
  }
  if (readCount > 0) {
    const current = (await getStored<number>("unread-count", orgId, ownerEmail)) ?? 0;
    await setStored("unread-count", orgId, [ownerEmail], Math.max(0, current - readCount));
  }
}

export async function getConversationList(orgId: OrgId, email: string): Promise<Array<{ email: string; lastMessage: Message; unread: number }>> {
  const rows = await listStoredWithKeys<Message>("message", orgId);
  const convMap = new Map<string, { lastMessage: Message; unread: number }>();
  for (const { key, value: msg } of rows) {
    if (key[0] !== email || !msg) continue;
    const otherEmail = msg.from === email ? msg.to : msg.from;
    const existing = convMap.get(otherEmail);
    if (!existing || msg.ts > existing.lastMessage.ts) {
      const unread = existing?.unread ?? 0;
      convMap.set(otherEmail, { lastMessage: msg, unread: unread + (!msg.read && msg.from !== email ? 1 : 0) });
    } else if (!msg.read && msg.from !== email) {
      existing.unread++;
    }
  }
  return Array.from(convMap.entries()).map(([email, data]) => ({ email, ...data })).sort((a, b) => b.lastMessage.ts - a.lastMessage.ts);
}
