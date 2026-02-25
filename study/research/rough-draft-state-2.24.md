# Auto-Bot Audit App -- Current Data Structure

Complete mapping of all entities, KV keys, relationships, and pipeline states
as they exist today.

Source: `/Users/raphaelcastro/Documents/programming/deno-playground/dooks/auto-bot/`

---

## 1. Core Audit Entities

### 1.1 AuditFinding (central entity)

**Source:** `types/mod.ts`

The primary entity. Represents a single audit execution against one recording.

```typescript
type FindingStatus =
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

interface AuditFinding {
  id: string; // nanoid
  auditJobId: string; // FK -> AuditJob.id
  findingStatus?: FindingStatus;

  // Recording
  recordingPath?: string; // S3 key
  recordingId?: string; // Genie recording ID
  s3RecordingKey?: string; // Primary S3 path
  s3RecordingKeys?: string[]; // Multi-genie S3 paths
  genieIds?: string[]; // Multiple genie recording IDs
  snipStart?: number; // Audio trim start (ms)
  snipEnd?: number; // Audio trim end (ms)

  // Transcript
  rawTranscript?: string; // Raw text from AssemblyAI
  fixedTranscript?: string; // Cleaned transcript
  diarizedTranscript?: string; // Speaker-labeled (Groq)

  // Questions (pipeline stages)
  unpopulatedQuestions?: IQuestionSeed[];
  populatedQuestions?: IQuestion[];
  answeredQuestions?: IAnsweredQuestion[];

  // Output
  feedback: FeedbackCardData;

  // Context (embedded from job + QuickBase)
  job: AuditJob; // Embedded parent job
  record: Record<string, any>; // Full QuickBase record
  recordingIdField: string; // Field name in record for recording ID
  owner?: string; // Agent email (from job)
  updateEndpoint?: string; // Callback webhook URL
  qlabConfig?: string; // Question Lab config name/ID

  // Appeal fields
  appealSourceFindingId?: string; // FK -> original AuditFinding.id
  appealType?:
    | "redo"
    | "different-recording"
    | "additional-recording"
    | "upload-recording";
  appealComment?: string;
  reAuditedAt?: number; // Timestamp
}
```

### 1.2 AuditJob

**Source:** `types/mod.ts`

A batch of audits submitted together.

```typescript
type JobStatus =
  | "pending"
  | "running"
  | "paused"
  | "failed"
  | "retrying"
  | "finished";

interface AuditStub {
  auditId: string; // FK -> AuditFinding.id
  auditRecord: string; // QuickBase record ID
}

interface AuditJob {
  id: string; // nanoid
  doneAuditIds: AuditStub[]; // Completed audits in this job
  status: JobStatus;
  timestamp: string; // ISO timestamp
  owner: string; // Agent email
  updateEndpoint: string; // Callback URL
  recordsToAudit: string[]; // QuickBase record IDs to process
}
```

### 1.3 Question Types (full hierarchy)

**Source:** `types/mod.ts`

Questions evolve through the pipeline: seed -> populated -> answered.

```typescript
// Stage 1: Template from Question Lab or QuickBase
interface IQuestionSeed {
  header: string; // Display label
  unpopulated: string; // Template text with placeholders
  populated: string; // Text with record values filled in
  autoYesExp: string; // Auto-yes boolean expression
}

// Stage 2: Populated with AST evaluation
interface IQuestion extends IQuestionSeed {
  astResults: IAstResults;
  resolvedAst?: IQuestionAstNode[];
  autoYesVal: boolean;
  autoYesMsg: string;
}

// Stage 3: Answered by LLM
interface IAnsweredQuestion extends IQuestion {
  answer: string; // "Yes" or "No"
  thinking: string; // LLM reasoning chain
  defense: string; // LLM defense of answer
  snippet?: string; // RAG-retrieved transcript context
}

// AST types for boolean logic evaluation
interface IQuestionAstNode {
  question: string; // Individual sub-question
  flip: boolean; // Negate the answer
}

interface IAstResults {
  ast?: IQuestionAstNode[][]; // OR-of-ANDs boolean logic tree
  raw?: Array<Array<IAnsweredQuestion>>;
  notResults?: Array<Array<boolean>>;
  andResults?: Array<boolean>;
  orResult?: boolean;
}

interface ILlmQuestionAnswer {
  answer: string;
  thinking: string;
  defense: string;
}
```

