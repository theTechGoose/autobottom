import { z } from "zod";

export const ReviewItemSchema = z.object({
  findingId: z.string(),
  questionIndex: z.number(),
  header: z.string(),
  populated: z.string(),
  thinking: z.string(),
  defense: z.string(),
  answer: z.string(),
});

export const ReviewDecisionSchema = ReviewItemSchema.extend({
  decision: z.enum(["confirm", "flip"]),
  reviewer: z.string(),
  decidedAt: z.number(),
});

export const ReviewerLeaderboardEntrySchema = z.object({
  reviewer: z.string(),
  decisions: z.number(),
  confirms: z.number(),
  flips: z.number(),
  flipRate: z.string(),
});

export const ReviewerDashboardDataSchema = z.object({
  queue: z.object({ pending: z.number(), decided: z.number() }),
  personal: z.object({
    totalDecisions: z.number(),
    confirmCount: z.number(),
    flipCount: z.number(),
    avgDecisionSpeedMs: z.number(),
  }),
  byReviewer: z.array(ReviewerLeaderboardEntrySchema),
  recentDecisions: z.array(ReviewDecisionSchema),
});

export type ReviewItem = z.infer<typeof ReviewItemSchema>;
export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;
export type ReviewerLeaderboardEntry = z.infer<typeof ReviewerLeaderboardEntrySchema>;
export type ReviewerDashboardData = z.infer<typeof ReviewerDashboardDataSchema>;
