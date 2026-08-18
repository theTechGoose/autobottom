/** Shared type definitions for the autobottom backend API. */

export type { OrgId } from "@core/data/deno-kv/mod.ts";
export type { Role, AuthContext, OrgRecord, UserRecord } from "@core/business/auth/mod.ts";
import { shortQuestionLabel } from "@core/business/question-labels/mod.ts";

// ── Audit types ──────────────────────────────────────────────────────────────

export interface IQuestion {
  header: string;
  /** How this question is NAMED to a human (see @core/business/question-labels).
   *  Stamped at createQuestion time; `header` stays the identity every index,
   *  stat bucket and report filter keys off. Absent on pre-2026-08 findings —
   *  render with questionLabel(q), which recomputes it from the header. */
  displayHeader?: string;
  unpopulated?: string;
  populated: string;
  autoYes?: string;
  autoYesExp?: string;
  egregious?: boolean;
  weight?: number;
  temperature?: number;
  numDocs?: number;
  astResults?: IAstResults;
  autoYesVal?: boolean;
  autoYesMsg?: string;
  resolvedAst?: IQuestionAstNode[];
}

/** Root cause attribution for a failed audit finding. Auto-seeded from review /
 *  judge signals at finalize, manually overridable by an admin on /audit/report. */
export type FailureSource = "autobot" | "vo_app" | "team_member" | "unknown";

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
  /** Root-cause attribution for a failed (answer "No") question. */
  failureSource?: FailureSource;
  /** Email of the admin who manually set failureSource. When present, the
   *  auto-seed heuristic leaves failureSource untouched. */
  failureSourceBy?: string;
}

export interface AuditDoneIndexEntry {
  findingId: string;
  completedAt: number;
  /** Appeal state at the last index (re)write, so reports can filter by appeal
   *  status straight from the index — no appeal-doc hydration at send time.
   *  Kept fresh by writeAuditDoneIndex on completion / review / judge / flip. */
  appealStatus?: "none" | "pending" | "complete";
  doneAt?: number;
  completed: boolean;
  reason?: "perfect_score" | "invalid_genie" | "reviewed";
  score: number;
  recordId?: string;
  recordingId?: string;   // genie # — backfilled on hydrate from the finding doc
  isPackage?: boolean;
  voName?: string;
  /** QuickBase "Related Employee2" (fid 143) — the numeric employee record
   *  behind voName, and the only field that identifies a person unambiguously.
   *  voName collides (two different Mariah Browns) and so does the VO email
   *  (both Mariahs share one address). Written on every index (re)write since
   *  2026-08; rows completed before that are undefined until backfilled from
   *  QuickBase. Filtered in memory like every other dimension — no Firestore
   *  index change. */
  employeeId?: string;
  owner?: string;
  department?: string;
  shift?: string;
  startedAt?: number;
  durationMs?: number;       // BOT pipeline duration (not human review time)
  /** WGS/MCC sale flags (saleFlagsFromFinding). Written on every index
   *  (re)write since 2026-07; older rows lack them until lazily backfilled. */
  wgs?: boolean;
  mcc?: boolean;
  /** Audit-result email tracking, denormalized off the audit-email-mark doc so
   *  a table can show an "Email Opened" column without hydrating one mark per
   *  row (that per-request hydration pattern has 503'd prod before).
   *
   *  Three states on purpose: `emailSentAt` undefined = no email has gone out
   *  yet (a failing audit waits for a reviewer, so this is a third of rows at
   *  any moment); sent but no `emailOpenedAt` = delivered, not opened; both set
   *  = the tracking pixel fired. Collapsing the first two into one unchecked
   *  box would accuse people of ignoring mail that was never sent.
   *
   *  `emailOpenedAt` is the human-open time only — recordOpen's prefetch filter
   *  keeps machine pre-fetches (Apple Mail Privacy Protection, Gmail) out. */
  emailSentAt?: number;
  emailOpenedAt?: number;
  reviewedBy?: string;
  /** Human review handle time: Σ active time over the audit's reviewed questions,
   *  excluding idle-discarded ones (set at finalize). Forward-only. */
  reviewHandleMs?: number;
  /** Number of questions reviewed (failed questions that went through review). */
  reviewedQuestionCount?: number;
  /** Reviewed questions that survived the idle filter (counted in reviewHandleMs). */
  reviewedValidCount?: number;
  /** Transient, set at read time only (never persisted): the finding is in the
   *  dedup hidden set. Aggregate views filter these out; the explicit "Find by
   *  QB Record" lookup surfaces them flagged so an operator investigating one
   *  record sees every audit for it, including dedup-flagged duplicates. */
  hidden?: boolean;
}