### 1.4 FeedbackCardData

**Source:** `types/mod.ts`

```typescript
interface FeedbackCardData {
  heading: string; // Title in the gradient bar
  text: string; // Feedback description
  viewUrl: string; // Link to external Deno KV report
  recordingUrl?: string; // Link to recording stream
  disputeUrl?: string; // Link to appeal page
}
```

---

## 2. Auth & Multi-Tenancy

**Source:** `auth/kv.ts`

```typescript
type Role = "admin" | "judge" | "manager" | "reviewer" | "user";

interface OrgRecord {
  name: string;
  slug: string;
  createdAt: number; // epoch ms
  createdBy: string; // email
}

interface UserRecord {
  passwordHash: string; // SHA-256 hex
  role: Role;
  supervisor?: string | null; // email (judge for reviewers, manager for agents)
  createdAt: number;
}

interface AuthContext {
  email: string;
  orgId: string; // UUID
  role: Role;
}

// Session (KV with 24h TTL)
{
  email: string;
  orgId: string;
  role: Role;
  createdAt: number;
}
```

---

## 3. Review Queue

**Source:** `review/kv.ts`

Reviewer queue for "No" answers that need human confirmation.

```typescript
interface ReviewItem {
  findingId: string; // FK -> AuditFinding.id
  questionIndex: number; // Index into answeredQuestions
  header: string;
  populated: string;
  thinking: string;
  defense: string;
  answer: string; // Always "No"
}

interface ReviewDecision extends ReviewItem {
  decision: "confirm" | "flip";
  reviewer: string; // Email
  decidedAt: number; // epoch ms
}

interface ReviewerLeaderboardEntry {
  reviewer: string;
  decisions: number;
  confirms: number;
  flips: number;
  flipRate: string; // e.g. "12.5%"
}

interface ReviewerDashboardData {
  queue: { pending: number; decided: number };
  personal: {
    totalDecisions: number;
    confirmCount: number;
    flipCount: number;
    avgDecisionSpeedMs: number;
  };
  byReviewer: ReviewerLeaderboardEntry[];
  recentDecisions: ReviewDecision[];
}
```

---

## 4. Judge Queue

**Source:** `judge/kv.ts`

Judge queue for appeal decisions.

```typescript
interface JudgeItem {
  findingId: string;
  questionIndex: number;
  header: string;
  populated: string;
  thinking: string;
  defense: string;
  answer: string;
  appealType?: string;
}

interface JudgeDecision extends JudgeItem {
  decision: "uphold" | "overturn";
  reason?: "error" | "logic" | "fragment" | "transcript";
  judge: string;
  decidedAt: number;
}

interface AppealRecord {
  findingId: string;
  appealedAt: number;
  status: "pending" | "complete";
  judgedBy?: string;
  auditor?: string;
  comment?: string;
}

interface AppealStats {
  totalAppeals: number;
  overturned: number;
  upheld: number;
}

interface AppealHistory {
  findingId: string;
  auditor: string;
  judgedBy: string;
  originalScore: number; // 0-100
  finalScore: number;
  overturns: number;
  timestamp: number;
}
```

---

## 5. Manager Queue

**Source:** `manager/kv.ts`

```typescript
interface ManagerQueueItem {
  findingId: string;
  owner: string; // Agent email
  recordId: string; // QuickBase record ID
  recordingId: string; // Genie ID
  totalQuestions: number;
  failedCount: number; // Confirmed failures
  completedAt: number;
  jobTimestamp: string;
  status: "pending" | "addressed";
}

interface ManagerRemediation {
  findingId: string;
  notes: string;
  addressedBy: string;
  addressedAt: number;
}
```

