# Auto-Bot Data Model

Unified data model for the Auto-Bot audit application. Integrates the
config/instance separation proposal and the reports feature.

---

## 0. Model Overview

```
                      Root Team
                          |
          +-------+-------+-------+--------+--------+--------+
          |       |       |       |        |        |        |
        Teams   Users   Audit   Review  Reports  Gamify  Config
          |       |
     (nestable)  RoleDef
                  |
        +---------+---------+
        |         |         |
     level    capabilities  permissions
   (visibility) (sidebar    (team IDs =
    0=highest    tabs)       data scope)
                  |
            DashboardPage (per role, shareable)
                  |
              WidgetSlots

                  Audit
     +------------+------------+
     |                         |
  Template                 Execution
  (what should happen)     (what did happen)
     |                         |
  AuditConfig              AuditInstance
     |                         |
  AuditQuestion ---+--->  AuditAnswer
     |             |
  QuestionTest     |
                   |
            (post-audit)
            /     |     \
     ReviewItem  JudgeItem  ManagerQueueItem
         |          |            |
  ReviewDecision JudgeDecision ManagerRemediation
```

### Entity Index

| Domain | Entity | Relates To |
| ------ | ------ | ---------- |
| **Team** | Team | nestable container; root team (parentId: null) = the org |
| **Team** | RoleDef | defines a role name + capabilities |
| **Auth** | UserRecord | belongs to Team, cached role from RoleDef |
| **Auth** | Session | references User + root team |
| **Dashboard** | DashboardPage | per user per role, shareable, customizable home tab |
| **Audit Template** | AuditConfig | owns AuditQuestions |
| **Audit Template** | AuditQuestion | belongs to AuditConfig, has QuestionTests |
| **Audit Template** | QuestionTest | belongs to AuditQuestion |
| **Audit Execution** | AuditInstance | references AuditConfig, owns AuditAnswers |
| **Audit Execution** | AuditAnswer | belongs to AuditInstance, references AuditQuestion |
| **Review** | ReviewItem / ReviewDecision | references AuditInstance + question index |
| **Appeals** | JudgeItem / JudgeDecision | references AuditInstance + question index |
| **Appeals** | AppealRecord / AppealHistory / AppealStats | references AuditInstance or auditor |
| **Manager** | ManagerQueueItem / ManagerRemediation | references AuditInstance |
| **Reports** | Report | belongs to ReportFolder, owned by User |
| **Reports** | ReportFolder | belongs to root team |
| **Gamification** | GameState | per User |
| **Gamification** | BadgeDef / EarnedBadge / BadgeCheckState | per User |
| **Gamification** | StoreItem / SoundPackMeta | per root team |
| **Gamification** | GamificationSettings | root team -> Judge override -> Personal override |
| **Events** | AppEvent | per User (TTL 24h) |
| **Events** | BroadcastEvent | per root team (TTL 24h) |
| **Events** | Message | between two Users |
| **Config** | PipelineConfig / WebhookConfig / EmailReportConfig | per root team |

### Data Flow (audit lifecycle)

```
AuditConfig + field data
        |
        v
   AuditInstance (pending)
        |
        v
   [pipeline: get recording -> transcribe -> populate -> ask]
        |
        v
   AuditInstance (finished) + AuditAnswers
        |
        +-- all "Yes" --> terminate webhook (done)
        |
        +-- has "No"  --> ReviewItem --> ReviewDecision
        |                                     |
        |                              ManagerQueueItem --> ManagerRemediation
        |
        +-- appeal    --> JudgeItem --> JudgeDecision
                                             |
                                      ManagerQueueItem --> ManagerRemediation
```

---

## 1. Audit Core

The central domain. Separates **what should happen** (config + question) from
**what did happen** (instance + answer).

### 1.1 AuditConfig

A reusable audit blueprint. Defines which questions to ask, which data fields
are expected, and configuration-level settings.

```typescript
type FieldType = "text" | "number" | "date" | "boolean" | "enum";

interface ConfigField {
  key: string;                     // Field identifier (used in placeholders)
  label: string;                   // Display name
  type: FieldType;
  required: boolean;               // Must be provided when creating an instance
  default?: unknown;               // Default value when not required and omitted
  options?: string[];              // Valid values (for enum type)
}

interface SkipRule {
  questionId: string;              // FK -> AuditQuestion.id
  expression: string;              // Boolean expression — when true, skip the question
}

interface AuditConfig {
  id: string;
  name: string;
  rootTeamId: string;              // FK -> root Team.id
  fields: ConfigField[];           // Expected data fields for this audit type
  questionIds: string[];           // FK[] -> AuditQuestion.id (ordered)
  skip: SkipRule[];                // Questions to skip when their expression is true
  version: number;                 // Incremented on change
  createdAt: string;               // ISO 8601
  updatedAt: string;
}
```

### 1.2 AuditQuestion

A question template belonging to a config. Contains the text and version
history for auditability. Skip logic lives on the AuditConfig, not here.