// ── Failed-audit analytics types ─────────────────────────────────────────────

/** One row per failed (answer "No") question, denormalized for the Failed Audits
 *  dashboard. Lives in the `failed-finding-idx` collection, range-scanned by
 *  completedAt. The finding doc's answeredQuestions[] stays the source of truth;
 *  these rows are a queryable projection rebuilt idempotently per finding. */
export interface FailedFindingIndexEntry {
  findingId: string;
  questionKey: string;        // normalizeQuestionKey(header)
  header: string;             // verbatim header for display
  completedAt: number;        // = finding.completedAt (range field)
  voName?: string;
  /** QuickBase employee id (fid 143) — same person key as
   *  AuditDoneIndexEntry.employeeId. voName alone merges two people who share
   *  a name, which would blend their most-missed questions. Undefined on rows
   *  written before 2026-08. */
  employeeId?: string;
  owner?: string;
  department?: string;
  shift?: string;
  recordId?: string;
  recordingId?: string;
  isPackage?: boolean;
  score: number;
  defense?: string;           // truncated finding detail for the line-item view
  failureSource: FailureSource;
  appealed?: boolean;         // an appeal record covered this finding+question
  appealDenied?: boolean;     // a judge upheld this question's fail (appeal denied)
  configKey: string;          // configKeyForFinding — parity with question-fail-stat
  yyyymm: string;             // bucket month (UTC)
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
  /** Audit failed because the recording was missing/unplayable, not on content.
   *  These never enter the review queue, so they are settled the moment they
   *  finalize — the reports treat the flag as a stand-in for "reviewed".
   *  Absent on entries written before 2026-08-18; readers fall back to matching
   *  the failed-question header. */
  invalidGenie?: boolean;
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

/** Two independent bypass lists, because "office" and "department" are two
 *  DIFFERENT QuickBase fields that buildIndexMeta collapses into one
 *  `department` slot (stats-repository/mod.ts): packages carry OfficeName
 *  (fid 46, the partner office), date legs carry Activating Office (fid 140,
 *  the internal team). Matching one list against both fields meant a name
 *  collision silently bypassed the other side — "FTL OPC" exists in both
 *  fields, so bypassing the partner office also killed the internal team's
 *  review queue for ~7 weeks. `patterns` now applies to packages only. */
export interface OfficeBypassConfig {
  /** Office names — matched against packages (partner) only. */
  patterns: string[];
  /** Department names — matched against date legs (internal) only. */
  departmentPatterns?: string[];
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

export interface ReviewDecision extends ReviewItem {
  decision: "confirm" | "flip";
  reviewer: string;
  decidedAt: number;
  /** Active (non-idle) on-screen time the reviewer spent on this question, ms.
   *  Captured client-side by the ReviewTiming island. */
  handleMs?: number;
  /** Idle time accrued on this question (tab hidden, or >60s no activity), ms. */
  idleMs?: number;
  /** True when the question accrued >=60s idle — excluded from handle-time stats. */
  discarded?: boolean;
}

// ── Judge types ──────────────────────────────────────────────────────────────

export interface JudgeDecision {
  findingId: string;
  questionIndex: number;
  header?: string;
  populated?: string;
  thinking?: string;
  defense?: string;
  answer?: string;
  appealType?: string;
  recordingIdField?: string;
  recordingId?: string;
  decision: "overturn" | "uphold";
  judge: string;
  reason?: "error" | "logic" | "fragment" | "transcript";
  /** S3 keys for screenshots the judge attached when upholding. Embedded inline
   *  in the appeal-result email's "Failed Questions" block. */
  screenshotKeys?: string[];
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
  /** Filters applied across ALL sections before per-section criteria. */
  topLevelFilters?: CriteriaRule[];
  dateRange?: DateRangeConfig;
  onlyCompleted?: boolean;
  failedOnly?: boolean;
  weeklyType?: string;
  /** Set by Weekly Builder so dupe-detection + scope-aware recipient
   *  recomputation can find the staged item later. */
  weeklyDepartment?: string;
  /** Every department a (possibly multi-department) report covers. Drives the
   *  Builder's "published" marking across all member departments. For a
   *  single-department report this is just `[weeklyDepartment]`. */
  weeklyDepartments?: string[];
  weeklyShift?: string;
  weeklyOffice?: string;
  /** Weekly digest grouping. Default (unset/true) gives a card group per shift
   *  whenever a department runs more than one; false keeps one group per
   *  department, shifts merged. */
  weeklySplitByShift?: boolean;
  /** VO-manager emails (QB "VO - Supervisor Email") that belong to this report.
   *  Audits whose ActivatingOffice no weekly report claims are routed here when
   *  their manager is on this list — so a new//unmapped office code follows its
   *  people instead of going unreported. Claimed offices are untouched. */
  weeklyManagers?: string[];
  templateId?: string;
  /** Cron expression + IANA timezone. The matcher (cron-presets/mod.ts) projects
   *  Date.now() into `tz` via Intl and matches wall-clock fields — so a "Daily
   *  8am" schedule fires at 8am local time year-round, no DST drift. */
  schedule?: { cron: string; tz: string };
  /** Toggle exposed by the modal — when false the cron job skips this config. */
  enabled?: boolean;
}

/** Per-config run state written by the email-reports cron tick. Lives in a
 *  SEPARATE Firestore doc (`email-report-status` keyed by configId) so the
 *  editor's saves can't clobber it and the cron's writes can't overwrite
 *  operator edits. */
export interface EmailReportStatus {
  configId: string;
  lastRunAt: number;
  lastRunStatus: "ok" | string;     // string = error message
  lastRunDurationMs: number;
  lastSentMessageId?: string;       // Postmark id; double-send prevention
  lastTickKey?: string;             // yyyymmddhhmm of the last successful tick
}

export interface ReportSection {
  header: string;
  columns: string[];
  criteria: CriteriaRule[];
  /** Where the section's rows come from. Default (unset) is the audit-done
   *  index inside the config's dateRange — every existing report.
   *
   *  "open-appeals" instead reads the live judge queue, ignoring dateRange, so
   *  the section lists appeals still awaiting a judge at ANY age. topLevelFilters
   *  and the section's own criteria still apply, so it can be scoped to one
   *  department/shift like any other section. */
  source?: "open-appeals";
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

export function createQuestion(seed: any): IQuestion {
  return {
    header: seed.header,
    // Stamped once, here, so every downstream surface (report, email, review,
    // manager) names the question the same way without re-deriving it.
    displayHeader: shortQuestionLabel(String(seed.header ?? "")),
    unpopulated: seed.unpopulated,
    populated: seed.populated,
    autoYesExp: seed.autoYesExp,
    astResults: {},
    autoYesVal: false,
    autoYesMsg: "default",
  };
}

export function answerQuestion(q: any, answer: { answer: string; thinking: string; defense: string }): IAnsweredQuestion {
  return { ...q, ...answer } as IAnsweredQuestion;
}

// ── Audit finding/job types (used by pipeline steps) ─────────────────────────

export interface AuditFinding { id: string; [key: string]: unknown; }
export interface AuditJob { id: string; doneAuditIds: Array<{ auditId: string; auditRecord: string }>; status: string; [key: string]: unknown; }

export type ReportColumnKey = "recordId" | "findingId" | "guestName" | "voName" | "department" | "score" | "appealStatus" | "finalizedAt" | "markedForReview" | "mostRecentActiveMccId";


// Zod validation schemas — shape-checker compliance
import { z } from "#zod";
export const ChargebackEntrySchema = z.object({ findingId: z.string(), ts: z.number(), voName: z.string(), score: z.number() });
export const WireDeductionEntrySchema = z.object({ findingId: z.string(), ts: z.number(), score: z.number() });
export const FailedFindingIndexEntrySchema = z.object({ findingId: z.string(), questionKey: z.string(), header: z.string(), completedAt: z.number(), score: z.number(), failureSource: z.string() });
