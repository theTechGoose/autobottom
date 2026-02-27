# Autobottom Reconciliation Report

## Codebase vs Study Brain Dump -- Gap Analysis

---

## 1. Organizational Structure

### Study Vision
- **Team** entity: nestable tree (parentId, name, slug, leaderId, memberEmails[])
- **RoleDef** entity: configurable (name, level, capabilities[], permissions[], isActive)
- 6 default roles with numeric levels: developer (0), admin (1), supervisor (2+), judge (2+), analyst (2+), agent (highest)
- Level-based visibility rule (see self + users at higher level numbers)
- Developer is platform-level, sits above all orgs
- Analyst role for reporting and automation

### Codebase Reality
- **OrgRecord**: flat (name, slug, createdAt, createdBy) -- no nesting
- **UserRecord**: role is a string enum ("admin" | "judge" | "manager" | "reviewer" | "user")
- 5 hardcoded roles, no RoleDef entity, no level system
- No developer role, no analyst role
- Role checks are inline string comparisons, not capability-driven

### Discrepancies

| Item | Study | Code | Gap Type |
|------|-------|------|----------|
| Team nesting | Unlimited depth tree | Flat org | **Not implemented** |
| RoleDef entity | Stored, configurable | Hardcoded enum | **Not implemented** |
| Level system | Numeric (0-N) | None | **Not implemented** |
| Capabilities array | Dynamic sidebar/route gating | Hardcoded role checks | **Not implemented** |
| Permissions array | Team ID-scoped data access | Org-level only | **Not implemented** |
| Developer role | Level 0, platform-wide | Does not exist | **Not implemented** |
| Analyst role | Level 2+, reporting | Does not exist | **Not implemented** |
| "supervisor" role | Study default role name | Code uses "manager" instead | **Naming mismatch** |
| "agent" role | Study default role name | Code uses "user" instead | **Naming mismatch** |
| "reviewer" role | Not a study default role | Exists in code as primary role | **Missing from study** |
| Visibility rule | Computed from levels | Not implemented | **Not implemented** |
| Impersonation | Developer impersonates admin | Admin impersonates users (partial) | **Partially implemented** |

---

## 2. Audit Data Model

### Study Vision
- **AuditConfig** (template): uuid + version composite key, name, fieldDefs[], questionIds[], skip[], isActive
- **AuditInstance** (execution): status, subjectEmail, configId, recordingUrl, transcript, fieldValues, results[]
- **AuditResult** (append-only log): origin (llm|reviewer|judge), author, timestamp, answers[], skipped[]
- Separation of template from execution; append-only result log

### Codebase Reality
- **AuditFinding**: monolithic entity containing recording paths, transcripts, question arrays (unpopulated/populated/answered), feedback, job context, appeal fields
- **AuditJob**: batch container (id, doneAuditIds[], status, owner, updateEndpoint, recordsToAudit[])
- **Question chain**: IQuestionSeed -> IQuestion -> IAnsweredQuestion (inheritance, not embedded results)
- No separation between template and execution
- No append-only result log

### Discrepancies

| Item | Study | Code | Gap Type |
|------|-------|------|----------|
| Template/execution split | AuditConfig vs AuditInstance | Monolithic AuditFinding | **Structural mismatch** |
| Composite version key | uuid:-:version | No versioning on audits | **Not implemented** |
| Append-only result log | AuditResult[] with origin | Questions mutated in-place | **Not implemented** |
| FieldDef on config | Typed input schema | No formal field definitions | **Not implemented** |
| SkipRule | Expression-based question skipping | Not implemented | **Not implemented** |
| subjectEmail | Identifies audited agent | "owner" field on finding | **Naming mismatch** |
| TranscriptData/Word | Structured transcript | Raw/fixed/diarized strings | **Structural mismatch** |
| AnswerEntry | Structured with ragDocs[], evaluation | IAnsweredQuestion with flat fields | **Structural mismatch** |
| RagDoc | Per-answer RAG evidence | Not stored per answer | **Not implemented** |

