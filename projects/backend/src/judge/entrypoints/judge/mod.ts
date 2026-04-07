import "reflect-metadata";
import { Controller, Get, Post, Req } from "@danet/core";
import { z } from "zod";
import { JudgeCoordinator } from "../../domain/coordinators/judge/mod.ts";
import { resolveEffectiveAuth, listUsers, createUser, deleteUser } from "../../../auth/domain/coordinators/auth/impl.ts";
import type { AuthContext } from "../../../auth/domain/coordinators/auth/impl.ts";
import { emitEvent } from "../../../core/data/kv/impl.ts";
import { validate, ValidationError } from "../../../core/business/validate/mod.ts";

const DecideSchema = z.object({
  findingId: z.string().min(1),
  questionIndex: z.number(),
  decision: z.enum(["uphold", "overturn"]),
  reason: z.enum(["error", "logic", "fragment", "transcript"]).optional(),
  combo: z.number().optional(),
  level: z.number().optional(),
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

@Controller("judge/api")
export class JudgeController {
  constructor(private judge: JudgeCoordinator) {}

  @Get("next")
  async next(@ReqParam() req: Request): Promise<Response> {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;

    const result = await this.judge.claimNextItem(auth.orgId, auth.email);
    return json(result);
  }

  @Post("decide")
  async decide(@ReqParam() req: Request): Promise<Response> {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;

    let parsed;
    try {
      const body = await req.json();
      parsed = validate(DecideSchema, body);
    } catch (e) {
      if (e instanceof ValidationError) return json({ error: e.message }, 400);
      throw e;
    }
    const { findingId, questionIndex, decision, reason, combo, level } = parsed;

    const result = await this.judge.recordDecision(
      auth.orgId, findingId, questionIndex, decision, auth.email,
      reason || undefined, combo ?? undefined, level ?? undefined,
    );
    if (!result.success) {
      return json({ error: "failed to record decision (lock expired or not owned)" }, 409);
    }

    // Emit appeal-decided event when an appeal is fully judged
    if (result.auditComplete) {
      emitEvent(auth.orgId, auth.email, "appeal-decided", {
        findingId,
        judge: auth.email,
        decision,
      }).catch(() => {});
    }

    const next = await this.judge.claimNextItem(auth.orgId, auth.email);

    const newBadges = result.newBadges.map(({ check: _, ...rest }) => rest);
    return json({ decided: { findingId, questionIndex, decision, reason: reason || null }, auditComplete: result.auditComplete, next, newBadges });
  }

  @Post("back")
  async back(@ReqParam() req: Request): Promise<Response> {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;

    const result = await this.judge.undoDecision(auth.orgId, auth.email);
    if (!result.restored) {
      return json({ error: "nothing to undo" }, 404);
    }

    return json({
      current: result.restored,
      transcript: result.transcript,
      peek: result.peek,
      remaining: result.remaining,
      auditRemaining: result.auditRemaining,
    });
  }

  @Get("stats")
  async stats(@ReqParam() req: Request): Promise<Response> {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;

    const stats = await this.judge.getJudgeStats(auth.orgId);
    return json(stats);
  }

  @Get("dashboard")
  async dashboard(@ReqParam() req: Request): Promise<Response> {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;

    const data = await this.judge.getJudgeDashboardData(auth.orgId);
    return json(data);
  }

  @Get("me")
  async me(@ReqParam() req: Request): Promise<Response> {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;
    return json({ username: auth.email, role: auth.role });
  }

  // -- Reviewer Management (judges manage their own reviewers) --

  @Get("reviewers")
  async listReviewers(@ReqParam() req: Request): Promise<Response> {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;
    if (auth.role !== "judge" && auth.role !== "admin") return json({ error: "forbidden" }, 403);

    const reviewers = await listUsers(auth.orgId, "reviewer");
    // Filter to only reviewers supervised by this judge (or all for admin)
    const filtered = auth.role === "admin"
      ? reviewers
      : reviewers.filter((r) => r.supervisor === auth.email);
    return json(filtered);
  }

  @Post("reviewers/create")
  async createReviewer(@ReqParam() req: Request): Promise<Response> {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;
    if (auth.role !== "judge" && auth.role !== "admin") return json({ error: "forbidden" }, 403);

    const body = await req.json();
    const { email, password } = body;
    if (!email || !password) return json({ error: "email and password required" }, 400);

    await createUser(auth.orgId, email, password, "reviewer", auth.email);
    return json({ ok: true, email, role: "reviewer", supervisor: auth.email });
  }

  @Post("reviewers/delete")
  async deleteReviewer(@ReqParam() req: Request): Promise<Response> {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;
    if (auth.role !== "judge" && auth.role !== "admin") return json({ error: "forbidden" }, 403);

    const body = await req.json();
    const { email } = body;
    if (!email) return json({ error: "email required" }, 400);

    await deleteUser(auth.orgId, email);
    return json({ ok: true, email });
  }
}
