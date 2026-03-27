/** HTTP handlers for prefab subscription endpoints. */

import { requireAuth, json } from "./helpers.ts";
import { getPrefabSubscriptions, savePrefabSubscriptions } from "../domain/data/kv/mod.ts";

export async function handleGetPrefabSubscriptions(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  if (auth.role !== "manager" && auth.role !== "admin") return json({ error: "forbidden" }, 403);
  const subs = await getPrefabSubscriptions(auth.orgId);
  return json({ subscriptions: subs });
}

export async function handleSavePrefabSubscriptions(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  if (auth.role !== "manager" && auth.role !== "admin") return json({ error: "forbidden" }, 403);
  const body = await req.json();
  const { subscriptions } = body;
  if (!subscriptions || typeof subscriptions !== "object") return json({ error: "subscriptions object required" }, 400);
  await savePrefabSubscriptions(auth.orgId, subscriptions);
  return json({ ok: true });
}