### Status Enum Mismatch

| Study Status | Code Status | Notes |
|------|------|-------|
| pending | pending | Match |
| transcribing | transcribing | Match |
| populating-questions | populating-questions | Match |
| asking-questions | asking-questions | Match |
| **resolved** | **finished** | **Different name** |
| appeal-pending | (no equivalent) | **Not implemented in code** |
| retrying | retrying | Match |
| -- | no recording | **Code-only** |
| -- | creating-job | **Code-only** |
| -- | pulling-record | **Code-only** |
| -- | getting-recording | **Code-only** |

---

## 3. Question System

### Study Vision
- **AuditQuestion**: questionText (with expression interpolation), header, expectedAnswer, questionType (ref), testIds[], ragParams
- **QuestionType**: name, regex, parser (bool|int|float|string), schema (JSON Schema)
- **QuestionTest**: snippet, expected, lastResult, lastAnswer
- **RagRetrieveParams**: per-question RAG config (query, topK, keep, mmrLambda, hybridAlpha, rerank)

### Codebase Reality
- **QLQuestion**: id, name, text, configId, autoYesExp, versions[], testIds[]
- **QLTest**: id, questionId, snippet, expected ("yes"|"no"), lastResult, lastAnswer, lastThinking, lastDefense, lastRunAt
- **IQuestionSeed**: header, unpopulated, populated, autoYesExp
- No QuestionType entity (no regex/parser/schema validation pipeline)
- No per-question RagRetrieveParams
- RAG params are global (Pinecone config), not per-question

### Discrepancies

| Item | Study | Code | Gap Type |
|------|-------|------|----------|
| QuestionType entity | Stored with regex/parser/schema | Does not exist | **Not implemented** |
| Validation pipeline | regex -> parser -> schema | None | **Not implemented** |
| Per-question RAG params | RagRetrieveParams embedded | Global Pinecone config | **Not implemented** |
| Question versioning | Via AuditConfig composite key | QLQuestion.versions[] (text history) | **Different approach** |
| autoYesExp | Not in study question model | Exists in code | **Missing from study** |
| lastThinking/lastDefense | Not in study QuestionTest | Exists in code QLTest | **Missing from study** |

---

## 4. Review & Appeals

### Study Vision
- **AppealRecord**: auditId, findingId, filedByEmail, notes, status (pending|resolved), judgeEmail, auditorEmail
- Result origins: llm -> reviewer -> judge as append-only log entries
- One appeal per finding per audit
- Judge must be higher authority than reviewer

### Codebase Reality
- **ReviewItem/ReviewDecision**: findingId, questionIndex, decision (confirm|flip), reviewer
- **JudgeItem/JudgeDecision**: findingId, questionIndex, decision (uphold|overturn), reason, judge
- **AppealRecord**: findingId, appealedAt, status (pending|complete), judgedBy, auditor, comment
- Appeal types: different-recording, additional-recording, upload-recording
- Re-audit creates new finding from appeal

### Discrepancies

| Item | Study | Code | Gap Type |
|------|-------|------|----------|
| Appeal status values | pending, resolved | pending, complete | **Naming mismatch** |
| Re-audit appeals | Not described | Fully implemented (3 types) | **Missing from study** |
| Appeal comment | In AppealRecord.notes | In AppealRecord.comment | **Naming mismatch** |
| Decision reasons | Not detailed | "error", "logic", "fragment", "transcript" | **Missing from study** |
| Undo capability | Not described | Reviewers/judges can undo last | **Missing from study** |
| Decision speed tracking | Not described | speedMs tracked per decision | **Missing from study** |
| Combo tracking during review | Not described (ComboPack is different) | Runtime combo counter per session | **Missing from study** |

---

## 5. Coaching / Manager Module

### Study Vision
- **CoachingRecord**: agentEmail, pending[] (audit IDs), completed[] (CoachingAction[])
- **CoachingAction**: auditId, failedQuestionIds[], managerEmail, managerNotes, addressedAt
- Triggered by: audit resolves with failed questions
- Supervisor role handles coaching