```typescript
interface AuditQuestion {
  id: string;
  configId: string;                // FK -> AuditConfig.id
  header: string;                  // Display label
  template: string;                // Question text with placeholders
  versions: QuestionVersion[];     // Version history (newest first)
  testIds: string[];               // FK[] -> QuestionTest.id
}

interface QuestionVersion {
  text: string;
  timestamp: string;               // ISO 8601
}
```

### 1.3 AuditInstance

A single audit execution against one recording. References the config that
was used and owns the pipeline lifecycle.

```typescript
type InstanceStatus =
  | "pending"
  | "no-recording"
  | "retrying"
  | "getting-recording"
  | "transcribing"
  | "populating-questions"
  | "asking-questions"
  | "finished";

interface AuditInstance {
  id: string;
  configId: string;                // FK -> AuditConfig.id (snapshot used)
  configVersion: number;           // Config version at time of execution
  rootTeamId: string;              // FK -> root Team.id
  status: InstanceStatus;
  owner: string;                   // Agent email

  // Recording
  recording: RecordingData;

  // Transcript
  transcript: TranscriptData;

  // Fields (validated against AuditConfig.fields)
  fields: Record<string, unknown>; // Key-value pairs matching config field definitions

  // Output
  feedback: FeedbackCard;

  // Pipeline
  updateEndpoint?: string;         // Callback webhook URL

  // Appeal
  appeal?: AppealRef;
}

interface RecordingData {
  path?: string;                   // Primary S3 key
  id?: string;                     // Genie recording ID
  s3Keys?: string[];               // All S3 paths (multi-genie)
  genieIds?: string[];             // All Genie recording IDs
  snipStart?: number;              // Audio trim start (ms)
  snipEnd?: number;                // Audio trim end (ms)
}

interface TranscriptData {
  raw?: string;                    // Raw text from AssemblyAI
  fixed?: string;                  // Cleaned transcript
  diarized?: string;               // Speaker-labeled (Groq)
}

interface FeedbackCard {
  heading: string;
  text: string;
  viewUrl: string;                 // Link to report page
  recordingUrl?: string;           // Link to recording stream
  disputeUrl?: string;             // Link to appeal page
}

interface AppealRef {
  sourceFindingId?: string;        // FK -> original AuditInstance.id
  type?: "redo" | "different-recording" | "additional-recording" | "upload-recording";
  comment?: string;
  reAuditedAt?: number;            // Epoch ms
}
```

### 1.4 AuditAnswer

The result of evaluating one question in one instance. Links an AuditQuestion
to an AuditInstance with the actual response.

```typescript
interface AuditAnswer {
  instanceId: string;              // FK -> AuditInstance.id
  questionId: string;              // FK -> AuditQuestion.id
  questionIndex: number;           // Position in the question list

  // Populated question (template resolved with record values)
  populated: string;

  // Skip evaluation (from AuditConfig.skip)
  skipped: boolean;                // true if skip rule matched
  skipMsg: string;                 // Reason / expression result

  // AST boolean logic evaluation
  ast: AstResults;

  // LLM response
  answer: string;                  // "Yes" or "No"
  thinking: string;                // LLM reasoning chain
  defense: string;                 // LLM defense of answer
  snippet?: string;                // RAG-retrieved transcript context
}

interface AstResults {
  tree?: AstNode[][];              // OR-of-ANDs boolean logic
  raw?: AuditAnswer[][];           // Sub-question answers
  notResults?: boolean[][];
  andResults?: boolean[];
  orResult?: boolean;
}

interface AstNode {
  question: string;                // Individual sub-question
  flip: boolean;                   // Negate the answer
}
```

### 1.5 QuestionTest

Test cases for validating question behavior against sample transcripts.

```typescript
interface QuestionTest {
  id: string;
  questionId: string;              // FK -> AuditQuestion.id
  snippet: string;                 // Test transcript snippet
  expected: "yes" | "no";
  lastResult: "pass" | "fail" | null;
  lastAnswer: string | null;
  lastThinking: string | null;
  lastDefense: string | null;
  lastRunAt: string | null;        // ISO 8601
}
```

---

## 2. Review & Appeals

Post-audit workflow for human oversight. Three queues handle different stages
of review.

### 2.1 Review Queue

"No" answers go to reviewers for confirmation or flip.

```typescript
interface ReviewItem {
  findingId: string;               // FK -> AuditInstance.id
  questionIndex: number;
  header: string;
  populated: string;
  thinking: string;
  defense: string;
  answer: string;                  // Always "No"
}

interface ReviewDecision extends ReviewItem {
  decision: "confirm" | "flip";
  reviewer: string;                // Email
  decidedAt: number;               // Epoch ms
}
```

### 2.2 Judge Queue

Appeals go to judges for uphold/overturn decisions.

```typescript
interface JudgeItem {
  findingId: string;               // FK -> AuditInstance.id
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
  judge: string;                   // Email
  decidedAt: number;               // Epoch ms
}
```

### 2.3 Appeal Records

```typescript
interface AppealRecord {
  findingId: string;               // FK -> AuditInstance.id
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
  originalScore: number;           // 0-100
  finalScore: number;
  overturns: number;
  timestamp: number;
}
```