---

## 6. Agent Dashboard

**Source:** `agent/kv.ts`

```typescript
interface AgentDashboardData {
  email: string;
  totalAudits: number;
  avgScore: number;
  recentAudits: Array<{
    findingId: string;
    recordId: string;
    recordingId: string;
    totalQuestions: number;
    passedCount: number;
    failedCount: number;
    completedAt: string;
    jobTimestamp: string;
  }>;
  weeklyTrend: Array<{
    weekStart: string;
    audits: number;
    avgScore: number;
  }>;
}
```

---

## 7. Question Lab

**Source:** `question-lab/kv.ts`

Manages audit question templates with versioning and testing.

```typescript
interface QLVersion {
  text: string;
  timestamp: string; // ISO
}

interface QLConfig {
  id: string; // nanoid
  name: string;
  createdAt: string;
  questionIds: string[]; // FK[] -> QLQuestion.id
}

interface QLQuestion {
  id: string; // nanoid
  name: string;
  text: string; // Question template
  configId: string; // FK -> QLConfig.id
  autoYesExp: string;
  versions: QLVersion[]; // Version history (newest first)
  testIds: string[]; // FK[] -> QLTest.id
}

interface QLTest {
  id: string; // nanoid
  questionId: string; // FK -> QLQuestion.id
  snippet: string; // Test transcript snippet
  expected: "yes" | "no";
  lastResult: null | "pass" | "fail";
  lastAnswer: null | string;
  lastThinking: null | string;
  lastDefense: null | string;
  lastRunAt: null | string;
}
```

---

## 8. Gamification

**Source:** `shared/badges.ts`, `lib/kv.ts`

### 8.1 Badges

```typescript
type BadgeTier = "common" | "uncommon" | "rare" | "epic" | "legendary";
type BadgeRole = "reviewer" | "judge" | "manager" | "agent";
type BadgeCategory =
  | "milestone"
  | "speed"
  | "streak"
  | "combo"
  | "level"
  | "quality"
  | "special";

interface BadgeDef {
  id: string;
  role: BadgeRole;
  tier: BadgeTier;
  name: string;
  description: string;
  icon: string;
  category: BadgeCategory;
  xpReward: number;
  check: (stats: BadgeCheckState) => boolean;
}

interface EarnedBadge {
  badgeId: string;
  earnedAt: number;
  earnedValue?: number;
}

interface BadgeCheckState {
  totalDecisions: number;
  dayStreak: number;
  lastActiveDate: string; // YYYY-MM-DD
  bestCombo: number;
  level: number;
  avgSpeedMs: number; // Reviewer
  decisionsForAvg: number; // Reviewer
  totalOverturns: number; // Judge
  consecutiveUpholds: number; // Judge
  totalRemediations: number; // Manager
  fastRemediations24h: number; // Manager
  fastRemediations1h: number; // Manager
  queueCleared: boolean; // Manager
  allAgentsAbove80: boolean; // Manager
  totalAudits: number; // Agent
  perfectScoreCount: number; // Agent
  avgScore: number; // Agent
  auditsForAvg: number; // Agent
  weeklyImprovement: number; // Agent
  consecutiveWeeksAbove80: number; // Agent
}
```

### 8.2 XP / Tokens / Store

```typescript
interface GameState {
  totalXp: number;
  tokenBalance: number;
  level: number;
  dayStreak: number;
  lastActiveDate: string; // YYYY-MM-DD
  purchases: string[]; // StoreItem IDs
  equippedTitle: string | null;
  equippedTheme: string | null;
  animBindings: Record<string, string>; // prefab event -> animation ID
}

type StoreItemType =
  | "title"
  | "avatar_frame"
  | "name_color"
  | "animation"
  | "theme"
  | "flair"
  | "font"
  | "bubble_font"
  | "bubble_color";

type StoreRarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

interface StoreItem {
  id: string;
  name: string;
  description: string;
  price: number;
  type: StoreItemType;
  icon: string;
  rarity: StoreRarity;
  preview?: string;
}
```

