import { z } from "zod";

const AuditStubSchema = z.object({
  auditId: z.string(),
  auditRecord: z.string(),
});

const JobStatusSchema = z.enum(["pending", "running", "paused", "failed", "retrying", "finished"]);

export const AuditJobSchema = z.object({
  id: z.string(),
  doneAuditIds: z.array(AuditStubSchema),
  status: JobStatusSchema,
  timestamp: z.string(),
  owner: z.string(),
  updateEndpoint: z.string(),
  recordsToAudit: z.array(z.string()),
});

export type AuditJob = z.infer<typeof AuditJobSchema>;
export type JobStatus = z.infer<typeof JobStatusSchema>;
export type AuditStub = z.infer<typeof AuditStubSchema>;