### 2.4 Manager Queue

Confirmed failures go to managers for remediation.

```typescript
interface ManagerQueueItem {
  findingId: string;               // FK -> AuditInstance.id
  owner: string;                   // Agent email
  recordingId: string;             // Genie ID
  totalQuestions: number;
  failedCount: number;
  completedAt: number;
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

## 3. Teams, Roles & Auth

### 3.1 Team

A team is a container for users. The root team (parentId: null) is the
organization.

```typescript
interface Team {
  id: string;
  parentId: string | null;        // null = root team (the org)
  name: string;
  slug: string;                   // URL-safe identifier
  leaderId: string;               // Email of the team leader
  memberEmails: string[];         // All team members (including leader)
  createdAt: number;              // Epoch ms
  createdBy: string;              // Email
}
```

**Team hierarchy example:**

```
Acme Corp (root)
├── QA Adjudication
│   ├── Judge A (leader)
│   └── Analyst A, Analyst B
└── Floor Operations
    ├── Supervisor X (leader)
    └── Agent 1, Agent 2, Agent 3
```

### 3.2 RoleDef

Roles are data, not code enums. A role defines three things:
- **level** -- visibility tier (0 = highest, higher = lower). You see your own
  data plus data owned by anyone with a higher level number than yours within
  your permitted teams.
- **capabilities** -- which sidebar tabs / routes the user can access
- **permissions** -- which team IDs the user can access data from (data scope)

```typescript
interface RoleDef {
  id: string;
  rootTeamId: string;             // FK -> root Team.id
  name: string;                   // e.g. "judge", "analyst", "supervisor", "agent"
  level: number;                  // 0 = highest access, higher = less access
  capabilities: string[];         // Routes / sidebar tabs
  permissions: string[];          // Team IDs this role can access data from
}
```

**Default roles:**

| Role | Level | Capabilities | Permissions |
|------|-------|-------------|-------------|
| `admin` | 0 | `admin-panel`, `team-management`, `config`, `reports`, `review-queue`, `appeals`, `manager-queue` | all teams |
| `judge` | 1 | `review-queue`, `appeals`, `reports` | adjudication team(s) |
| `supervisor` | 2 | `manager-queue`, `reports`, `team-stats` | operations team(s) |
| `analyst` | 2 | `review-queue`, `reports` | adjudication team(s) |
| `agent` | 3 | `my-audits`, `my-stats` | own team only |

**Capabilities** determine sidebar tabs. Every role also gets a **Dashboard**
tab automatically. See `dashboard-builder-spec.md` for the full sidebar and
dashboard UX.

**Permissions** are team IDs that define the data scope. A user can only query
data that belongs to those teams.

### 3.3 Visibility Rule

Within a permitted team, what data can you actually see?

```
if viewer.email === target.email        -> visible  (always see self)
if viewer.roleLevel < target.roleLevel  -> visible  (lower number = more access)
else                                    -> hidden   (peers cannot see each other)
```

| Viewer (level) | Sees |
|---------------|------|
| admin (0) | everyone |
| judge (1) | self + analysts (2) + agents (3) |
| supervisor (2) | self + agents (3) |
| analyst (2) | self + agents (3) |
| agent (3) | self only |

Level 0 is the ceiling. New roles are added with higher numbers without
touching existing ones.

### 3.4 UserRecord

```typescript
interface UserRecord {
  passwordHash: string;            // SHA-256 hex
  teamId: string;                  // FK -> Team.id (which team they belong to)
  roleId: string;                  // FK -> RoleDef.id
  // Cached from RoleDef for fast auth:
  role: string;                    // Role name
  level: number;                   // Visibility level
  capabilities: string[];          // Sidebar tabs
  permissions: string[];           // Team IDs for data scope
  createdAt: number;
}
```

Cached fields are derived from RoleDef. When a RoleDef changes, affected
users must be refreshed.

### 3.5 Session

```typescript
interface Session {
  email: string;
  rootTeamId: string;              // Root team ID (org scope)
  teamId: string;                  // User's direct team
  role: string;                    // Cached role name
  level: number;                   // Cached visibility level
  capabilities: string[];          // Cached capabilities
  permissions: string[];           // Cached team ID permissions
  createdAt: number;
}
// TTL: 24 hours
```

### 3.6 Dashboard Sharing

Dashboards can be named and shared to other users. A shared dashboard works
as long as the recipient has the **permissions** (team scope) to access the
data the widgets reference. If a widget references a report the recipient
can't see, it renders as a placeholder with "No access" instead of failing.

---

## 4. Reports

Custom saved views of audit data.

### 4.1 Report

```typescript
type ReportType = "table" | "chart" | "calendar" | "summary" | "timeline";

interface Report {
  id: string;
  name: string;
  type: ReportType;
  description: string | null;

  // Ownership
  ownerId: string;                 // User email
  rootTeamId: string;              // FK -> root Team.id
  folderId: string;                // FK -> ReportFolder.id

  // Query
  query: ReportQuery;

