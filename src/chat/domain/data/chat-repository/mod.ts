/** Chat/messaging repository. Ported from lib/kv.ts messaging section. */

import { getKv, orgKey } from "@core/domain/data/deno-kv/mod.ts";
import type { OrgId } from "@core/domain/data/deno-kv/mod.ts";

export interface Message { id: string; from: string; to: string; body: string; ts: number; read: boolean; }

export async function sendMessage(orgId: OrgId, from: string, to: string, body: string): Promise<Message> {
  const db = await getKv();
  const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const msg: Message = { id, from, to, body, ts: Date.now(), read: false };
  // Store in both participants' conversation keys
  await db.atomic()
    .set(orgKey(orgId, "message", from, to, id), msg)
    .set(orgKey(orgId, "message", to, from, id), msg)
    .commit();
  // Increment unread count for recipient
  const unreadKey = orgKey(orgId, "unread-count", to);
  const current = (await db.get<number>(unreadKey)).value ?? 0;
  await db.set(unreadKey, current + 1);
  return msg;
}

export async function getConversation(orgId: OrgId, ownerEmail: string, otherEmail: string, limit = 50): Promise<Message[]> {
  const db = await getKv();
  const results: Message[] = [];
  let count = 0;
  for await (const entry of db.list<Message>({ prefix: orgKey(orgId, "message", ownerEmail, otherEmail) })) {
    results.push(entry.value);
    if (++count >= limit) break;
  }
  return results.reverse(); // newest last
}

export async function getUnreadCount(orgId: OrgId, email: string): Promise<number> {
  return (await (await getKv()).get<number>(orgKey(orgId, "unread-count", email))).value ?? 0;
}

export async function markConversationRead(orgId: OrgId, ownerEmail: string, otherEmail: string): Promise<void> {
  const db = await getKv();
  let readCount = 0;
  for await (const entry of db.list<Message>({ prefix: orgKey(orgId, "message", ownerEmail, otherEmail) })) {
    const msg = entry.value;
    if (msg && !msg.read && msg.from !== ownerEmail) {
      await db.set(entry.key, { ...msg, read: true });
      readCount++;
    }
  }
  if (readCount > 0) {
    const unreadKey = orgKey(orgId, "unread-count", ownerEmail);
    const current = (await db.get<number>(unreadKey)).value ?? 0;
    await db.set(unreadKey, Math.max(0, current - readCount));
  }
}

export async function getConversationList(orgId: OrgId, email: string): Promise<Array<{ email: string; lastMessage: Message; unread: number }>> {
  const db = await getKv();
  const convMap = new Map<string, { lastMessage: Message; unread: number }>();
  for await (const entry of db.list<Message>({ prefix: orgKey(orgId, "message", email) })) {
    const msg = entry.value;
    if (!msg) continue;
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