### Codebase Reality
- **ManagerQueueItem**: findingId, owner, recordId, recordingId, totalQuestions, failedCount, completedAt, jobTimestamp, status (pending|addressed)
- **ManagerRemediation**: findingId, notes, addressedBy, addressedAt
- Triggered by: review decisions confirm "No" answers
- Manager role handles this

### Discrepancies

| Item | Study | Code | Gap Type |
|------|-------|------|----------|
| Entity name | CoachingRecord | ManagerQueueItem | **Naming mismatch** |
| Action name | CoachingAction | ManagerRemediation | **Naming mismatch** |
| Role name | Supervisor | Manager | **Naming mismatch** |
| Trigger timing | Audit resolves with failures | Review confirms failures | **Different trigger** |
| Per-agent grouping | CoachingRecord per agent | Queue items per finding | **Structural mismatch** |
| Failed question IDs | Tracked in CoachingAction | Not tracked (just failedCount) | **Less detail in code** |
| Backfill capability | Not described | manager/api/backfill endpoint | **Missing from study** |
| Agent CRUD | Not described | Manager creates/deletes agents | **Missing from study** |

---

## 6. Dashboard System

### Study Vision
- **DashboardPage** entity: ownerId, role, name, widgets[], sharedWith[], isActive
- **WidgetSlot**: id, type (7 types), title, column, order, span, config
- Configurable grid layout (3 columns desktop)
- Copy-on-first-access system defaults
- Widget sharing with permission scoping
- Widget types: report, text, button-bar, link-bar, search, reports-list, embed

### Codebase Reality
- Hardcoded per-role HTML pages (review/dashboard, judge/dashboard, manager page, agent page, admin/dashboard)
- No DashboardPage entity
- No widget system
- No grid layout engine
- No sharing mechanism
- Each dashboard is a static HTML template with server-rendered data

### Discrepancies

| Item | Study | Code | Gap Type |
|------|-------|------|----------|
| DashboardPage entity | Stored, configurable | Does not exist | **Not implemented** |
| Widget system | 7 types, grid layout | Does not exist | **Not implemented** |
| Dashboard sharing | sharedWith[] + permissions | Does not exist | **Not implemented** |
| Copy-on-first-access | Cloning default on first visit | Does not exist | **Not implemented** |
| Multiple dashboards per user | Supported | One hardcoded per role | **Not implemented** |

---

## 7. Report System

### Study Vision
- **Report** entity: type (5 types), query (ReportQuery), options, properties (type-specific), folderId, ownerId
- **ReportQuery**: filter (FilterGroup), sortBy[], groupBy[], formulaFields[]
- **ReportFolder**: name, isDefault, createdBy
- 5 visualization types: table, chart, calendar, summary, timeline
- Full query engine with nested filters, sort, group, computed fields
- Scheduled delivery via EventConfig

### Codebase Reality
- **EmailReportConfig**: id, name, recipients[], cadence (daily|weekly|biweekly|monthly), cadenceDay, sections{}, timestamps
- Report sections: pipeline, review, appeals, manager, tokens
- Detail levels: low, medium, high
- No Report entity, no visualization types, no query engine, no folders
- Reports are email-based summaries of system metrics

### Discrepancies

| Item | Study | Code | Gap Type |
|------|-------|------|----------|
| Report entity | Full stored entity | Does not exist | **Not implemented** |
| 5 visualization types | table, chart, calendar, summary, timeline | None | **Not implemented** |
| Query engine | FilterGroup, sorting, grouping, formulas | None | **Not implemented** |
| Report folders | Stored, with defaults | None | **Not implemented** |
| Email report config | Via EventConfig | Separate EmailReportConfig entity | **Different approach** |
| Report sections | Not in study model | pipeline, review, appeals, manager, tokens | **Code-only concept** |
| Detail levels | Not in study model | low, medium, high | **Code-only concept** |