### 8.3 Level Thresholds

```typescript
// Reviewer/Judge/Manager
LEVEL_THRESHOLDS = [0, 100, 300, 600, 1000, 1500, 2200, 3200, 4500, 6500];

// Agent (slower progression)
AGENT_LEVEL_THRESHOLDS = [0, 50, 150, 350, 700, 1200, 2000, 3000, 4500, 7000];
```

### 8.4 Sound System

```typescript
type SoundSlot =
  | "ping"
  | "double"
  | "triple"
  | "mega"
  | "ultra"
  | "rampage"
  | "godlike"
  | "levelup"
  | "shutdown";
type SoundPackId =
  | "synth"
  | "smite"
  | "opengameart"
  | "mixkit-punchy"
  | "mixkit-epic"
  | (string & {});

interface SoundPackMeta {
  id: string;
  name: string;
  slots: Partial<Record<SoundSlot, string>>;
  createdAt: number;
  createdBy: string;
}

interface GamificationSettings {
  threshold: number | null; // seconds per question
  comboTimeoutMs: number | null;
  enabled: boolean | null;
  sounds: Partial<Record<SoundSlot, SoundPackId>> | null;
}
// Cascade: hardcoded defaults -> org -> judge override -> personal override
```

---

## 9. Events & Messaging

### 9.1 SSE Events

```typescript
type EventType =
  | "audit-completed"
  | "review-decided"
  | "appeal-decided"
  | "remediation-submitted"
  | "message-received";

interface AppEvent {
  id: string;
  type: EventType;
  payload: Record<string, unknown>;
  createdAt: number;
}
```

### 9.2 Broadcasts

```typescript
interface BroadcastEvent {
  id: string;
  type: string; // prefab event type
  triggerEmail: string;
  displayName: string;
  message: string;
  animationId: string | null;
  ts: number;
}

// Prefab event types:
// "sale_completed", "perfect_score", "ten_audits_day", "level_up",
// "badge_earned", "streak_milestone", "queue_cleared", "weekly_accuracy_100"
```

### 9.3 In-App Messages

```typescript
interface Message {
  id: string;
  from: string; // email
  to: string; // email
  body: string;
  ts: number;
  read: boolean;
}
```

---

## 10. Configuration Entities

### 10.1 Pipeline Config

**Source:** `lib/kv.ts`

```typescript
interface PipelineConfig {
  maxRetries: number; // default: 5
  retryDelaySeconds: number; // default: 10
}
```

### 10.2 Webhooks

```typescript
type WebhookKind = "terminate" | "appeal" | "manager" | "judge";

interface WebhookConfig {
  postUrl: string;
  postHeaders: Record<string, string>;
}
```

### 10.3 Email Reports

```typescript
type ReportSection = "pipeline" | "review" | "appeals" | "manager" | "tokens";
type DetailLevel = "low" | "medium" | "high";
type ReportCadence = "daily" | "weekly" | "biweekly" | "monthly";

interface SectionConfig {
  enabled: boolean;
  detail: DetailLevel;
}

interface EmailReportConfig {
  id: string;
  name: string;
  recipients: string[];
  cadence: ReportCadence;
  cadenceDay?: number; // 0-6 for weekly, 1-30 for monthly
  sections: Record<ReportSection, SectionConfig>;
  createdAt: number;
  updatedAt: number;
}
```

---

## 11. RAG Module

**Source:** `/Users/raphaelcastro/Documents/programming/deno-playground/rag/mod.ts`