  // Type-specific config
  properties: TableProperties | ChartProperties | CalendarProperties
    | SummaryProperties | TimelineProperties;

  // Display
  options: ReportOptions;

  // Usage
  usedLast: string;                // ISO 8601
  usedCount: number;

  // Timestamps
  createdAt: string;               // ISO 8601
  updatedAt: string;
}
```

### 4.2 ReportQuery

The query executed when the report runs.

```typescript
interface ReportQuery {
  filter: FilterGroup | null;
  fields: string[];                // Ordered field keys to display
  sortBy: SortCriterion[];
  groupBy: GroupCriterion[];
  formulaFields: FormulaField[];
}

interface FilterGroup {
  conjunction: "AND" | "OR";
  conditions: FilterCondition[];
}

interface FilterCondition {
  fieldKey: string;                // Audit finding field key
  operator: FilterOperator;
  value: unknown;
}

type FilterOperator =
  // Text
  | "is" | "is_not"
  | "is_empty" | "is_not_empty"
  | "contains" | "does_not_contain"
  | "starts_with" | "does_not_start_with"
  // Numeric
  | "lt" | "gt" | "lte" | "gte"
  // Date
  | "before" | "after"
  | "on_or_before" | "on_or_after"
  | "during"
  // Enum
  | "any_of" | "none_of"
  // Boolean
  | "is_true" | "is_false";

interface SortCriterion {
  fieldKey: string;
  order: "ASC" | "DESC";
}

interface GroupCriterion {
  fieldKey: string;
  grouping: Grouping;
}

type Grouping =
  // General
  | "equal-values" | "first-letter" | "first-word"
  // Date
  | "day" | "week" | "month" | "quarter" | "year"
  // Numeric
  | "1" | "5" | "10" | "100" | "1000";

interface FormulaField {
  id: number;                      // Negative ID (e.g. -100)
  label: string;
  fieldType: FieldType;
  formula: string;
  decimalPrecision?: number;
}

type FieldType =
  | "text" | "rich-text" | "numeric" | "currency" | "percent"
  | "date" | "timestamp" | "duration" | "checkbox"
  | "email" | "url" | "phone" | "user";
```

### 4.3 ReportOptions

Display settings for the report view.

```typescript
interface ReportOptions {
  // Display
  rowHeight: "relaxed" | "normal" | "condensed";
  columnHeaderText: "truncate" | "wrap";
  groupDisplay: "collapsed" | "expanded";
  showDescription: boolean;

  // Behavior
  hideTotals: boolean;
  showViewIcon: boolean;
  disableBulkDelete: boolean;
  editingBehavior: "inline" | "no_inline";

  // Dynamic filters
  dynamicFilterMode: "custom" | "none";
  quickSearchEnabled: boolean;

  // Color coding
  colorMethod: "none" | "field_choices" | "formula";
  colorField: string | null;
  colorFormula: string | null;
  colorAppearance: "pale" | "full";
}
```

### 4.4 Type-Specific Properties

```typescript
interface TableProperties {
  displayOnlyNewOrChanged: boolean;
  columnProperties: ColumnProperty[];
}

interface ChartProperties {
  chartType: ChartType;
  dataSources: ChartDataSource[];
  categories: ChartCategory;
  series: object | null;
  dataLabel: string | null;
  sortBy: SortCriterion[];
  goal: { label: string; value: number } | null;
}

type ChartType =
  | "bar" | "stacked-bar" | "horizontal-bar" | "horizontal-stacked-bar"
  | "line" | "line-bar" | "area" | "pie" | "funnel"
  | "scatter" | "bubble" | "waterfall" | "solid-gauge";

interface ChartDataSource {
  type: "field-value" | "number-of-records";
  fieldKey: string | null;
  aggregation: Aggregation | null;
}

interface ChartCategory {
  fieldKey: string;
  grouping: Grouping;
  label: string | null;
}

type Aggregation = "AVG" | "SUM" | "MAX" | "MIN" | "STD-DEV" | "COUNT" | "DISTINCT-COUNT";

interface CalendarProperties {
  startDateField: string;          // Field key
  endDateField: string;
}

interface TimelineProperties {
  startDate: string | null;        // ISO YYYY-MM-DD boundary
  endDate: string | null;
  startingField: string;           // Field key for item start
  endingField: string;             // Field key for item end
  milestoneField: string | null;
  sortByStartingField: boolean;
  columnProperties: ColumnProperty[];
}

interface SummaryProperties {
  summarize: SummarizeItem[];
  summaryVariables: SummaryVariable[];
  summaryFormulas: SummaryFormula[];
  sortBy: SummarySortCriterion[];
  crosstabs: GroupCriterion | null;
}

interface SummarizeItem {
  type: "field-value" | "number-of-records" | "summary-formula";
  fieldKey: string | null;
  aggregation: Aggregation | null;
  showAs: 0 | 1 | 2 | 3 | 4;     // 0=value, 1=% col, 2=% crosstab, 3=running col, 4=running crosstab
}

interface SummaryVariable {
  fieldKey: string;
  label: string;
  aggregation: Aggregation;
}