---

## 8. Gamification

### Study Vision
- **Player** entity: xp, dayStreak, avatar (7-slot Avatar), inventory, eventBindings[], equippedBadgeId, equippedThemeId, equippedComboPackId, badgeProgress[], earnedBadges[]
- **Effect** entity: name, css, js (sandboxed with knobs)
- **StoreItem**: target (letter|frame|title|email|flair), weight (4 values), rarity (7 values), effects[]
- **ComboPack** entity: stored, with ComboConsumerDef and ComboTier
- **BadgeDef**: declarative filter[] (BadgeCriteria) + increment expression
- **GamificationSettings**: team cascade via delegateTo[]

### Codebase Reality
- **GameState**: totalXp, tokenBalance, level, dayStreak, lastActiveDate, purchases[], equippedTitle, equippedTheme, animBindings
- **StoreItem**: type (9 values: title, avatar_frame, name_color, animation, theme, flair, font, bubble_font, bubble_color), rarity (5 values)
- **BadgeDef**: imperative check(stats) function, tier (5 values), category (7 values)
- **Sound packs**: 5 defaults + custom upload + 9 sound slots
- GamificationSettings cascade: org -> supervisor -> personal
- 40+ hardcoded badges, 30+ hardcoded store items

### Discrepancies

| Item | Study | Code | Gap Type |
|------|-------|------|----------|
| Player vs GameState | Player with avatar/inventory/etc | Simpler GameState | **Structural mismatch** |
| Avatar system | 7 slots (letter, flair, letterId, frameId, titleId, emailId, flairId) | equippedTitle + equippedTheme | **Partially implemented** |
| Inventory entity | Embedded ownedItemIds[] | purchases[] on GameState | **Different structure** |
| Effect entity | Stored with css/js sandboxing | Does not exist | **Not implemented** |
| ComboPack entity | Stored with tiers and sound | Runtime combo counter only | **Not implemented** |
| Badge criteria | Declarative filter[] + expression | Imperative check() function | **Different approach** |
| Badge tiers | Not defined | common, uncommon, rare, epic, legendary | **Code-only** |
| Badge categories | Not defined | milestone, speed, streak, combo, level, quality, special | **Code-only** |
| Sound packs | Not described anywhere | 5 defaults + custom + 9 slots | **Missing from study** |
| Rarity values | common, normal, rare, epic, legendary, limited, unique (7) | common, uncommon, rare, epic, legendary (5) | **Value mismatch** |
| Store item types | 5 targets (letter, frame, title, email, flair) | 9 types (title, avatar_frame, name_color, animation, theme, flair, font, bubble_font, bubble_color) | **Code has more** |
| Weight system | light, regular, medium, bold (border + font weight) | Not implemented | **Not implemented** |
| Event bindings | eventType -> gifUrl on Player | animBindings on GameState | **Naming mismatch** |
| Knob functions | knobs.number(), knobs.color(), knobs.string(), knobs.url() | Not implemented | **Not implemented** |
| Team cascade mechanism | delegateTo[] array | Role-based (org -> supervisor -> personal) | **Different approach** |

---

## 9. Events & Automation

### Study Vision
- **AppEvent** (per user, TTL 24h), **BroadcastEvent** (org-wide, TTL 24h), **Message** (persistent)
- **EventConfig**: name, trigger (dot-scoped pattern), fieldFilter[], conditions (FilterGroup), communicationType, receivers[], payloadTemplate
- **CommunicationProvider** interface: webhook, email, chat
- 80+ cataloged event types across 20+ domains
- Event-driven automation with pattern matching

### Codebase Reality
- Simple emitEvent(orgId, email, type, payload) function
- checkAndEmitPrefab for animation triggers
- BroadcastEvent support (getBroadcastEvents)
- Direct messaging (sendMessage, getConversation, etc.)
- 4 hardcoded webhook types: terminate, appeal, manager, judge
- ~6 event types emitted: review-decided, appeal-decided, remediation-submitted, audit-finished, badge-earned, level-up

