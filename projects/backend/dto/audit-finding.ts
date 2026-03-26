import { z } from "zod";
import { AnsweredQuestionSchema, QuestionSeedSchema, QuestionSchema } from "./question.ts";

const FeedbackCardDataSchema = z.object({
  heading: z.string(),
  text: z.string(),
  viewUrl: z.string(),
  recordingUrl: z.string().optional(),
  disputeUrl: z.string().optional(),
});

const FindingStatusSchema = z.enum([
  "pending", "no recording", "retrying", "creating-job", "pulling-record",
  "getting-recording", "transcribing", "populating-questions", "asking-questions", "finished",
]);

// Forward reference to AuditJobSchema (circular: finding.job)
const AuditJobRefSchema = z.object({
  id: z.string(),
  doneAuditIds: z.array(z.object({ auditId: z.string(), auditRecord: z.string() })),
  status: z.enum(["pending", "running", "paused", "failed", "retrying", "finished"]),
  timestamp: z.string(),
  owner: z.string(),
  updateEndpoint: z.string(),
  recordsToAudit: z.array(z.string()),
});

export const AuditFindingSchema = z.object({
  id: z.string(),
  auditJobId: z.string(),
  findingStatus: FindingStatusSchema.optional(),
  recordingPath: z.string().optional(),
  recordingId: z.string().optional(),
  rawTranscript: z.string().optional(),
  fixedTranscript: z.string().optional(),
  diarizedTranscript: z.string().optional(),
  unpopulatedQuestions: z.array(QuestionSeedSchema).optional(),
  populatedQuestions: z.array(QuestionSchema).optional(),
  answeredQuestions: z.array(AnsweredQuestionSchema).optional(),
  feedback: FeedbackCardDataSchema,
  job: AuditJobRefSchema,
  record: z.record(z.string(), z.unknown()),
  recordingIdField: z.string(),
  owner: z.string().optional(),
  updateEndpoint: z.string().optional(),
  s3RecordingKey: z.string().optional(),
  s3RecordingKeys: z.array(z.string()).optional(),
  qlabConfig: z.string().optional(),
  genieIds: z.array(z.string()).optional(),
  snipStart: z.number().optional(),
  snipEnd: z.number().optional(),
  appealSourceFindingId: z.string().optional(),
  appealType: z.enum(["redo", "different-recording", "additional-recording", "upload-recording"]).optional(),
  appealComment: z.string().optional(),
  reAuditedAt: z.number().optional(),
}).passthrough();

export type AuditFinding = z.infer<typeof AuditFindingSchema>;
export type FeedbackCardData = z.infer<typeof FeedbackCardDataSchema>;
export type FindingStatus = z.infer<typeof FindingStatusSchema>;