interface SummaryFormula {
  id: number;                      // Negative ID
  label: string;
  fieldType: FieldType;
  formula: string;
}

interface SummarySortCriterion {
  order: "ASC" | "DESC";
  by: "summarization" | "groups";
  summarizationElementIndex: number | null;
}

interface ColumnProperty {
  fieldKey: string;
  labelOverride: string;
}
```

### 4.5 ReportFolder

```typescript
interface ReportFolder {
  id: string;
  name: string;
  rootTeamId: string;              // FK -> root Team.id
  createdBy: string;
  createdAt: string;               // ISO 8601
  isDefault: boolean;              // true for "General"
}
```

### 4.6 Available Report Fields

Fields derived from AuditInstance + its config-defined fields.

| Field Key              | Display Name             | Type   |
| ---------------------- | ------------------------ | ------ |
| `findingStatus`        | Finding Status           | enum   |
| `office`               | Office                   | text   |
| `guestName`            | Guest Name               | text   |
| `spouseName`           | Spouse Name              | text   |
| `phoneNumber`          | Phone Number             | text   |
| `alternateNumber`      | Alternate Number         | text   |
| `address`              | Address                  | text   |
| `maritalStatus`        | Marital Status           | text   |
| `destination`          | Destination              | text   |
| `relatedDestination`   | Related Destination      | text   |
| `resortName`           | Resort Name              | text   |
| `roomTypes`            | Room Types               | text   |
| `arrivalDate`          | Arrival Date             | date   |
| `departureDate`        | Departure Date           | date   |
| `auditDate`            | Audit Date               | date   |
| `reAuditedAt`          | Re-Audited At            | date   |
| `recordingId`          | Recording ID             | text   |
| `employee`             | Employee / Activator     | text   |
| `questionsTotal`       | Questions Total          | number |
| `questionsAnswered`    | Questions Answered       | number |
| `feedbackHeading`      | Feedback Heading         | text   |
| `feedbackText`         | Feedback Text            | text   |
| `appealType`           | Appeal Type              | enum   |
| `appealComment`        | Appeal Comment           | text   |
| `totalMccAttached`     | Total MCC Attached       | number |
| `totalWgsAttached`     | Total WGS Attached       | number |
| `totalDepositAttached` | Total Deposit Attached   | number |

---

## 5. Dashboards & Navigation

The app uses a sidebar + tabs navigation model. Capabilities from the user's
role determine which tabs appear. Every role gets a **Dashboard** tab as the
first item -- this is the customizable widget page. Other tabs are fixed
functional views (queues, reports, config). See `dashboard-builder-spec.md`
for the full UX spec including sidebar design.

### 5.1 Sidebar

The sidebar is a thin glowing accent line (3-4px) on the left edge. On hover
it expands to show all nav tabs for the user's role. Tabs:

| Tab | Source | View |
|-----|--------|------|
| Dashboard | always present | Customizable widget page |
| Review Queue | `review-queue` capability | Pending reviews workflow |
| Appeals | `appeals` capability | Judge appeal queue |
| Manager Queue | `manager-queue` capability | Remediation workflow |
| Reports | `reports` capability | Report builder & saved reports |
| Team Stats | `team-stats` capability | Team performance metrics |
| My Audits | `my-audits` capability | Agent's own audit history |
| My Stats | `my-stats` capability | Agent's personal metrics |
| Admin | `admin-panel` capability | System administration |
| Teams | `team-management` capability | Team & user management |
| Config | `config` capability | Pipeline & webhook settings |

### 5.2 DashboardPage

The Dashboard tab's content. Customizable via drag-and-drop widget builder.
Dashboards can be named and shared to other users.

```typescript
interface DashboardPage {
  id: string;
  ownerId: string;                 // Email of the creator (null for system defaults)
  role: string;                    // Which role's dashboard tab
  name: string;                    // User-given name (e.g. "My QA Overview")
  widgets: WidgetSlot[];           // Ordered list of placed widgets
  sharedWith: string[];            // Emails this dashboard is shared to
  createdAt: string;               // ISO 8601
  updatedAt: string;
}
```

A shared dashboard renders for the recipient as long as they have the
**permissions** to access the underlying data. Widgets referencing
inaccessible data show a "No access" placeholder.

### 5.3 WidgetSlot

```typescript
type WidgetType =
  | "report"
  | "text"
  | "button-bar"
  | "link-bar"
  | "search"
  | "reports-list"
  | "embed";