### Discrepancies

| Item | Study | Code | Gap Type |
|------|-------|------|----------|
| EventConfig entity | Full automation rules | Does not exist | **Not implemented** |
| CommunicationProvider | Pluggable interface | Does not exist | **Not implemented** |
| Event catalog | 80+ typed events | ~6 simple string events | **Mostly not implemented** |
| Trigger patterns | Dot-scoped wildcards (audit.instance.*) | None | **Not implemented** |
| Field filters | On EventConfig | None | **Not implemented** |
| Condition evaluation | FilterGroup on events | None | **Not implemented** |
| Payload templates | Expression interpolation | None | **Not implemented** |
| Webhook system | Via CommunicationProvider | 4 hardcoded webhook kinds | **Different approach** |
| Chat provider | ChatCommunicationProvider | Not implemented | **Not implemented** |
| Email provider | EmailCommunicationProvider | Postmark direct integration | **Different approach** |

---

## 10. Providers & Services

### Study Vision
- **Provider** entity: type (db|llm|storage|email|auth), name, configSchema (FieldDef[]), code (string)
- **ProviderConfig** (per team): teamId, type, providerId, config, delegateTo[]
- **ServiceBinding** (per team): teamId, service, providers[] (ordered), delegateTo[]
- **IdempotencyRecord**: key (sha256), state (locked|succeeded|unknown|failed), lockedUntil, attempts
- **Idempoter** class: defineScope(), execute(), mark()
- Team tree cascading resolution
- Circuit breaker on N failures

### Codebase Reality
- Hardcoded providers: Groq, AssemblyAI, QuickBase, Genie, Pinecone, Postmark, OpenAI
- Each provider is a TypeScript module with direct API calls
- Configuration via environment variables
- Dual Genie account fallback (hardcoded)
- No dynamic provider system, no service bindings, no idempotency kernel

### Discrepancies

| Item | Study | Code | Gap Type |
|------|-------|------|----------|
| Provider entity | Stored with schema + code string | Hardcoded TS modules | **Not implemented** |
| ProviderConfig | Per team, admin-configured | Env vars, global | **Not implemented** |
| ServiceBinding | Wiring services to providers | Does not exist | **Not implemented** |
| IdempotencyRecord | State machine for execution | Does not exist | **Not implemented** |
| Idempoter class | Deterministic execution kernel | Does not exist | **Not implemented** |
| Team cascade resolution | Walk up tree, first match wins | Does not exist | **Not implemented** |
| Circuit breaker | Auto-disable on N failures | Does not exist | **Not implemented** |
| Fallback chain | Ordered providers[] with rules | Dual Genie only (hardcoded) | **Partially implemented** |
| Provider send/guaranteeSend | Public API methods | Direct fetch calls | **Not implemented** |

---

## 11. Expression Engine

### Study Vision
- Variables: `{{currentUser}}`, `{{record.fieldName}}`, `{{fields.*}}`, `{{event}}`
- Functions: `audits(user)`, `appeals(user)`, `scores(user, configId)`, `average()`, `count()`, `latest()`, `llm(prompt, ...context)`
- Context varies by location (email, badge, skip rule)
- Nesting supported

### Codebase Reality
- Template substitution: `{{ }}` placeholders in questions replaced with QuickBase record values
- AST parsing for compound questions: `|` (OR), `&` (AND), `!` (NOT)
- autoYesExp: simple expression on question seeds
- No general expression engine, no data fetcher functions, no llm() function

### Discrepancies

| Item | Study | Code | Gap Type |
|------|-------|------|----------|
| General expression engine | Full formula system | Basic template substitution | **Not implemented** |
| Data fetcher functions | audits(), appeals(), scores() | Not implemented | **Not implemented** |
| Transformer functions | average(), count(), latest() | Not implemented | **Not implemented** |
| AI function | llm(prompt, ...context) | Not implemented | **Not implemented** |
| Context system | Location-dependent variables | Not implemented | **Not implemented** |
| Compound question AST | Not detailed in study | Implemented with |/&/! operators | **Missing from study** |

