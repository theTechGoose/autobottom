import { z } from "zod";

export const WebhookKindSchema = z.enum(["terminate", "appeal", "manager", "judge"]);

export const WebhookConfigSchema = z.object({
  postUrl: z.string(),
  postHeaders: z.record(z.string(), z.string()),
});

export type WebhookKind = z.infer<typeof WebhookKindSchema>;
export type WebhookConfig = z.infer<typeof WebhookConfigSchema>;
