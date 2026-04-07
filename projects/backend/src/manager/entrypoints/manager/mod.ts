import "reflect-metadata";
import { Controller, Get, Post, Req } from "@danet/core";
import { z } from "zod";
import { ManagerCoordinator } from "../../domain/coordinators/manager/mod.ts";
import { resolveEffectiveAuth, listUsers, createUser, deleteUser } from "../../../auth/domain/coordinators/auth/impl.ts";
import type { AuthContext, Role } from "../../../auth/domain/coordinators/auth/impl.ts";
import { getGameState, getEarnedBadges, emitEvent } from "../../../core/data/kv/impl.ts";
import { validate, ValidationError } from "../../../core/business/validate/mod.ts";

const RemediateSchema = z.object({
  findingId: z.string().min(1),
  notes: z.string().min(20),
});

// Danet's @Req() decorator type is incompatible with experimentalDecorators; cast to ParameterDecorator.
const ReqParam: () => ParameterDecorator = Req as any;

function json(data: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

async function requireAuth(req: Request): Promise<AuthContext | Response> {
  const auth = await resolveEffectiveAuth(req);
  if (!auth) return json({ error: "unauthorized" }, 401);
  return auth;
}

const ALLOWED_ROLES: Role[] = ["user", "reviewer"];

@Controller("manager/api")
export class ManagerController {
  constructor(private manager: ManagerCoordinator) {}

  @Get("me")
  async me(@ReqParam() req: Request): Promise<Response> {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;
    return json({ username: auth.email, role: auth.role });
  }

  @Get("queue")
  async queue(@ReqParam() req: Request): Promise<Response> {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;

    const items = await this.manager.getManagerQueue(auth.orgId);
    return json(items);
  }

  @Get("finding")
  async finding(@ReqParam() req: Request): Promise<Response> {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;

    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) return json({ error: "id parameter required" }, 400);

    const detail = await this.manager.getManagerFindingDetail(auth.orgId, id);
    if (!detail) return json({ error: "finding not found" }, 404);

    return json(detail);
  }

  @Post("remediate")
  async remediate(@ReqParam() req: Request): Promise<Response> {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;

    let parsed;
    try {
      const body = await req.json();
      parsed = validate(RemediateSchema, body);
    } catch (e) {
      if (e instanceof ValidationError) return json({ error: e.message }, 400);
      throw e;
    }
    const { findingId, notes } = parsed;

    const result = await this.manager.submitRemediation(auth.orgId, findingId, notes.trim(), auth.email);
    if (!result.success) return json({ error: "finding not in manager queue" }, 404);

    // Emit remediation-submitted event
    emitEvent(auth.orgId, auth.email, "remediation-submitted", {
      findingId,
      manager: auth.email,
    }).catch(() => {});

    const newBadges = result.newBadges.map(({ check: _, ...rest }) => rest);
    return json({ ok: true, findingId, xpGained: result.xpGained, level: result.level, newBadges });
  }

  @Get("stats")
  async stats(@ReqParam() req: Request): Promise<Response> {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;

    const stats = await this.manager.getManagerStats(auth.orgId);
    return json(stats);
  }

  @Post("backfill")
  async backfill(@ReqParam() req: Request): Promise<Response> {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;

    const result = await this.manager.backfillManagerQueue(auth.orgId);
    return json(result);
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

  // -- User Management (managers create and manage their own users) --

  @Get("agents")
  async listAgents(@ReqParam() req: Request): Promise<Response> {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;
    if (auth.role !== "manager" && auth.role !== "admin") return json({ error: "forbidden" }, 403);

    const allUsers = await listUsers(auth.orgId);
    // Filter to users supervised by this manager (or all non-admin/non-manager for admin)
    const filtered = auth.role === "admin"
      ? allUsers.filter((a) => a.role === "user" || a.role === "reviewer")
      : allUsers.filter((a) => a.supervisor === auth.email);
    return json(filtered);
  }

  @Post("agents/create")
  async createAgent(@ReqParam() req: Request): Promise<Response> {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;
    if (auth.role !== "manager" && auth.role !== "admin") return json({ error: "forbidden" }, 403);

    const body = await req.json();
    const { email, password, role } = body;
    if (!email || !password) return json({ error: "email and password required" }, 400);

    const assignedRole: Role = ALLOWED_ROLES.includes(role) ? role : "user";

    await createUser(auth.orgId, email, password, assignedRole, auth.email);
    return json({ ok: true, email, role: assignedRole, supervisor: auth.email });
  }

  @Post("agents/delete")
  async deleteAgent(@ReqParam() req: Request): Promise<Response> {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;
    if (auth.role !== "manager" && auth.role !== "admin") return json({ error: "forbidden" }, 403);

    const body = await req.json();
    const { email } = body;
    if (!email) return json({ error: "email required" }, 400);

    await deleteUser(auth.orgId, email);
    return json({ ok: true, email });
  }
}