---

## 12. Marketplace

### Study Vision
- Plugin system for sandboxed items
- Item types: Effects, Functions, Themes, Widgets, Report types, Store items, Badge definitions, Email templates, Calculated fields, Validators, Condition functions
- Sandboxed string functions exported as JSON
- No document/window/DOM access

### Codebase Reality
- Does not exist

### Discrepancies
The entire marketplace/plugin system is **not implemented**. The study dedicates a full spec to it (specs/marketplace.md).

---

## 13. Logging

### Study Vision
- Structured JSON logs to stdout
- Grafana Cloud (managed Loki + Grafana)
- Log entry: timestamp, level, service, teamId, orgId, userId, message, data
- Visibility: developer sees all, admin sees org, user sees team

### Codebase Reality
- Console.log / console.error throughout
- No structured logging
- No Grafana integration
- No log level system
- Token usage tracking exists (LLM calls), but separate from logging

### Discrepancies

| Item | Study | Code | Gap Type |
|------|-------|------|----------|
| Structured logging | JSON to stdout | Unstructured console | **Not implemented** |
| Grafana Cloud | Managed Loki + Grafana | Not integrated | **Not implemented** |
| Log visibility | Role-scoped log access | Not implemented | **Not implemented** |

---

## 14. Features in Code NOT Mapped in Study

These features exist in the codebase but are absent or inadequately described in the study:

| Feature | Code Location | Description |
|---------|---------------|-------------|
| **Sound Packs** | lib/kv.ts, shared/sound-engine.ts, sounds/ | 5 default packs + custom upload, 9 sound slots, per-org config |
| **Reviewer role** | auth/kv.ts | Distinct role between judge and user; not a study default role |
| **Manager role** | auth/kv.ts | Maps to study's "supervisor" but with different name and scope |
| **Re-audit appeals** | controller.ts | 3 appeal types: different-recording, additional-recording, upload-recording |
| **Undo decisions** | review/kv.ts, judge/kv.ts | Reviewers/judges can undo their last decision |
| **Decision speed tracking** | review/kv.ts | Millisecond-level decision speed recorded |
| **Token usage tracking** | providers/groq.ts | Per-function LLM token/call counts with 24h TTL |
| **QuickBase integration** | providers/quickbase.ts | Fetches records and questions from QuickBase tables |
| **Dual Genie accounts** | providers/genie.ts | Primary + secondary with automatic fallback |
| **Compound question AST** | providers/question-expr.ts | AND/OR/NOT operators for compound questions |
| **Batch parallelism** | steps/ask-batch.ts, admin | Configurable batch sizes for question answering |
| **Queue management** | admin routes, lib/queue.ts | QStash queue configuration endpoints |
| **Seed data system** | seed-data.json, admin routes | Admin can dry-run or execute data seeding |
| **KV wipe** | admin routes | Admin can delete all org data |
| **Force NOs** | admin routes | Admin can force all findings to auto-fail |
| **Reset finding** | admin routes | Admin can reset finding to initial status |
| **Review backfill** | review/kv.ts | Re-queue finished audits for review |
| **Manager backfill** | manager/kv.ts | Rebuild manager queue from review decisions |
| **Badge editor** | admin, shared/badge-editor-page.ts | Admin creates custom store items |
| **Badge tiers** | shared/badges.ts | common, uncommon, rare, epic, legendary |
| **Badge categories** | shared/badges.ts | milestone, speed, streak, combo, level, quality, special |
| **Reviewer management** | judge/handlers.ts | Judges create/delete reviewers |
| **Agent management** | manager/handlers.ts | Managers create/delete agents |
| **Chat system** | chat/ | Direct messaging with conversations, unread counts |
| **Combo counter** | review, shared/combometer.ts | Runtime combo tracking during review sessions |
| **Prefab event subscriptions** | lib/kv.ts | Users subscribe to events for animation triggers |
| **S3 audio streaming** | controller.ts | Stream recording audio to client |
| **Super admin dashboard** | shared/super-admin-page.ts | Admin-only system overview page |
| **Impersonation bar** | shared/impersonate-bar.ts | UI component for role impersonation |
| **Swagger / OpenAPI** | swagger.ts | API documentation endpoint |
| **Pipeline stats** | lib/kv.ts | Real-time tracking of active, completed, errored, retried audits |
| **Chunked KV storage** | lib/kv.ts | 30KB chunk limit with split/reassemble logic |
| **Question caching** | lib/kv.ts | 10-min TTL LLM answer cache |

