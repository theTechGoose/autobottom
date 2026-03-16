// Ported from OmniSource type definitions
import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";

// -- Question Types --

export interface IQuestionSeed {
  header: string;
  unpopulated: string;
  populated: string;
  autoYesExp: string;
}

export interface ILlmQuestionAnswer {
  answer: string;
  thinking: string;
  defense: string;
}

export interface IQuestionAstNode {
  question: string;
  flip: boolean;
}

export interface IAstResults {
  ast?: IQuestionAstNode[][];
  raw?: Array<Array<IAnsweredQuestion>>;
  notResults?: Array<Array<boolean>>;
  andResults?: Array<boolean>;
  orResult?: boolean;
}

export interface IQuestion extends IQuestionSeed {
  astResults: IAstResults;
  resolvedAst?: IQuestionAstNode[];
  autoYesVal: boolean;
  autoYesMsg: string;
}

export interface IAnsweredQuestion extends IQuestion {
  answer: string;
  thinking: string;
  defense: string;
  snippet?: string;
}

// -- Feedback --

export interface FeedbackCardData {
  heading: string;
  text: string;
  viewUrl: string;
  recordingUrl?: string;
  disputeUrl?: string;
}

// -- Audit Finding --

export type FindingStatus =
  | "pending"
  | "no recording"
  | "retrying"
  | "creating-job"
  | "pulling-record"
  | "getting-recording"
  | "transcribing"
  | "populating-questions"
  | "asking-questions"
  | "finished";

export interface AuditFinding {
  id: string;
  auditJobId: string;
  findingStatus?: FindingStatus;
  recordingPath?: string;
  recordingId?: string;
  rawTranscript?: string;
  fixedTranscript?: string;
  diarizedTranscript?: string;
  unpopulatedQuestions?: IQuestionSeed[];
  populatedQuestions?: IQuestion[];
  answeredQuestions?: IAnsweredQuestion[];
  feedback: FeedbackCardData;
  job: AuditJob;
  record: Record<string, any>;
  recordingIdField: string;
  // Extra fields from job that get assigned
  owner?: string;
  updateEndpoint?: string;
  s3RecordingKey?: string;
  s3RecordingKeys?: string[];
  qlabConfig?: string;
  genieIds?: string[];
  snipStart?: number;
  snipEnd?: number;
  appealSourceFindingId?: string;
  appealType?: "redo" | "different-recording" | "additional-recording" | "upload-recording";
  appealComment?: string;
  reAuditedAt?: number;
  startedAt?: number;
  assemblyAiUploadUrl?: string;
  genieAttempts?: number;
  genieRetryAt?: number;
}

export function createFinding(
  job: AuditJob,
  record: Record<string, any>,
  recordingIdField: string,
  customId?: string,
): AuditFinding {
  const id = customId ?? nanoid();
  const recordingId = record[recordingIdField]
    ? String(record[recordingIdField])
    : undefined;

  return {
    id,
    auditJobId: job.id,
    findingStatus: "pending",
    feedback: {} as FeedbackCardData,
    job,
    record,
    recordingIdField,
    recordingId,
    owner: job.owner,
    updateEndpoint: job.updateEndpoint,
  };
}

// -- Audit Job --

export type JobStatus = "pending" | "running" | "paused" | "failed" | "retrying" | "finished";

export interface AuditStub {
  auditId: string;
  auditRecord: string;
}

export interface AuditJob {
  id: string;
  doneAuditIds: AuditStub[];
  status: JobStatus;
  timestamp: string;
  owner: string;
  updateEndpoint: string;
  recordsToAudit: string[];
}

export function createJob(
  owner: string,
  updateEndpoint: string,
  recordsToAudit: string[],
  customId?: string,
): AuditJob {
  return {
    id: customId ?? nanoid(),
    doneAuditIds: [],
    status: "pending",
    timestamp: new Date().toISOString(),
    owner,
    updateEndpoint,
    recordsToAudit,
  };
}

export function pickRecords(job: AuditJob, count = 0): string[] {
  const n = count === 0 ? job.recordsToAudit.length : count;
  const eligible = job.recordsToAudit.filter(
    (r) => !job.doneAuditIds.some((a) => a.auditRecord === r),
  );
  return eligible.slice(0, n);
}

export function markAuditDone(job: AuditJob, recordId: string, auditId: string): AuditJob {
  if (job.doneAuditIds.some((a) => a.auditId === auditId)) {
    throw new Error("Audit already done");
  }
  job.doneAuditIds.push({ auditId, auditRecord: recordId });
  if (job.doneAuditIds.length === job.recordsToAudit.length) {
    job.status = "finished";
  }
  return job;
}

// -- Question DTO helpers --

export function createQuestion(seed: IQuestionSeed & Partial<IQuestion>): IQuestion {
  return {
    header: seed.header,
    unpopulated: seed.unpopulated,
    populated: seed.populated,
    autoYesExp: seed.autoYesExp,
    astResults: seed.astResults ?? {},
    autoYesVal: seed.autoYesVal ?? false,
    autoYesMsg: seed.autoYesMsg ?? "default, this should never happen",
  };
}

/** Normalize a raw LLM answer to "Yes" or "No". */
function normalizeAnswer(raw: unknown): string {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s.startsWith("yes") || s === "true" || s === "y" || s === "1") return "Yes";
  if (s.startsWith("no") || s === "false" || s === "n" || s === "0") return "No";
  // If it's something weird like [object Object], check if it's truthy-looking
  if (s.includes("yes")) return "Yes";
  if (s.includes("no")) return "No";
  return "No";
}

export function answerQuestion(
  q: IQuestion,
  answer: ILlmQuestionAnswer,
): IAnsweredQuestion {
  return {
    ...q,
    answer: normalizeAnswer(answer.answer),
    thinking: String(answer.thinking ?? ""),
    defense: String(answer.defense ?? ""),
  };
}