interface WidgetSlot {
  id: string;                      // Unique within the page
  type: WidgetType;
  title: string;                   // User-editable header
  column: 1 | 2;                  // Grid column (1 = left, 2 = right)
  order: number;                   // Sort order within column
  span: 1 | 2;                    // 1 = half width, 2 = full width
  config: WidgetConfig;            // Type-specific configuration
}
```

Widget configs are a discriminated union. See `dashboard-builder-spec.md`
section 3 for all seven widget type configurations:
- **Report**: embeds a saved Report inline (chart or table)
- **Text**: static markdown block
- **Button Bar**: action buttons (navigate, create instance, external link)
- **Link Bar**: titled group of links
- **Search**: scoped search by entity fields
- **Reports List**: clickable list of saved reports filtered by folder/tag
- **Embed**: iframe for external content

### 5.4 Copy-on-Write

System defaults have `userId: null` and are keyed by role. On first edit, the
default is cloned into a user-owned copy. Users never modify system defaults
directly.

---

## 6. Gamification

### 6.1 Badges

```typescript
type BadgeTier = "common" | "uncommon" | "rare" | "epic" | "legendary";
type BadgeRole = "judge" | "analyst" | "supervisor" | "agent";
type BadgeCategory =
  | "milestone" | "speed" | "streak" | "combo"
  | "level" | "quality" | "special";

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
  // Universal
  totalDecisions: number;
  dayStreak: number;
  lastActiveDate: string;          // YYYY-MM-DD
  bestCombo: number;
  level: number;
  // Reviewer
  avgSpeedMs: number;
  decisionsForAvg: number;
  // Judge
  totalOverturns: number;
  consecutiveUpholds: number;
  // Manager
  totalRemediations: number;
  fastRemediations24h: number;
  fastRemediations1h: number;
  queueCleared: boolean;
  allAgentsAbove80: boolean;
  // Agent
  totalAudits: number;
  perfectScoreCount: number;
  avgScore: number;
  auditsForAvg: number;
  weeklyImprovement: number;
  consecutiveWeeksAbove80: number;
}
```

### 6.2 XP / Tokens / Store

```typescript
interface GameState {
  totalXp: number;
  tokenBalance: number;
  level: number;
  dayStreak: number;
  lastActiveDate: string;          // YYYY-MM-DD
  purchases: string[];             // StoreItem IDs
  equippedTitle: string | null;
  equippedTheme: string | null;
  animBindings: Record<string, string>;
}

// Level thresholds
// Reviewer/Judge/Manager: [0, 100, 300, 600, 1000, 1500, 2200, 3200, 4500, 6500]
// Agent (slower):         [0, 50, 150, 350, 700, 1200, 2000, 3000, 4500, 7000]

type StoreItemType =
  | "title" | "avatar_frame" | "name_color" | "animation"
  | "theme" | "flair" | "font" | "bubble_font" | "bubble_color";

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

### 6.3 Sound System

```typescript
type SoundSlot =
  | "ping" | "double" | "triple" | "mega" | "ultra"
  | "rampage" | "godlike" | "levelup" | "shutdown";

interface SoundPackMeta {
  id: string;
  name: string;
  slots: Partial<Record<SoundSlot, string>>;
  createdAt: number;
  createdBy: string;
}

interface GamificationSettings {
  threshold: number | null;        // Seconds per question
  comboTimeoutMs: number | null;
  enabled: boolean | null;
  sounds: Partial<Record<SoundSlot, string>> | null;
}
// Cascade: hardcoded defaults -> org -> judge override -> personal override
```

---

## 7. Events & Messaging

### 7.1 SSE Events

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

### 7.2 Broadcasts

```typescript
interface BroadcastEvent {
  id: string;
  type: string;                    // Prefab event type
  triggerEmail: string;
  displayName: string;
  message: string;
  animationId: string | null;
  ts: number;
}

// Prefab types: "sale_completed", "perfect_score", "ten_audits_day",
// "level_up", "badge_earned", "streak_milestone", "queue_cleared",
// "weekly_accuracy_100"
```

### 7.3 In-App Messages

```typescript
interface Message {
  id: string;
  from: string;                    // Email
  to: string;                      // Email
  body: string;
  ts: number;
  read: boolean;
}
```

---

## 8. Configuration

### 8.1 Pipeline

```typescript
interface PipelineConfig {
  maxRetries: number;              // Default: 5
  retryDelaySeconds: number;       // Default: 10
}
```

### 8.2 Webhooks

```typescript
type WebhookKind = "terminate" | "appeal" | "manager" | "judge";

interface WebhookConfig {
  postUrl: string;
  postHeaders: Record<string, string>;
}
```

### 8.3 Email Reports (Scheduled)

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
  cadenceDay?: number;             // 0-6 for weekly, 1-30 for monthly
  sections: Record<ReportSection, SectionConfig>;
  createdAt: number;
  updatedAt: number;
}
```

---

## 9. RAG

```typescript
interface RagRetrieveParams {
  query: string;
  index: Index;                    // Pinecone Index
  namespace?: string;
  filter?: Record<string, unknown>;
  topK?: number;                   // Default 32
  keep?: number;                   // Default 10
  includeValues?: boolean;
  mmrLambda?: number;              // Default 0.4
  rrfK?: number;                   // Default 60
  sparseQuery?: (q: string) => { indices: number[]; values: number[] } | null;
  hybridAlpha?: number;            // Default 0.55
  rerank?: (
    query: string,
    candidates: { id: string; text: string; metadata: unknown }[],
  ) => Promise<{ i: number; score: number }[]>;
  log?: (ev: string, data?: unknown) => void;
}

