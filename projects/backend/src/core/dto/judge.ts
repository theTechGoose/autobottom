import { z } from "zod";

export const JudgeItemSchema = z.object({
  findingId: z.string(),
  questionIndex: z.number(),
  header: z.string(),
  populated: z.string(),
  thinking: z.string(),
  defense: z.string(),
  answer: z.string(),
  appealType: z.string().optional(),
});

export const JudgeDecisionSchema = JudgeItemSchema.extend({
  decision: z.enum(["uphold", "overturn"]),
  reason: z.enum(["error", "logic", "fragment", "transcript"]).optional(),
  judge: z.string(),
  decidedAt: z.number(),
});

export const AppealRecordSchema = z.object({
  findingId: z.string(),
  appealedAt: z.number(),
  status: z.enum(["pending", "complete"]),
  judgedBy: z.string().optional(),
  auditor: z.string().optional(),
  comment: z.string().optional(),
});

export const AppealStatsSchema = z.object({
  totalAppeals: z.number(),
  overturned: z.number(),
  upheld: z.number(),
});

export const AppealHistorySchema = z.object({
  findingId: z.string(),
  auditor: z.string(),
  judgedBy: z.string(),
  originalScore: z.number(),
  finalScore: z.number(),
  overturns: z.number(),
  timestamp: z.number(),
});

export type JudgeItem = z.infer<typeof JudgeItemSchema>;
export type JudgeDecision = z.infer<typeof JudgeDecisionSchema>;
export type AppealRecord = z.infer<typeof AppealRecordSchema>;
export type AppealStats = z.infer<typeof AppealStatsSchema>;
export type AppealHistory = z.infer<typeof AppealHistorySchema>;