```typescript
type RagRetrieveParams = {
  query: string;
  index: Index; // Pinecone Index
  namespace?: string;
  filter?: Record<string, unknown>;
  topK?: number; // default 32
  keep?: number; // default 10
  includeValues?: boolean;
  mmrLambda?: number; // default 0.4
  rrfK?: number; // default 60
  sparseQuery?: (q: string) => { indices: number[]; values: number[] } | null;
  hybridAlpha?: number; // default 0.55
  rerank?: (
    query: string,
    candidates: { id: string; text: string; metadata: any }[],
  ) => Promise<{ i: number; score: number }[]>;
  log?: (ev: string, data?: any) => void;
};

type RagDoc = {
  id: string;
  score: number;
  text: string;
  metadata: Record<string, any>;
};
```

---

## 12. Deno KV Key Schema

All keys are org-scoped via `orgKey(orgId, ...)` producing `[orgId, ...]`
unless noted as global.

### Audit Data

| Key Pattern                                                 | Value                       | Notes             |
| ----------------------------------------------------------- | --------------------------- | ----------------- |
| `[orgId, "audit-finding", findingId, chunkIndex]`           | string (JSON chunk)         | Chunked for >64KB |
| `[orgId, "audit-finding", findingId, "_n"]`                 | number                      | Chunk count       |
| `[orgId, "audit-job", jobId]`                               | AuditJob                    |                   |
| `[orgId, "question-cache", auditId, hash]`                  | `{answer,thinking,defense}` | TTL: 10min        |
| `[orgId, "destination-questions", destId, chunkIdx]`        | string (JSON chunk)         | TTL: 10min        |
| `[orgId, "audit-batches-remaining", findingId]`             | number                      | Fan-in counter    |
| `[orgId, "audit-populated-questions", findingId, chunkIdx]` | string (JSON chunk)         | Backup            |
| `[orgId, "audit-answers", findingId, batchIdx, chunkIdx]`   | string (JSON chunk)         | Per-batch         |
| `[orgId, "audit-transcript", findingId, chunkIdx]`          | string (JSON chunk)         | `{raw, diarized}` |

### Pipeline Stats (24h TTL)

| Key Pattern                               | Value                            | Notes                |
| ----------------------------------------- | -------------------------------- | -------------------- |
| `[orgId, "stats-active", findingId]`      | `{step, ts}`                     | Currently processing |
| `[orgId, "stats-completed", timestampId]` | `{findingId, ts}`                | TTL: 24h             |
| `[orgId, "stats-error", timestampId]`     | `{findingId, step, error, ts}`   | TTL: 24h             |
| `[orgId, "stats-retry", timestampId]`     | `{findingId, step, attempt, ts}` | TTL: 24h             |

### Review Queue

| Key Pattern                                  | Value                    | Notes           |
| -------------------------------------------- | ------------------------ | --------------- |
| `[orgId, "review-pending", findingId, qIdx]` | ReviewItem               |                 |
| `[orgId, "review-decided", findingId, qIdx]` | ReviewDecision           |                 |
| `[orgId, "review-lock", findingId, qIdx]`    | `{claimedBy, claimedAt}` | TTL: 30min      |
| `[orgId, "review-audit-pending", findingId]` | number                   | Remaining count |

### Judge Queue

| Key Pattern                                 | Value                    | Notes           |
| ------------------------------------------- | ------------------------ | --------------- |
| `[orgId, "judge-pending", findingId, qIdx]` | JudgeItem                |                 |
| `[orgId, "judge-decided", findingId, qIdx]` | JudgeDecision            |                 |
| `[orgId, "judge-lock", findingId, qIdx]`    | `{claimedBy, claimedAt}` | TTL: 30min      |
| `[orgId, "judge-audit-pending", findingId]` | number                   | Remaining count |

### Appeals

| Key Pattern                            | Value         |
| -------------------------------------- | ------------- |
| `[orgId, "appeal", findingId]`         | AppealRecord  |
| `[orgId, "appeal-stats", auditor]`     | AppealStats   |
| `[orgId, "appeal-history", findingId]` | AppealHistory |