interface RagDoc {
  id: string;
  score: number;
  text: string;
  metadata: Record<string, unknown>;
}
```

---

## 10. Deno KV Key Schema

All keys are scoped via `[rootTeamId, ...]` (the root team ID replaces the
former `orgId`). Global keys are noted explicitly.

### Teams & Auth (global)

| Key | Value | Notes |
| --- | ----- | ----- |
| `["team", teamId]` | Team | Global |
| `["team-by-slug", slug]` | string (teamId) | Global |
| `["team-children", parentTeamId]` | string[] | Child team IDs |
| `["email-index", email]` | `{rootTeamId, teamId}` | Global |
| `["session", token]` | Session | TTL: 24h |
| `[rootTeamId, "user", email]` | UserRecord | |
| `[rootTeamId, "role-def", roleId]` | RoleDef | |
| `[rootTeamId, "role-def-index"]` | string[] | RoleDef ID list |

### Dashboards

| Key | Value | Notes |
| --- | ----- | ----- |
| `[rootTeamId, "dashboard", "default", role]` | DashboardPage | System default per role |
| `[rootTeamId, "dashboard", dashboardId]` | DashboardPage | User-created dashboard |
| `[rootTeamId, "dashboard-active", userId]` | string | Active dashboard ID for this user |
| `[rootTeamId, "dashboard-index", userId]` | string[] | Dashboard IDs owned by or shared to user |

### Audit Core

| Key | Value | Notes |
| --- | ----- | ----- |
| `[rootTeamId, "audit-config", configId]` | AuditConfig | |
| `[rootTeamId, "audit-config-index"]` | string[] | Config ID list |
| `[rootTeamId, "audit-question", questionId]` | AuditQuestion | |
| `[rootTeamId, "audit-question-test", testId]` | QuestionTest | |
| `[rootTeamId, "audit-instance", instanceId, chunkIdx]` | string (JSON chunk) | Chunked for >64KB |
| `[rootTeamId, "audit-instance", instanceId, "_n"]` | number | Chunk count |
| `[rootTeamId, "audit-answer", instanceId, questionIdx]` | AuditAnswer | |

### Pipeline Transient (TTL)

| Key | Value | Notes |
| --- | ----- | ----- |
| `[rootTeamId, "question-cache", instanceId, hash]` | `{answer,thinking,defense}` | TTL: 10min |
| `[rootTeamId, "destination-questions", destId, chunkIdx]` | string (JSON chunk) | TTL: 10min |
| `[rootTeamId, "audit-batches-remaining", instanceId]` | number | Fan-in counter |
| `[rootTeamId, "audit-populated-questions", instanceId, chunkIdx]` | string (JSON chunk) | Backup |
| `[rootTeamId, "audit-answers-batch", instanceId, batchIdx, chunkIdx]` | string (JSON chunk) | Per-batch |
| `[rootTeamId, "audit-transcript", instanceId, chunkIdx]` | string (JSON chunk) | `{raw, diarized}` |

### Pipeline Stats (TTL: 24h)

| Key | Value | Notes |
| --- | ----- | ----- |
| `[rootTeamId, "stats-active", instanceId]` | `{step, ts}` | Currently processing |
| `[rootTeamId, "stats-completed", timestampId]` | `{instanceId, ts}` | |
| `[rootTeamId, "stats-error", timestampId]` | `{instanceId, step, error, ts}` | |
| `[rootTeamId, "stats-retry", timestampId]` | `{instanceId, step, attempt, ts}` | |

### Review Queue

| Key | Value | Notes |
| --- | ----- | ----- |
| `[rootTeamId, "review-pending", instanceId, qIdx]` | ReviewItem | |
| `[rootTeamId, "review-decided", instanceId, qIdx]` | ReviewDecision | |
| `[rootTeamId, "review-lock", instanceId, qIdx]` | `{claimedBy, claimedAt}` | TTL: 30min |
| `[rootTeamId, "review-audit-pending", instanceId]` | number | Remaining count |

### Judge Queue

| Key | Value | Notes |
| --- | ----- | ----- |
| `[rootTeamId, "judge-pending", instanceId, qIdx]` | JudgeItem | |
| `[rootTeamId, "judge-decided", instanceId, qIdx]` | JudgeDecision | |
| `[rootTeamId, "judge-lock", instanceId, qIdx]` | `{claimedBy, claimedAt}` | TTL: 30min |
| `[rootTeamId, "judge-audit-pending", instanceId]` | number | Remaining count |

### Appeals

| Key | Value |
| --- | ----- |
| `[rootTeamId, "appeal", instanceId]` | AppealRecord |
| `[rootTeamId, "appeal-stats", auditor]` | AppealStats |
| `[rootTeamId, "appeal-history", instanceId]` | AppealHistory |

### Manager Queue

| Key | Value |
| --- | ----- |
| `[rootTeamId, "manager-queue", instanceId]` | ManagerQueueItem |
| `[rootTeamId, "manager-remediation", instanceId]` | ManagerRemediation |

### Reports

| Key | Value | Notes |
| --- | ----- | ----- |
| `[rootTeamId, "report", reportId]` | Report | |
| `[rootTeamId, "report-folder", folderId]` | ReportFolder | |
| `[rootTeamId, "report-folder-index"]` | string[] | Folder ID list |
| `[rootTeamId, "report-recents", email]` | string[] | Recent report IDs per user |

### Gamification

| Key | Value |
| --- | ----- |
| `[rootTeamId, "gamification"]` | GamificationSettings (org-level) |
| `[rootTeamId, "gamification", "judge", email]` | GamificationSettings (judge override) |
| `[rootTeamId, "gamification", "reviewer", email]` | GamificationSettings (personal override) |
| `[rootTeamId, "game-state", email]` | GameState |
| `[rootTeamId, "badge", email, badgeId]` | EarnedBadge |
| `[rootTeamId, "badge-stats", email]` | BadgeCheckState |
| `[rootTeamId, "store-item", itemId]` | StoreItem |
| `[rootTeamId, "sound-pack", packId]` | SoundPackMeta |

### Events & Messages

| Key | Value | Notes |
| --- | ----- | ----- |
| `[rootTeamId, "event", targetEmail, eventId]` | AppEvent | TTL: 24h |
| `[rootTeamId, "broadcast", eventId]` | BroadcastEvent | TTL: 24h |
| `[rootTeamId, "prefab-subs"]` | `Record<string, boolean>` | |
| `[rootTeamId, "message", ownerEmail, otherEmail, msgId]` | Message | Both views |
| `[rootTeamId, "unread-count", email]` | number | |

### Config

| Key | Value |
| --- | ----- |
| `[rootTeamId, "pipeline-config"]` | PipelineConfig |
| `[rootTeamId, "webhook-settings", kind]` | WebhookConfig |
| `[rootTeamId, "email-report-config", id]` | EmailReportConfig |

---

## 11. Pipeline State Machine

QStash-driven step chain. Each step is a separate HTTP endpoint.

### Status Transitions

```
pending
  |
  v
