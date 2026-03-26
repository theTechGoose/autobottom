import { z } from "zod";

export const ManagerQueueItemSchema = z.object({
  findingId: z.string(),
  owner: z.string(),
  recordId: z.string(),
  recordingId: z.string(),
  totalQuestions: z.number(),
  failedCount: z.number(),
  completedAt: z.number(),
  jobTimestamp: z.string(),
  status: z.enum(["pending", "addressed"]),
});

export const ManagerRemediationSchema = z.object({
  findingId: z.string(),
  notes: z.string(),
  addressedBy: z.string(),
  addressedAt: z.number(),
});

export type ManagerQueueItem = z.infer<typeof ManagerQueueItemSchema>;
export type ManagerRemediation = z.infer<typeof ManagerRemediationSchema>;