### Manager Queue

| Key Pattern                                 | Value              |
| ------------------------------------------- | ------------------ |
| `[orgId, "manager-queue", findingId]`       | ManagerQueueItem   |
| `[orgId, "manager-remediation", findingId]` | ManagerRemediation |

### Auth (mixed global + org-scoped)

| Key Pattern              | Value                             | Notes      |
| ------------------------ | --------------------------------- | ---------- |
| `["org", orgId]`         | OrgRecord                         | Global     |
| `["org-by-slug", slug]`  | OrgId                             | Global     |
| `["email-index", email]` | `{orgId}`                         | Global     |
| `["session", token]`     | `{email, orgId, role, createdAt}` | TTL: 24h   |
| `[orgId, "user", email]` | UserRecord                        | Org-scoped |

### Gamification

| Key Pattern                                  | Value                                    |
| -------------------------------------------- | ---------------------------------------- |
| `[orgId, "gamification"]`                    | GamificationSettings (org-level)         |
| `[orgId, "gamification", "judge", email]`    | GamificationSettings (judge override)    |
| `[orgId, "gamification", "reviewer", email]` | GamificationSettings (personal override) |
| `[orgId, "game-state", email]`               | GameState                                |
| `[orgId, "badge", email, badgeId]`           | EarnedBadge                              |
| `[orgId, "badge-stats", email]`              | BadgeCheckState                          |
| `[orgId, "store-item", itemId]`              | StoreItem                                |
| `[orgId, "sound-pack", packId]`              | SoundPackMeta                            |

### Events & Messages

| Key Pattern                                         | Value                     | Notes      |
| --------------------------------------------------- | ------------------------- | ---------- |
| `[orgId, "event", targetEmail, eventId]`            | AppEvent                  | TTL: 24h   |
| `[orgId, "broadcast", eventId]`                     | BroadcastEvent            | TTL: 24h   |
| `[orgId, "prefab-subs"]`                            | `Record<string, boolean>` |            |
| `[orgId, "message", ownerEmail, otherEmail, msgId]` | Message                   | Both views |
| `[orgId, "unread-count", email]`                    | number                    |            |

### Question Lab

| Key Pattern                               | Value                 |
| ----------------------------------------- | --------------------- |
| `[orgId, "qlab", "config-index"]`         | string[] (config IDs) |
| `[orgId, "qlab", "config", configId]`     | QLConfig              |
| `[orgId, "qlab", "question", questionId]` | QLQuestion            |
| `[orgId, "qlab", "test", testId]`         | QLTest                |

### Config

| Key Pattern                          | Value             |
| ------------------------------------ | ----------------- |
| `[orgId, "pipeline-config"]`         | PipelineConfig    |
| `[orgId, "webhook-settings", kind]`  | WebhookConfig     |
| `[orgId, "email-report-config", id]` | EmailReportConfig |

---

## 13. Pipeline State Machine

QStash-driven step chain. Each step is a separate HTTP endpoint.

### Status Transitions

```
pending
  |
  v
creating-job --> pulling-record --> getting-recording --> transcribing
                                         |                    |
                                    (no recording)      (transcript ok)
                                         |                    |
                                         v                    v
                                      finished         populating-questions
                                                             |
                                                             v
                                                       asking-questions
                                                             |
                                                             v
                                                          finished
```

### Pipeline Steps

| Step                | Endpoint                          | Status Set                                   | What It Does                                                                             |
| ------------------- | --------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| init                | `/audit/step/init`                | `getting-recording`                          | Download recording from Genie API to S3                                                  |
| transcribe          | `/audit/step/transcribe`          | `transcribing`                               | S3 -> AssemblyAI transcription                                                           |
| transcribe-complete | `/audit/step/transcribe-complete` | (stays transcribing)                         | Groq LLM diarization (speaker labeling)                                                  |
| prepare             | `/audit/step/prepare`             | `populating-questions` -> `asking-questions` | Fetch questions, populate with record values, embed in Pinecone, fan-out batches         |
| ask-batch           | `/audit/step/ask-batch`           | (stays asking-questions)                     | RAG vector query + Groq LLM per batch. Fan-in via atomic counter.                        |
| finalize            | `/audit/step/finalize`            | `finished`                                   | Collect answers, generate feedback, populate review/judge queue, post webhooks, award XP |
| cleanup             | `/audit/step/cleanup`             | --                                           | Delete Pinecone namespace (24h delay)                                                    |