---

## 15. Features in Study NOT Implemented in Code

These features are described in the study but have no implementation:

| Feature | Study Location | Priority Indicator |
|---------|----------------|-------------------|
| **Nestable team tree** | data-model/teams-roles-auth.md, specs/org/teams.md | Core architectural |
| **RoleDef entity** | data-model/teams-roles-auth.md, specs/org/roles.md | Core architectural |
| **Level system** | data-model/teams-roles-auth.md | Core architectural |
| **Capabilities/permissions arrays** | specs/org/roles.md, capability specs | Core architectural |
| **Developer role** | specs/org/capabilities/developer.md | Platform feature |
| **Analyst role** | specs/org/capabilities/analyst.md | New role |
| **DashboardPage entity** | data-model/dashboards-navigation.md, specs/dashboard/ | Major feature |
| **Widget system (7 types)** | specs/dashboard/widgets.md | Major feature |
| **Dashboard sharing** | specs/dashboard/pages.md | Feature |
| **Report entity (5 types)** | data-model/reports.md, specs/reports/ | Major feature |
| **Report query engine** | specs/reports/query.md | Major feature |
| **Report folders** | specs/reports/report.md | Feature |
| **EventConfig automation** | data-model/events.md, specs/events.md | Major feature |
| **CommunicationProvider interface** | data-model/events.md | Architecture |
| **80+ event catalog** | data-model/event-catalog.md | Major feature |
| **Provider entity** | data-model/providers-services.md, specs/provider.md | Core architectural |
| **ProviderConfig per team** | data-model/providers-services.md, specs/services.md | Core architectural |
| **ServiceBinding** | data-model/providers-services.md, specs/services.md | Core architectural |
| **IdempotencyRecord + Idempoter** | data-model/providers-services.md, specs/idempoter.md | Architecture |
| **Circuit breaker** | specs/services.md | Reliability |
| **Expression engine** | specs/expressions.md | Major feature |
| **Marketplace / plugin system** | specs/marketplace.md | Major feature |
| **Effect entity (css/js sandbox)** | data-model/gamification.md, specs/gamification/store.md | Feature |
| **ComboPack entity** | data-model/gamification.md, specs/gamification/combos.md | Feature |
| **Declarative badge criteria** | data-model/gamification.md, specs/gamification/badges.md | Redesign |
| **7-slot avatar system** | data-model/gamification.md, specs/gamification/player.md | Feature |
| **Weight system on store items** | data-model/gamification.md | Feature |
| **Knob functions for effects** | specs/gamification/store.md | Feature |
| **Structured logging (Grafana)** | data-model/logging.md, specs/platform.md | Infrastructure |
| **Sidebar glow states** | specs/dashboard/sidebar.md | UI detail |
| **Copy-on-first-access dashboards** | specs/dashboard/pages.md | Feature |
| **isActive soft-delete pattern** | All data-model files | Convention |
| **Scheduled reports via EventConfig** | specs/reports/report.md | Feature |
| **delegateTo[] cascade** | specs/services.md, specs/gamification/settings.md | Architecture |

---

## 16. Terminology Translation Table

