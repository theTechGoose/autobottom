/** Review API controller — wired to real review queue service. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body, Query } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { ReturnedType, Description, BodyType } from "#danet/swagger-decorators";
import { ReviewBufferResponse, DecisionResponse, ReviewStatsResponse, OkResponse, OkMessageResponse, ReviewerConfigResponse, MessageResponse, GamificationSettingsResponse } from "@core/dto/responses.ts";
import { GenericBodyRequest, ReviewDecideRequest, ReviewBackRequest } from "@core/dto/requests.ts";
import { recordDecision, finalizeReviewedAudit, getReviewStats, getReviewedFindingIds, clearReviewQueue, getFailedQuestionsForFinding, getDecisionsByFinding, discardReview, jumpToQuestion } from "@review/domain/business/review-queue/mod.ts";
import { getReviewerConfig } from "@admin/domain/data/admin-repository/mod.ts";

import { defaultOrgId } from "@core/business/auth/mod.ts";
const ORG = defaultOrgId;

/** Soft-fallback helper: log + return a safe response shape so an FS abort
 *  never propagates as a 5xx. Used by every FS-touching endpoint in this
 *  controller. Reviewers were seeing raw "API 500: signal aborted" toasts
 *  when Firestore briefly wedged — this collapses that into a recoverable
 *  state the frontend can retry against. */
function softFail<T>(ctx: string, err: unknown, fallback: T): T {
  console.warn(`⚠️ [REVIEW] ${ctx} failed — soft fallback:`, err);
  return fallback;
}

@SwaggerDescription("Review — human-in-the-loop audit verification")
@Controller("review/api")
export class ReviewController {

  @Get("next") @ReturnedType(ReviewBufferResponse) @Description("Claim next review items (FIFO oldest audit first)")
  async next(@Query("types") types: string, @Query("reviewer") reviewer: string) {
    if (!reviewer) return { error: "reviewer query param required" };
    try {
      const { claimNextItemLegacy: claimNextItem } = await import("@review/domain/business/review-queue/mod.ts");
      const allowedTypes = types ? types.split(",").map((t: string) => t.trim()) : undefined;
      const result = await claimNextItem(ORG(), reviewer, allowedTypes);
      const fid = result.buffer[0]?.findingId;
      if (!fid) return { ...result, fullBuffer: [], decisions: {} };
      const [fullBuffer, decisions] = await Promise.all([
        getFailedQuestionsForFinding(ORG(), fid),
        getDecisionsByFinding(ORG(), fid, reviewer),
      ]);
      return { ...result, fullBuffer, decisions };
    } catch (err) {
      // Soft-fallback with `retry: true` — frontend keeps polling instead
      // of rendering the "All caught up" empty state. Without retry, an
      // FS wedge looked like an empty queue and reviewers got stuck on a
      // dead end with no recovery path.
      console.warn(`⚠️ [REVIEW] next() failed for ${reviewer} — returning retry signal:`, err);
      return { buffer: [], remaining: 0, retry: true, fullBuffer: [], decisions: {} };
    }
  }

  @Post("decide") @ReturnedType(DecisionResponse) @Description("Confirm or flip a reviewed question") @BodyType(ReviewDecideRequest)
  async decide(@Body() body: { findingId: string; questionIndex: number; decision: "confirm" | "flip"; reviewer: string }) {
    if (!body.findingId || body.questionIndex == null || !body.decision || !body.reviewer) {
      return { error: "findingId, questionIndex, decision, reviewer required" };
    }
    try {
      const result = await recordDecision(ORG(), body.findingId, body.questionIndex, body.decision, body.reviewer);
      const [fullBuffer, decisions] = await Promise.all([
        getFailedQuestionsForFinding(ORG(), body.findingId),
        getDecisionsByFinding(ORG(), body.findingId, body.reviewer),
      ]);
      ReviewController._bustStatsCache();
      return {
        ok: true,
        ...result,
        xpGained: body.decision === "flip" ? 15 : 10,
        newBadges: [] as string[],
        fullBuffer,
        decisions,
      };
    } catch (err) {
      return softFail(`decide ${body.findingId}/${body.questionIndex}`, err, {
        ok: false, retry: true, remaining: 0, auditComplete: false,
        xpGained: 0, newBadges: [] as string[],
        fullBuffer: [], decisions: {},
        error: "Server busy, please retry",
      });
    }
  }

  @Post("finalize") @ReturnedType(OkResponse) @Description("Finalize a reviewed audit — apply flips, recompute score, fire terminate webhook") @BodyType(GenericBodyRequest)
  async finalize(@Body() body: GenericBodyRequest) {
    const b = body as { findingId?: string; reviewer?: string };
    if (!b.findingId || !b.reviewer) return { error: "findingId and reviewer required" };
    try {
      const r = await finalizeReviewedAudit(ORG(), b.findingId, b.reviewer);
      ReviewController._bustStatsCache();
      return { ok: true, score: r.score, alreadyFinalized: r.alreadyFinalized ?? false };
    } catch (err) {
      console.error(`❌ [REVIEW] finalize failed for ${b.findingId}:`, err);
      return { ok: false, error: String(err) };
    }
  }