### Post-Audit Workflow

```
finalize
  |
  +-- (perfect score) --> terminate webhook (done)
  |
  +-- (has "No" answers) --> Review Queue --> Reviewer decides
  |                                              |
  |                                    postCorrectedAudit
  |                                              |
  |                                              v
  |                                       Manager Queue --> Manager remediates
  |
  +-- (appeal filed) --> Judge Queue --> Judge decides
                                             |
                                   postJudgedAudit -> Manager Queue -> Manager remediates
both have happy paths where appeal is filed and it comes back as a 100% score at which point the manager does nothing. but it goes on his dash.
```

---

## 14. Entity Relationships

```
OrgRecord (1) ---- (*) UserRecord
    |
    +---- (*) AuditJob (1) ---- (*) AuditFinding
    |                                   |
    |                                   +---- (*) ReviewItem --> ReviewDecision
    |                                   |
    |                                   +---- (*) JudgeItem --> JudgeDecision
    |                                   |
    |                                   +---- (0..1) AppealRecord --> AppealHistory
    |                                   |
    |                                   +---- (0..1) ManagerQueueItem --> ManagerRemediation
    |                                   |
    |                                   +---- (*) IAnsweredQuestion
    |
    +---- (*) QLConfig (1) ---- (*) QLQuestion (1) ---- (*) QLTest
    |
    +---- (*) GameState (per user)
    +---- (*) BadgeCheckState (per user)
    +---- (*) EarnedBadge (per user per badge)
    +---- (*) StoreItem
    +---- (*) SoundPackMeta
    +---- (*) Message (per conversation pair)
    +---- (*) AppEvent (per user, TTL 24h)
    +---- (*) BroadcastEvent (org-wide, TTL 24h)
    +---- (1) PipelineConfig
    +---- (4) WebhookConfig (terminate, appeal, manager, judge)
    +---- (*) EmailReportConfig
    +---- (1) GamificationSettings (+ per-judge, per-reviewer overrides)
```

---

## 15. External Integrations

THESE NEED TO ALL BE POLYMORPHIC AND ADHERE TO THEIR OWN INTERFACE SO THAT
THEY CAN BE HOT SWAPPABLE

| Service          | Purpose                                | Key Env Vars                                              |
| ---------------- | -------------------------------------- | --------------------------------------------------------- |
| QStash (Upstash) | Pipeline message queue                 | `QSTASH_URL`, `QSTASH_TOKEN`                              |
| AWS S3           | Recording storage                      | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET` |
| AssemblyAI       | Speech-to-text                         | `ASSEMBLYAI_API_KEY`                                      |
| Groq             | LLM (answering, diarization, feedback) | `GROQ_API_KEY`                                            |
| OpenAI           | Embeddings (text-embedding-3-small)    | `OPEN_AI_KEY`                                             |
| Pinecone         | Vector DB for RAG retrieval            | `PINECONE_DB_KEY`, `PINECONE_INDEX`                       |
| QuickBase        | Source records and questions           | `QB_REALM`, `QB_USER_TOKEN`                               |
| Postmark         | Email sending                          | `POSTMARK_SERVER`                                         |
| Genie            | Recording download (dual-account)      | `GENIE_AUTH`, `GENIE_AUTH_TWO`, `GENIE_BASE_URL`          |
| External Deno KV | Secondary report storage               | `DENO_KV_URL`                                             |