| Study Term | Code Term | Context |
|------------|-----------|---------|
| AuditInstance | AuditFinding | Core entity |
| AuditConfig | QLConfig | Template entity |
| AuditResult | answeredQuestions[] | Result storage |
| supervisor | manager | Role name |
| agent | user | Role name |
| resolved (status) | finished (status) | Pipeline terminal state |
| CoachingRecord | ManagerQueueItem | Post-audit feedback |
| CoachingAction | ManagerRemediation | Feedback action |
| AppealStatus: resolved | AppealStatus: complete | Appeal terminal state |
| Player | GameState | Gamification profile |
| StoreItem.target | StoreItem.type | Cosmetic slot |
| Avatar (7 slots) | equippedTitle + equippedTheme | Equipped cosmetics |
| eventBindings | animBindings | Event subscriptions |
| BadgeCriteria (declarative) | BadgeDef.check() (imperative) | Badge evaluation |
| Rarity: normal | Rarity: uncommon | Tier name |
| Rarity: limited, unique | (not in code) | Extra tiers |
| FieldDef | (not in code) | Input schema |
| SkipRule | (not in code) | Conditional skip |
| CommunicationProvider | WebhookConfig per kind | Event dispatch |
| delegateTo[] | (not in code) | Cascade control |
| isActive | (not in code) | Soft delete flag |

---

## 17. Structural Inconsistencies

### 17.1 Soft Delete vs Hard Delete
- **Study**: All entities have `isActive` field for soft-delete
- **Code**: Uses hard deletes (Deno KV .delete())
- **Impact**: Migration to study model requires adding isActive + changing all queries

### 17.2 Multi-Tenancy Model
- **Study**: Nestable team tree with org = root team; no separate Organization entity
- **Code**: Flat OrgRecord + orgId-scoped KV keys; Organization is a distinct entity
- **Impact**: Fundamental schema redesign required

### 17.3 Result Storage Pattern
- **Study**: Append-only AuditResult log with origin tracking
- **Code**: Questions mutated through inheritance chain; decisions stored separately per module
- **Impact**: Requires unifying review/judge decisions into a single append-only log

### 17.4 Gamification Profile Shape
- **Study**: Rich Player entity with embedded Avatar, Inventory, badge progress, earned badges
- **Code**: Flat GameState + separate badge storage in KV
- **Impact**: Migration requires consolidating scattered KV entries into Player entity

### 17.5 Configuration Cascade Model
- **Study**: Walk team tree up, first match wins; delegateTo[] controls overrides
- **Code**: Flat cascade: org defaults -> supervisor override -> personal override
- **Impact**: Team tree must exist before cascade can work as designed

---

## 18. Summary Statistics

| Metric | Count |
|--------|-------|
| Features implemented but missing from study | **32** |
| Features in study but not implemented | **32** |
| Naming mismatches (same concept, different name) | **14** |
| Structural mismatches (same concept, different shape) | **7** |
| Enum value mismatches | **5** |
| Approach differences (both exist but different design) | **6** |

---

## 19. Recommended Actions

1. **Align naming**: Decide on canonical names (supervisor vs manager, agent vs user, resolved vs finished, etc.) and update either study or code.

2. **Map code-only features into study**: 32 features exist in code with no study coverage. Key ones: sound packs, re-audit appeals, undo decisions, compound question AST, reviewer role, decision speed tracking, badge tiers/categories.

3. **Plan implementation order for study features**: The study describes a significantly more sophisticated system. Prioritize by dependency:
   - Team tree + RoleDef -> Capabilities/Permissions -> Visibility
   - Provider/ServiceBinding -> EventConfig -> Expression Engine
   - Report entity + Query engine -> Dashboard widgets
   - Marketplace requires most other systems first

4. **Resolve structural divergences**: The monolithic AuditFinding vs AuditConfig/AuditInstance split is the most impactful architectural difference. This should be decided early as it affects everything downstream.

5. **Address soft-delete convention**: Study assumes isActive everywhere; code uses hard deletes. This is a cross-cutting concern that should be decided globally.