  @Post("back") @ReturnedType(ReviewBufferResponse) @Description("Undo last decision") @BodyType(ReviewBackRequest)
  async back(@Body() body: { findingId: string; questionIndex: number; reviewer: string }) {
    if (!body.reviewer) return { error: "reviewer required" };
    try {
      const { undoDecisionLegacy: undoDecision } = await import("@review/domain/business/review-queue/mod.ts");
      const result = await undoDecision(ORG(), body.reviewer);
      ReviewController._bustStatsCache();
      return result;
    } catch (err) {
      return softFail(`back ${body.reviewer}`, err, { buffer: [], remaining: 0, retry: true });
    }
  }

  @Get("jump") @ReturnedType(ReviewBufferResponse) @Description("Switch to a specific failed question on the current audit")
  async jump(
    @Query("findingId") findingId: string,
    @Query("questionIndex") questionIndex: string,
    @Query("reviewer") reviewer: string,
  ) {
    if (!findingId || !reviewer || questionIndex == null) {
      return { error: "findingId, questionIndex, reviewer required" };
    }
    try {
      const qi = parseInt(questionIndex, 10);
      const result = await jumpToQuestion(ORG(), reviewer, findingId, qi);
      return result;
    } catch (err) {
      return softFail(`jump ${findingId}/${questionIndex}`, err, {
        buffer: [], remaining: 0, retry: true, fullBuffer: [], decisions: {},
      });
    }
  }

  @Get("stats") @ReturnedType(ReviewStatsResponse) @Description("Review queue statistics")
  async stats() {
    // Delegate to dashboardData() so the 10s frontend poll shares the same
    // 5s cache + try/catch + cache-busting wired into dashboardData. The
    // poll used to hit getReviewStats raw — no cache, no fallback — which
    // is why the dashboard numbers stayed stale all weekend even when the
    // SSR pulled fresh data on initial load.
    return this.dashboardData();
  }

  @Get("settings") @ReturnedType(ReviewerConfigResponse) @Description("Get reviewer settings")
  async getSettings(@Query("email") email: string) {
    if (!email) return { error: "email required" };
    try {
      return (await getReviewerConfig(ORG(), email)) ?? { allowedTypes: ["date-leg", "package"] };
    } catch (err) {
      return softFail(`getSettings ${email}`, err, { allowedTypes: ["date-leg", "package"] });
    }
  }

  @Post("settings") @ReturnedType(OkResponse) @Description("Save reviewer settings") @BodyType(GenericBodyRequest)
  async saveSettings(@Body() body: GenericBodyRequest) {
    const b = body as any;
    if (!b.email || !b.config) return { error: "email and config required" };
    try {
      const { saveReviewerConfig } = await import("@admin/domain/data/admin-repository/mod.ts");
      await saveReviewerConfig(ORG(), b.email, b.config);
      return { ok: true };
    } catch (err) {
      return softFail(`saveSettings ${b.email}`, err, { ok: false, retry: true, error: "Server busy, please retry" });
    }
  }

  // /review/api/me is dispatched directly from main.ts (AUTH_CONTEXT_HANDLERS)
  // — needs the session cookie, danet's @Req doesn't work via router.fetch.

  @Get("preview") @ReturnedType(ReviewBufferResponse) @Description("Preview a finding for review")
  async preview(@Query("findingId") findingId: string) {
    if (!findingId) return { error: "findingId required" };
    try {
      const { previewFindingLegacy: previewFinding } = await import("@review/domain/business/review-queue/mod.ts");
      const items = await previewFinding(ORG(), findingId);
      return { buffer: items ?? [], remaining: 0 };
    } catch (err) {
      return softFail(`preview ${findingId}`, err, { buffer: [], remaining: 0, retry: true });
    }
  }

