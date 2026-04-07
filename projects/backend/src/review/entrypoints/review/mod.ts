import "reflect-metadata";
import { Controller, Get, Post, Req } from "@danet/core";
import { z } from "zod";
import { ReviewCoordinator } from "../../domain/coordinators/review/mod.ts";
import { resolveEffectiveAuth } from "../../../auth/domain/coordinators/auth/impl.ts";
import type { AuthContext } from "../../../auth/domain/coordinators/auth/impl.ts";
import { emitEvent, getWebhookConfig, saveWebhookConfig } from "../../../core/data/kv/impl.ts";
import type { WebhookConfig } from "../../../core/data/kv/impl.ts";
import { validate, ValidationError } from "../../../core/business/validate/mod.ts";

const ReviewDecideSchema = z.object({
  findingId: z.string().min(1),
  questionIndex: z.number(),
  decision: z.enum(["confirm", "flip"]),
  combo: z.number().optional(),
  level: z.number().optional(),
  speedMs: z.number().optional(),
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

@Controller("review/api")
export class ReviewController {
  constructor(private review: ReviewCoordinator) {}

  @Get("next")
  async next(@ReqParam() req: Request): Promise<Response> {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;

    const result = await this.review.claimNextItem(auth.orgId, auth.email);
    return json(result);
  }

  @Post("decide")
  async decide(@ReqParam() req: Request): Promise<Response> {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;

    let parsed;
    try {
      const body = await req.json();
      parsed = validate(ReviewDecideSchema, body);
    } catch (e) {
      if (e instanceof ValidationError) return json({ error: e.message }, 400);
      throw e;
    }
    const { findingId, questionIndex, decision, combo, level, speedMs } = parsed;

    const result = await this.review.recordDecision(
      auth.orgId, findingId, questionIndex, decision, auth.email,
      combo ?? undefined, level ?? undefined, speedMs ?? undefined,
    );
    if (!result.success) {
      return json({ error: "failed to record decision (lock expired or not owned)" }, 409);
    }

    // Emit review-decided event when an audit's review is fully complete
    if (result.auditComplete) {
      emitEvent(auth.orgId, auth.email, "review-decided", {
        findingId,
        reviewer: auth.email,
        decision,
      }).catch(() => {});
    }

    // Claim next item for the reviewer
    const next = await this.review.claimNextItem(auth.orgId, auth.email);

    const newBadges = result.newBadges.map(({ check: _, ...rest }) => rest);
    return json({ decided: { findingId, questionIndex, decision }, auditComplete: result.auditComplete, next, newBadges });
  }

  @Post("back")
  async back(@ReqParam() req: Request): Promise<Response> {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;

    const result = await this.review.undoDecision(auth.orgId, auth.email);
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

  @Get("settings")
  async getSettings(@ReqParam() req: Request): Promise<Response> {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;

    const settings = await getWebhookConfig(auth.orgId, "terminate");
    return json(settings ?? { postUrl: "", postHeaders: {} });
  }

  @Post("settings")
  async saveSettings(@ReqParam() req: Request): Promise<Response> {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;

    const body = await req.json();
    const settings: WebhookConfig = {
      postUrl: body.postUrl ?? "",
      postHeaders: body.postHeaders ?? {},
    };

    await saveWebhookConfig(auth.orgId, "terminate", settings);
    return json({ ok: true });
  }

  @Get("stats")
  async stats(@ReqParam() req: Request): Promise<Response> {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;

    const stats = await this.review.getReviewStats(auth.orgId);
    return json(stats);
  }

  @Post("backfill")
  async backfill(@ReqParam() req: Request): Promise<Response> {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;

    const result = await this.review.backfillFromFinished(auth.orgId);
    return json(result);
  }

  @Get("dashboard")
  async dashboard(@ReqParam() req: Request): Promise<Response> {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;

    const data = await this.review.getReviewerDashboardData(auth.orgId, auth.email);
    return json(data);
  }

  @Get("me")
  async me(@ReqParam() req: Request): Promise<Response> {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;
    return json({ username: auth.email, role: auth.role });
  }
}
