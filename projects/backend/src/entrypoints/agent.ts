/** HTTP handlers for agent dashboard API routes. Uses unified auth. */

import { resolveEffectiveAuth } from "../domain/coordinators/auth/mod.ts";
import type { AuthContext } from "../domain/coordinators/auth/mod.ts";
import { getAgentDashboardData } from "../domain/coordinators/agent/mod.ts";
import { getGameState, getEarnedBadges, purchaseStoreItem, listCustomStoreItems } from "../domain/data/kv/mod.ts";
import { STORE_CATALOG } from "../domain/business/gamification/badges/mod.ts";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function requireAuth(req: Request): Promise<AuthContext | Response> {
  const auth = await resolveEffectiveAuth(req);
  if (!auth) return json({ error: "unauthorized" }, 401);
  return auth;
}

// -- Dashboard Data --

export async function handleAgentDashboardData(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const data = await getAgentDashboardData(auth.orgId, auth.email);
  return json(data);
}

// -- Me --

export async function handleAgentMe(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  return json({ username: auth.email, role: auth.role });
}

// -- Game State --

export async function handleAgentGameState(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const [gameState, badges] = await Promise.all([
    getGameState(auth.orgId, auth.email),
    getEarnedBadges(auth.orgId, auth.email),
  ]);

  return json({ ...gameState, badges: badges.map((b) => b.badgeId) });
}

// -- Store --

export async function handleAgentStore(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const [gameState, customItems] = await Promise.all([
    getGameState(auth.orgId, auth.email),
    listCustomStoreItems(auth.orgId),
  ]);
  return json({
    items: [...STORE_CATALOG, ...customItems],
    balance: gameState.tokenBalance,
    purchased: gameState.purchases,
    level: gameState.level,
    totalXp: gameState.totalXp,
  });
}

export async function handleAgentStoreBuy(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const body = await req.json();
  const { itemId } = body;
  if (!itemId) return json({ error: "itemId required" }, 400);

  let item = STORE_CATALOG.find((i) => i.id === itemId);
  if (!item) {
    const customItems = await listCustomStoreItems(auth.orgId);
    item = customItems.find((i) => i.id === itemId);
  }
  if (!item) return json({ error: "item not found" }, 404);

  const result = await purchaseStoreItem(auth.orgId, auth.email, itemId, item.price);
  if (!result.ok) return json({ error: result.error }, 400);

  return json({ ok: true, itemId, newBalance: result.newBalance });
}