  // 5s result cache + in-flight promise dedup. The review dashboard polls
  // this endpoint every 10s, getReviewStats does 3 paginated FS scans
  // (pending/active/decided), and reviewer pages hit it in parallel.
  // Without coalescing, every poll re-runs the full scan against
  // Firestore — the same thundering-herd pattern that took down the
  // admin dashboard before its cache landed. Same pattern as
  // DashboardController._dashCache (admin/entrypoints/dashboard/mod.ts).
  private static _statsCache: { data: Awaited<ReturnType<typeof getReviewStats>>; expiresAt: number } | null = null;
  private static _statsPending: Promise<Awaited<ReturnType<typeof getReviewStats>>> | null = null;
  // Last successful result, NEVER cleared by _bustStatsCache. When the
  // refresh-after-bust race aborts under FS wedge, the soft-fallback path
  // serves this instead of dropping the dashboard to zeros. Stale-by-N-
  // seconds is invisible; zeros look like a broken panel and confuse
  // reviewers mid-shift.
  private static _statsLastGood: Awaited<ReturnType<typeof getReviewStats>> | null = null;
  /** Drop the 5s stats cache. Called after every state-changing endpoint
   *  (decide, back, finalize, discard, backfill) so the reviewer sees their
   *  own work reflected on the next poll rather than waiting up to 5s.
   *  Does NOT clear _statsLastGood — that lives across busts as a safety
   *  net for the soft-fallback path. */
  private static _bustStatsCache(): void {
    ReviewController._statsCache = null;
    ReviewController._statsPending = null;
  }
  @Get("dashboard") @ReturnedType(ReviewStatsResponse) @Description("Review dashboard data")
  async dashboardData() {
    const now = Date.now();
    const cached = ReviewController._statsCache;
    if (cached && cached.expiresAt > now) return cached.data;
    if (ReviewController._statsPending) return ReviewController._statsPending;
    const pending = (async () => {
      try {
        const data = await getReviewStats(ORG());
        // 15s TTL (was 5s). Dashboard polls every 10s, so a 5s cache
        // missed nearly every poll. 15s means 2-3 polls share each
        // underlying scan, cutting foreground FS load from review-
        // stats queries by ~3×. Reviewer's own work is reflected
        // immediately because _bustStatsCache() fires on decide/back/
        // finalize/discard/backfill — the cache only ages out
        // naturally for unrelated viewers.
        ReviewController._statsCache = { data, expiresAt: Date.now() + 15_000 };
        ReviewController._statsLastGood = data;
        return data;
      } catch (err) {
        // Under FS wedge, fall back to whatever's cached (even if stale)
        // so the panel keeps rendering. Without this catch the rejection
        // bubbles to the HTTP layer as a 500, which the frontend retry
        // loop then amplifies. Stale data > broken panel.
        //
        // Three-tier fallback:
        //   1) Current cache (stale-but-fresh-ish, may include reviewer's
        //      own most recent decide).
        //   2) _statsLastGood — survives _bustStatsCache calls. This
        //      handles the worst-case race: reviewer decides → bust →
        //      poll refetch aborts → would otherwise return zeros.
        //   3) Zero shape — only on cold start before we've ever seen
        //      real data.
        // All three set `stale: true` so the frontend can show a
        // subtle hint that the number is provisional.
        console.warn(`⚠️ [REVIEW] dashboardData failed — serving cached/empty:`, err);
        if (cached) return { ...cached.data, stale: true } as typeof cached.data;
        if (ReviewController._statsLastGood) {
          return { ...ReviewController._statsLastGood, stale: true } as typeof ReviewController._statsLastGood;
        }
        return {
          pending: 0, decided: 0, pendingAuditCount: 0,
          dateLegPending: 0, dateLegDecided: 0,
          packagePending: 0, packageDecided: 0,
          stale: true,
        } as Awaited<ReturnType<typeof getReviewStats>>;
      } finally {
        ReviewController._statsPending = null;
      }
    })();
    ReviewController._statsPending = pending;
    return pending;
  }

  @Get("gamification") @ReturnedType(GamificationSettingsResponse) @Description("Get reviewer gamification override (or empty if none set)")
  async getGamification(@Query("email") email: string) {
    if (!email) return {};
    try {
      const { getReviewerGamificationOverride } = await import("@gamification/domain/data/gamification-repository/mod.ts");
      return (await getReviewerGamificationOverride(ORG(), email)) ?? {};
    } catch (err) {
      return softFail(`getGamification ${email}`, err, {});
    }
  }

  @Post("gamification") @ReturnedType(OkResponse) @Description("Save reviewer gamification override") @BodyType(GenericBodyRequest)
  async saveGamification(@Body() body: GenericBodyRequest) {
    const b = body as { email?: string; settings?: Record<string, unknown> };
    if (!b.email) return { error: "email required" };
    try {
      const { saveReviewerGamificationOverride } = await import("@gamification/domain/data/gamification-repository/mod.ts");
      await saveReviewerGamificationOverride(ORG(), b.email, (b.settings ?? {}) as any);
      return { ok: true };
    } catch (err) {
      return softFail(`saveGamification ${b.email}`, err, { ok: false, retry: true, error: "Server busy, please retry" });
    }
  }

  @Post("backfill") @ReturnedType(OkMessageResponse) @Description("Backfill review queue")
  async backfill() {
    try {
      const { backfillFromFinishedLegacy: backfillFromFinished } = await import("@review/domain/business/review-queue/mod.ts");
      await backfillFromFinished(ORG());
      ReviewController._bustStatsCache();
      return { ok: true };
    } catch (err) {
      return softFail("backfill", err, { ok: false, retry: true, error: "Server busy, please retry" });
    }
  }

  @Post("discard") @ReturnedType(OkResponse) @Description("Release stranded review claim — moves all decisions for findingId back to pending") @BodyType(GenericBodyRequest)
  async discard(@Body() body: GenericBodyRequest) {
    const b = body as { findingId?: string; reviewer?: string };
    if (!b.findingId || !b.reviewer) return { error: "findingId and reviewer required" };
    try {
      const r = await discardReview(ORG(), b.reviewer, b.findingId);
      ReviewController._bustStatsCache();
      return { ok: true, restored: r.restored };
    } catch (err) {
      console.error(`❌ [REVIEW] discard failed for ${b.findingId}:`, err);
      return { ok: false, error: String(err) };
    }
  }
}
