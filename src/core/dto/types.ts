/** Shared type definitions for the autobottom backend API. */

export type { OrgId } from "@core/domain/data/deno-kv/mod.ts";
export type { Role, AuthContext, OrgRecord, UserRecord } from "@core/domain/business/auth/mod.ts";

// ── Audit types ──────────────────────────────────────────────────────────────

export interface IQuestion {
  header: string;
  unpopulated?: string;
  populated: string;
  autoYes?: string;
  autoYesExp?: string;
  egregious?: boolean;
  weight?: number;
  temperature?: number;
  numDocs?: number;
  astResults?: Record<string, unknown>;
  autoYesVal?: boolean;
  autoYesMsg?: string;
  resolvedAst?: IQuestionAstNode[];
}

export interface IAnsweredQuestion extends IQuestion {
  answer: string;
  thinking: string;
  defense: string;
  snippet?: string;
  bonusFlipped?: boolean;
  reviewedBy?: string;
  reviewAction?: "flip" | "confirm" | "admin-flip";
  judgedBy?: string;
  judgeAction?: "overturn" | "uphold";
  judgeReason?: "error" | "logic" | "fragment" | "transcript";
}

export interface AuditDoneIndexEntry {
  findingId: string;
  completedAt: number;
  doneAt?: number;
  completed: boolean;
  reason?: "perfect_score" | "invalid_genie" | "reviewed";
  score: number;
  recordId?: string;
  isPackage?: boolean;
  voName?: string;
  owner?: string;
  department?: string;
  shift?: string;
  startedAt?: number;
  durationMs?: number;
  reviewedBy?: string;
}

// ── Chargeback / Wire types ──────────────────────────────────────────────────

export interface ChargebackEntry {
  findingId: string;
  ts: number;
  voName: string;
  destination: string;
  revenue: string;
  recordId: string;
  score: number;
  failedQHeaders: string[];
  egregiousHeaders?: string[];
  omissionHeaders?: string[];
}

export interface WireDeductionEntry {
  findingId: string;
  ts: number;
  score: number;
  questionsAudited: number;
  totalSuccess: number;
  recordId: string;
  office: string;
  excellenceAuditor: string;
  guestName: string;
}

// ── Config types ─────────────────────────────────────────────────────────────

export interface PipelineConfig {
  maxRetries: number;
  retryDelaySeconds: number;
  parallelism: number;
}

export interface WebhookConfig {
  postUrl: string;
  postHeaders: Record<string, string>;
  testEmail?: string;
  emailTemplateId?: string;
  dismissalTemplateId?: string;
  bcc?: string;
}

export interface BadWordConfig {
  enabled: boolean;
  emails: string[];
  words: { word: string; exclusions?: { word: string; buffer: number; type: string }[] }[];
  allOffices: boolean;
  officePatterns: string[];
}

export interface OfficeBypassConfig {
  patterns: string[];
}

export interface BonusPointsConfig {
  internalBonusPoints: number;
  partnerBonusPoints: number;
}

// ── Review types ─────────────────────────────────────────────────────────────

export interface ReviewItem {
  findingId: string;
  questionIndex: number;
  reviewIndex: number;
  totalForFinding: number;
  header: string;
  populated: string;
  thinking: string;
  defense: string;
  answer: string;
  completedAt?: number;
  recordingIdField?: string;
  recordId?: string;
  recordMeta?: Record<string, string | undefined>;
}

export interface ReviewDecision {
  findingId: string;
  questionIndex: number;
  decision: "confirm" | "flip";
  reviewer: string;
  decidedAt: number;
}

// ── Judge types ──────────────────────────────────────────────────────────────

export interface JudgeDecision {
  findingId: string;
  questionIndex: number;
  decision: "overturn" | "uphold";
  judge: string;
  reason?: "error" | "logic" | "fragment" | "transcript";
  decidedAt: number;
}

export interface AppealRecord {
  findingId: string;
  appealedAt: number;
  status: "pending" | "complete";
  judgedBy?: string;
  auditor?: string;
  comment?: string;
  appealedQuestions?: string[];
}

// ── Gamification types ───────────────────────────────────────────────────────

export interface BadgeStats {
  totalAudits: number;
  perfectScoreCount: number;
  avgScore: number;
  auditsForAvg: number;
  dayStreak: number;
  lastActiveDate: string;
}

export interface BadgeDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  xpReward: number;
  rarity: "common" | "uncommon" | "rare" | "epic" | "legendary";
}

export interface GameState {
  xp: number;
  level: number;
  dayStreak: number;
  cosmetics: Record<string, string>;
}

// ── Email report types ───────────────────────────────────────────────────────

export interface EmailReportConfig {
  id: string;
  name: string;
  recipients: string[];
  cc?: string[];
  bcc?: string[];
  reportSections: ReportSection[];
  dateRange?: DateRangeConfig;
  onlyCompleted?: boolean;
  failedOnly?: boolean;
  weeklyType?: string;
  templateId?: string;
  schedule?: { cron: string };
}

export interface ReportSection {
  header: string;
  columns: string[];
  criteria: CriteriaRule[];
}

export interface CriteriaRule {
  field: string;
  operator: "equals" | "not_equals" | "contains" | "not_contains" | "starts_with" | "less_than" | "greater_than";
  value: string;
}

export type DateRangeConfig =
  | { mode: "rolling"; hours: number }
  | { mode: "fixed"; from: number; to: number }
  | { mode: "weekly"; startDay: number };

// ── Question expression types (used by question-expr + pipeline steps) ───────

export interface IQuestionSeed {
  header: string;
  unpopulated: string;
  populated: string;
  autoYesExp: string;
  temperature?: number;
  numDocs?: number;
  egregious?: boolean;
  weight?: number;
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

export function createQuestion(seed: IQuestionSeed & Partial<Record<string, unknown>>): IQuestion {
  return {
    header: seed.header,
    unpopulated: seed.unpopulated,
    populated: seed.populated,
    autoYesExp: seed.autoYesExp,
    astResults: {},
    autoYesVal: false,
    autoYesMsg: "default",
  };
}

export function answerQuestion(q: Record<string, unknown>, answer: { answer: string; thinking: string; defense: string }): Record<string, unknown> {
  return { ...q, ...answer };
}

// ── Audit finding/job types (used by pipeline steps) ─────────────────────────

export interface AuditFinding { id: string; [key: string]: unknown; }
export interface AuditJob { id: string; doneAuditIds: Array<{ auditId: string; auditRecord: string }>; status: string; [key: string]: unknown; }