getting-recording --> transcribing
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

| Step | Endpoint | Status Set | Description |
| ---- | -------- | ---------- | ----------- |
| init | `/audit/step/init` | `getting-recording` | Download recording from Genie API to S3 |
| transcribe | `/audit/step/transcribe` | `transcribing` | S3 -> AssemblyAI transcription |
| transcribe-complete | `/audit/step/transcribe-complete` | (stays) | Groq LLM diarization |
| prepare | `/audit/step/prepare` | `populating-questions` -> `asking-questions` | Fetch questions, populate, embed in Pinecone, fan-out batches |
| ask-batch | `/audit/step/ask-batch` | (stays) | RAG query + Groq LLM per batch, fan-in via atomic counter |
| finalize | `/audit/step/finalize` | `finished` | Collect answers, feedback, populate queues, webhooks, award XP |
| cleanup | `/audit/step/cleanup` | -- | Delete Pinecone namespace (24h delay) |

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
                                   postJudgedAudit -> Manager Queue
```

---

## 12. Entity Relationships

```
Team (root, parentId: null) ---- (*) Team (children, nestable)
    |                                      |
    |                                  leaderId + memberEmails[]
    |
    +---- (*) RoleDef { level, capabilities[], permissions[] }
    |
    +---- (*) UserRecord ---- (1) RoleDef (via roleId)
    |              |
    |              +---- (*) DashboardPage (owned or shared, per role)
    |
    +---- (*) AuditConfig (1) ---- (*) AuditQuestion (1) ---- (*) QuestionTest
    |              |
    |              +---- (*) AuditInstance (via configId)
    |                                   |
    |                                   +---- (*) AuditAnswer
    |                                   |
    |                                   +---- (*) ReviewItem --> ReviewDecision
    |                                   |
    |                                   +---- (*) JudgeItem --> JudgeDecision
    |                                   |
    |                                   +---- (0..1) AppealRecord --> AppealHistory
    |                                   |
    |                                   +---- (0..1) ManagerQueueItem --> ManagerRemediation
    |
    +---- (*) Report ---- (1) ReportFolder
    |
    +---- (*) DashboardPage (system defaults, userId: null)
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

## 13. External Integrations

All integrations should be polymorphic behind their own interface for hot
swappability.

| Service | Purpose | Key Env Vars |
| ------- | ------- | ------------ |
| QStash (Upstash) | Pipeline message queue | `QSTASH_URL`, `QSTASH_TOKEN` |
| AWS S3 | Recording storage | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET` |
| AssemblyAI | Speech-to-text | `ASSEMBLYAI_API_KEY` |
| Groq | LLM (answering, diarization, feedback) | `GROQ_API_KEY` |
| OpenAI | Embeddings (text-embedding-3-small) | `OPEN_AI_KEY` |
| Pinecone | Vector DB for RAG retrieval | `PINECONE_DB_KEY`, `PINECONE_INDEX` |
| Postmark | Email sending | `POSTMARK_SERVER` |
| Genie | Recording download (dual-account) | `GENIE_AUTH`, `GENIE_AUTH_TWO`, `GENIE_BASE_URL` |
| External Deno KV | Secondary report storage | `DENO_KV_URL` |
