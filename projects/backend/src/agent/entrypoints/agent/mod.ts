import "reflect-metadata";
import { Controller, Get, Post, Req } from "@danet/core";
import { AgentCoordinator } from "../../domain/coordinators/agent/mod.ts";
import { resolveEffectiveAuth } from "../../../auth/domain/coordinators/auth/impl.ts";
import type { AuthContext } from "../../../auth/domain/coordinators/auth/impl.ts";
import { getGameState, getEarnedBadges, purchaseStoreItem, listCustomStoreItems } from "../../../core/data/kv/impl.ts";
import { STORE_CATALOG } from "../../../core/business/store/mod.ts";

// Danet's @Req() decorator type is incompatible with experimentalDecorators; cast to ParameterDecorator.
const ReqParam: () => ParameterDecorator = Req as any;

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

@Controller("agent/api")
export class AgentController {
  constructor(private agent: AgentCoordinator) {}

  @Get("dashboard")
  async dashboard(@ReqParam() req: Request): Promise<Response> {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;

    const data = await this.agent.getAgentDashboardData(auth.orgId, auth.email);
    return json(data);
  }

  @Get("me")
  async me(@ReqParam() req: Request): Promise<Response> {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;

    return json({ username: auth.email, role: auth.role });
  }

  @Get("game-state")
  async gameState(@ReqParam() req: Request): Promise<Response> {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;

    const [state, badges] = await Promise.all([
      getGameState(auth.orgId, auth.email),
      getEarnedBadges(auth.orgId, auth.email),
    ]);

    return json({ ...state, badges: badges.map((b) => b.badgeId) });
  }

  @Get("store")
  async store(@ReqParam() req: Request): Promise<Response> {
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

  @Post("store/buy")
  async storeBuy(@ReqParam() req: Request): Promise<Response> {
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
}
