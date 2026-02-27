# Autobottom Gap Analysis Report

**Analyst**: Reconciliation between brain dump study and codebase implementation
**Date**: 2026-02-26

---

## Executive Summary

The study documents describe a **significantly redesigned and expanded** version of Autobottom. The current codebase is a working monolithic Deno Deploy application tightly coupled to QuickBase, Genie, and specific vendors. The study proposes abstracting away vendor lock-in, adding team hierarchy, a marketplace, an expression language, structured logging, and a full reporting engine -- most of which do not exist in the codebase today.

This report is organized into three sections:

1. **Functionality in the codebase NOT covered by the study** (orphaned/legacy features)
2. **Functionality in the study NOT implemented in the codebase** (planned-only features)
3. **Functionality in both, but with structural mismatches** (mapping gaps)

---

## Section 1: Implemented in Codebase, Missing or Unmapped in Study

These are features that exist in code but have no corresponding spec or data model entry in the study.

### 1.1 QuickBase Integration (Hard Dependency)

The codebase is tightly coupled to QuickBase as the record/question data source:

- `providers/quickbase.ts`: `getDateLegByRid()`, `getQuestionsForDestination()`, `queryRecords()`
- Field ID mappings via env vars (`QB_DATE_LEGS_TABLE`, `QB_AUDIT_QUESTIONS_TABLE`, etc.)
- Template population uses `{{fieldId}}` referencing QB field IDs
- Audit creation endpoints accept QuickBase record IDs (`rid` parameter)

**Study position**: The study abstracts this away into generic `Provider` + `ServiceBinding` patterns. QuickBase is never mentioned by name. The study treats record data as opaque `fields` passed into `AuditInstance`. There is no migration path documented.

>>we will no longer be pulling from quickbase shit is going to be passed
>>at audit time

### 1.2 Genie Recording Download (Dual-Account Fallback)

- `providers/genie.ts`: Dual-account failover (`GENIE_AUTH`, `GENIE_AUTH_TWO`)
- `genieIds` array for multi-recording audits
- Direct download with 5-retry logic

**Study position**: Recording acquisition is abstracted as a storage provider. Genie is not named. The study's `Provider` model with `send`/`guaranteeSend` does not map to the current download-based pattern.

>>providers solves this, we just need a recordings service to register the
>>providers

### 1.3 QStash Pipeline Orchestration

The codebase uses QStash (Upstash) for async step execution:

- Steps triggered via HTTP POST to QStash endpoints
- `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY` for auth/verification
- Fan-out for parallel `ask-batch` with atomic counter in Deno KV

**Study position**: The study's `PipelineConfig` mentions `maxRetries` and `retryDelaySeconds` but does not specify QStash or any queue technology. The audit lifecycle (`audit-lifecycle.md`) describes status transitions but not the orchestration mechanism.

>>providers solves this we just need a queue service to register the
>>providers

### 1.4 S3 Recording Storage

- Direct AWS S3 integration with SigV4 signing (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`)
- `s3RecordingKey` / `s3RecordingKeys` on AuditFinding
- Cleanup step deletes old recordings

**Study position**: Storage is an abstract `Provider` of type `storage`. S3 is not named.

>>providers solves this we just need a storage service to solve this

### 1.5 Sound System (Packs, Slots, Audio Files)

The codebase has a rich sound system:

- `SoundPackMeta` with 9 slots (ping, double, triple, mega, ultra, rampage, godlike, levelup, shutdown)
- Named packs: synth, smite, opengameart, mixkit-punchy, mixkit-epic
- `shared/sound-engine.ts`: Web Audio API integration
- 17+ MP3 files in `/sounds/`
- Per-org custom sound packs

**Study position**: The study's `ComboPack` / `ComboTier` system mentions `soundUrl` as a field, but the current sound pack infrastructure (named packs, slots, per-org CRUD) is not documented. The study redesigns audio around combo tiers rather than the current pack-slot model.

>>combo packs solve this

### 1.6 Combometer UI

- `shared/combometer.ts`: Visual combo counter during queue processing
- Combo tracking embedded in review/judge decision flow

**Study position**: Study describes `ComboPack` with `ComboConsumerDef` and `ComboTier` but as a purchasable gamification item, not the current built-in mechanic.

### 1.7 Chat / Messaging System

- `chat/page.ts`: In-app messaging UI
- `Message` type: `{id, from, to, body, ts, read}`
- Full conversation management: send, read, unread counts, conversation list

**Study position**: `Message` is listed in `events.md` as one of three event types (AppEvent, BroadcastEvent, Message). The study redefines Message as "direct, persistent" but doesn't spec the chat UI or conversation management features that already exist.

>>we reworked chat as a part of the message service, because the providers got
>>reworked, this slipped through the cracks. a message goes to a message service
>>that sent to one of the messages providers, an email works similarly but instead its
>>the email service and the last one is the http provider that goes to the exfil
>>service? im not sure exfil is the right name but you get it.

### 1.8 Impersonation System

- `shared/impersonate-bar.ts`: Visual impersonation controls
- `resolveEffectiveAuth(req)` in `auth/kv.ts`: Nested impersonation support
- Super-admin can assume any user identity

**Study position**: The study mentions impersonation under the Developer capability (`org/capabilities/developer.md`) with "nested support" but doesn't document the existing impersonate-bar UI component or the `resolveEffectiveAuth` mechanism.

>>add this to the study

### 1.9 Swagger / OpenAPI Documentation

- `swagger.ts`: OpenAPI spec generation
- Endpoint: `GET /api/docs` and `GET /api/docs.html`

**Study position**: Not mentioned anywhere in the study.

>>add this to the study

### 1.10 Webhook System (4-Kind Model)

Current implementation:

- `WebhookKind`: "terminate", "appeal", "manager", "judge"
- `WebhookConfig`: `{postUrl, postHeaders}`
- `fireWebhook()` triggered at specific lifecycle points

**Study position**: The study replaces this with a generic `EventConfig` + `CommunicationProvider` system. `WebhookCommunicationProvider` exists in the study but the current 4-kind webhook model is not mapped to the new event system. No migration path documented.

>>this is replaced by the ?exfil? service. webhook system is just a
>>filter on events. events fire, the payload is checked against a config
>>and then the exfil is executed based on teh configuration

### 1.11 Email Report System (Cadence-Based)

Current implementation:

- `EmailReportConfig`: cadence (daily/weekly/biweekly/monthly), sections (pipeline/review/appeals/manager/tokens)
- `SectionConfig`: enabled + detail level (low/medium/high)
- Per-org CRUD

**Study position**: The study mentions `schedule.report` events and a report-embed capability in `EventConfig`, but the current cadence-based email report system with its section model is not mapped into the new architecture. The research file `emails.md` studies QuickBase's email feature but doesn't bridge to the existing implementation.

>>we have the reporting engine. we now just define, a cadence, who gets it
>>and a report. this is then sent to stakeholders

### 1.12 Pipeline Statistics (24h Rolling)

Current implementation:

- `trackActive`, `trackCompleted`, `trackError`, `trackRetry`
- Stats KV keys with 24h TTL
- Used by admin dashboard

**Study position**: Not directly mapped. The study's `logging.md` describes Grafana Cloud/Loki as the monitoring backend, but the current in-KV stats tracking is not mentioned.

>>replaced with logging. developer capabilitiy should be able to track these
>>and developers should be able to add to their dash

### 1.13 Token Usage Tracking

- Per-function token tracking: `["token-usage", ts, fn]`
- Groq token breakdown by function (24h rolling)
- Dashboard visualization

**Study position**: Not documented. The study's logging system could subsume this but doesn't explicitly address LLM token metering.

>>add to study

### 1.14 Test Files

- `test-qlab.ts`: Question Lab integration tests
- `test-single.ts`: Single audit test runner

**Study position**: No testing strategy documented.

>>add to study

### 1.15 Seed Data

- `seed-data.json` (2.5MB): Sample audit findings with real data

**Study position**: Not mentioned.

>>add to study

---

## Section 2: Described in Study, NOT Implemented in Codebase

These are features the study specifies that have no corresponding code.

### 2.1 Team Hierarchy (Nestable Tree)

**Study**: `org/team-structure.md`, `org/teams.md`

- Teams form a nestable tree: Developer team -> Org root -> child teams
- Team traversal for cascading resolution
- `memberAdded`/`memberRemoved` events

**Codebase**: Flat org model. An `OrgRecord` has `{name, slug, createdAt, createdBy}`. Users belong to one org with a role. No team tree, no team entity, no parent/child relationships, no cascading.

### 2.2 RoleDef (Configurable Roles with Levels)

**Study**: `org/roles.md`

- `RoleDef`: configurable by admins, level system, capabilities[], permissions[]
- Level drives visibility hierarchy
- Cached to `UserRecord` and `Session`

**Codebase**: Hardcoded `Role` union: `"admin" | "judge" | "manager" | "reviewer" | "user"`. No level system, no capabilities/permissions arrays, no RoleDef entity, no admin-configurable roles.

### 2.3 Capability-Based Access Control

**Study**: 6 capability specs (developer, admin, supervisor, analyst, judge, agent)

- Each role has explicit capability set (sidebar tabs/routes)
- Permissions define data scope (team IDs)
- Session snapshots capabilities at login

**Codebase**: Simple role string check. No capability system. Routes are hardcoded per role in `controller.ts`. No per-team permission scoping beyond org-level.

### 2.4 Provider Abstraction Layer

**Study**: `providers-services.md`, `provider.md`

- `Provider`: code string + Idempoter instance
- `ProviderConfig`: admin-configured per team
- Cascading resolution: child -> parent -> org root -> platform
- `send()` (fire-and-forget) vs `guaranteeSend()` (pessimistic)

**Codebase**: Providers are hardcoded modules (`providers/groq.ts`, `providers/quickbase.ts`, etc.) directly imported. No provider abstraction, no dynamic code execution, no cascading, no admin configuration.

### 2.5 Service Bindings & Circuit Breakers

**Study**: `services.md`

- Named services with ordered fallback chain of providers
- 5xx/network -> next provider; 4xx = no fallback
- Circuit breakers on N failures with cooldown reset

**Codebase**: No service binding concept. Each step directly calls its specific provider. No fallback chains, no circuit breakers.

### 2.6 Idempotency Kernel (Idempoter)

**Study**: `idempoter.md`

- Effectively-once semantics via idempotency keys + lease-based locking
- States: locked -> succeeded/unknown -> reconcile -> succeeded/failed
- SHA-256 key generation

**Codebase**: No idempotency kernel. The pipeline relies on QStash's at-least-once delivery with manual deduplication where needed.

### 2.7 Marketplace

**Study**: `marketplace.md`

- Item types: Effects, Functions, Themes, Widgets, Report types, Store items, Badge definitions, Email templates, Calculated fields, Validators, Condition functions
- Sandboxed string functions exported as JSON
- Open publishing

**Codebase**: Does not exist. No marketplace entity, no plugin system, no sandboxed function execution.

### 2.8 Expression Language

**Study**: `expressions.md`

- Mini formula engine: `{{variable}}`, function calls, nesting, literals
- Context: `{{event}}`, `{{currentUser}}`, `{{record}}`
- Data fetcher functions, transformers, AI (`llm()`)

**Codebase**: Limited template substitution (`{{fieldId}}` -> QuickBase field values) and a custom AST parser for compound questions (`+:` prefix, `&`/`|`/`!` operators). No general-purpose expression engine, no function library, no `llm()` function.

### 2.9 EventConfig System (Reactive Automation)

**Study**: `events.md`

- `EventConfig`: trigger pattern + conditions -> dispatch via `CommunicationProvider`
- 50+ event types across all domains
- Field change filters, dot-scoped wildcards
- Three provider types: Webhook, Email, Chat

**Codebase**: Basic event system with 5 event types (`EventType` union). `PrefabEventDef` for broadcast animations. No `EventConfig`, no reactive automation, no field change filters, no wildcard triggers, no `CommunicationProvider` abstraction.

### 2.10 Report Engine (Full Query System)

**Study**: `reports/report.md`, `reports/query.md`, `reports/types.md`

- `Report`: type, query, options, properties
- `ReportQuery`: FilterGroup (recursive AND/OR), sort, group, formula fields
- 5 report types: table, chart, calendar, summary, timeline
- Permission-scoped viewing

**Codebase**: No report entity. No query engine. No filter/sort/group system. The existing "email reports" are static cadence-based summaries, not interactive queryable reports.

### 2.11 Report Folders

**Study**: `reports/report.md`

- `ReportFolder`: name, isDefault, createdBy
- Organization of reports into folders

**Codebase**: Does not exist.

### 2.12 Dashboard Builder (Copy-on-Write, Widget Grid)

**Study**: `dashboard/pages.md`, `dashboard/widgets.md`

- `DashboardPage`: copy-on-first-access from system defaults
- Widget grid layout with column spans
- 7 widget types: report, text, button-bar, link-bar, search, reports-list, embed
- Sharing with read-only views

**Codebase**: Dashboards are hardcoded HTML pages per role (`agent/page.ts`, `review/dashboard.ts`, `judge/dashboard.ts`, `dashboard/page.ts`). No `DashboardPage` entity, no widget system, no copy-on-write, no sharing.

### 2.13 Sidebar Navigation (Dynamic from Capabilities)

**Study**: `dashboard/sidebar.md`

- Collapsed/expanded sidebar with glow line
- Tabs computed from `session.capabilities[]`
- Active tab highlighting

**Codebase**: No shared sidebar component. Each role-page has its own inline navigation or none at all.

### 2.14 Coaching Module

**Study**: `coaching.md`, `data-model/coaching.md`

- `CoachingRecord`: per agent, pending[] + completed[]
- `CoachingAction`: supervisor reviews failed questions, leaves notes
- Events: `coaching.pending`, `coaching.completed`

**Codebase**: The manager queue handles remediation (`ManagerRemediation`: notes + addressedBy), but there is no separate coaching entity. The study's coaching is supervisor-driven post-audit review; the codebase's manager queue is remediation tracking. These are related but architecturally different.

### 2.15 Structured Logging (Grafana/Loki)

**Study**: `logging.md`

- JSON structured logs per request
- Grafana Cloud (Loki) backend
- Label filtering on team tree
- Fields: timestamp, level, service, teamId, orgId, userId, message, data

**Codebase**: No structured logging. Console output only. No Grafana/Loki integration.

### 2.16 AuditConfig Versioning

**Study**: `audit-template/config.md`

- `AuditConfig` with uuid:-:version composite key
- Old versions never deleted
- `versionPublished`, `breakingChange` events

**Codebase**: `QLConfig` (Question Lab) has a `questionIds` array and basic CRUD. `QLQuestion` has a `versions` array (`QLVersion[]`) for text history, but no formal versioning system with composite keys, breaking change detection, or publish workflow.

### 2.17 FieldDef & SkipRules

**Study**: `audit-template/fields.md`

- `FieldDef`: key, label, type, required, default, options
- `SkipRule`: conditional question removal based on field expressions

**Codebase**: Fields come from QuickBase records. No `FieldDef` entity. No skip rules. Question filtering is done via the `autoYesExp` expression and AST evaluation, which is a different mechanism.

### 2.18 RAG Parameters per Question

**Study**: `audit-template/questions.md`

- `RagRetrieveParams`: query, topK, keep, mmrLambda, hybridAlpha, rerank

**Codebase**: RAG params are hardcoded in `providers/pinecone.ts`. No per-question RAG configuration. All questions use the same retrieval parameters.

### 2.19 Effects System (Sandboxed CSS/JS)

**Study**: `gamification/store.md`

- `Effect`: sandboxed CSS/JS with knob functions
- `AppliedEffect`: Effect + filled-in knob values
- Proxy-based sandbox preventing DOM/window access

**Codebase**: `StoreItem` has `type`, `icon`, `preview` but no `effects[]` array. No sandboxed code execution. No knob functions. Store items are static cosmetics (titles, frames, colors).

### 2.20 ThemeDef (Full Color Scheme)

**Study**: `gamification/store.md`

- `ThemeDef`: 12+ color tokens (primary, secondary, accent, success, warning, error, info, background, surface, foreground, muted, border)

**Codebase**: `equippedTheme` exists on `GameState` but there is no `ThemeDef` entity. Themes are just string identifiers with no structured color definition.

### 2.21 Notification Packs

**Study**: `providers-services.md`

- Marketplace items providing pre-built EventConfig templates

**Codebase**: Does not exist.

### 2.22 Analyst Role

**Study**: `org/capabilities/analyst.md`

- Read-heavy role for report building and observation
- Full CRUD on reports, dashboards, templates

**Codebase**: No analyst role. The `Role` union is: admin, judge, manager, reviewer, user.

### 2.23 Supervisor Role (Distinct from Manager)

**Study**: `org/capabilities/supervisor.md`

- Reviews LLM results, coaches agents
- Level 2+ with team-scoped visibility

**Codebase**: "Reviewer" role exists but is different from "supervisor". The study's "supervisor" maps roughly to the codebase's "reviewer" + "manager" combined. The study separates review work (supervisor) from remediation oversight.

---

## Section 3: Present in Both, but Structurally Mismatched

### 3.1 Audit Entity: `AuditFinding` vs `AuditInstance`

| Aspect     | Codebase (`AuditFinding`)                                         | Study (`AuditInstance`)                           |
| ---------- | ----------------------------------------------------------------- | ------------------------------------------------- |
| Size       | ~30 fields monolithic blob                                        | Lean aggregate with separated concerns            |
| Questions  | 3 arrays: unpopulated, populated, answered                        | `results[]` append-only with origin tracking      |
| Status     | 10 statuses (including step-specific)                             | 6 statuses (higher-level lifecycle)               |
| Recording  | `s3RecordingKey`, `recordingPath`, `genieIds`                     | Abstracted via storage provider                   |
| Job link   | `auditJobId` + inline `job` object                                | `configId` reference to `AuditConfig`             |
| Transcript | `rawTranscript`, `fixedTranscript`, `diarizedTranscript` (inline) | `TranscriptData` embedded with `TranscriptWord[]` |

The study completely restructures the core audit aggregate. The 30-field blob is split into focused entities (`AuditInstance`, `AuditResult`, `AnswerEntry`, `SkippedEntry`, `TranscriptData`).

### 3.2 Question Model

| Aspect  | Codebase                                                     | Study                                                                                      |
| ------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| Seed    | `IQuestionSeed {header, unpopulated, populated, autoYesExp}` | `AuditQuestion {questionText, header, expectedAnswer, questionType, testIds[], ragParams}` |
| Logic   | `+:` prefix with `&`/`                                       | `/`!` operators, custom AST parser                                                         | Expression language with `{{fields.*}}` context |
| Testing | `QLTest` with `snippet`, `expected`, `lastResult`            | `QuestionTest` with same fields + embedded in config                                       |
| Types   | No `QuestionType` entity                                     | `QuestionType {name, regex, parser, jsonSchema}` - formal type system                      |

### 3.3 Role Hierarchy

| Codebase Role | Study Equivalent         | Key Differences                                        |
| ------------- | ------------------------ | ------------------------------------------------------ |
| `admin`       | Admin (Level 1)          | Study adds level system, capabilities[], permissions[] |
| `reviewer`    | Supervisor (Level 2+)    | Study renames, adds team-scoped visibility             |
| `judge`       | Judge (Level 2+)         | Study adds peer-invisible constraint                   |
| `manager`     | (merged into Supervisor) | Study splits remediation into coaching flow            |
| `user`        | Agent (highest level)    | Study adds gamification tabs, self-only visibility     |
| (none)        | Analyst (Level 2+)       | New role in study                                      |
| (none)        | Developer (Level 0)      | New platform-level role in study                       |

### 3.4 Gamification: `GameState` vs `Player`

| Aspect    | Codebase (`GameState`)                        | Study (`Player`)                                                     |
| --------- | --------------------------------------------- | -------------------------------------------------------------------- |
| XP        | `totalXp` + `tokenBalance` (separate)         | Same concept                                                         |
| Level     | Calculated from `totalXp` via threshold table | Same (computed)                                                      |
| Streak    | `dayStreak` + `lastActiveDate`                | Same                                                                 |
| Avatar    | `equippedTitle`, `equippedTheme`              | `Avatar {letter, frame, title, email, flair}` - 5 customizable slots |
| Inventory | `purchases: string[]`                         | `Inventory {items: string[]}` - same but separate entity             |
| Effects   | Not present                                   | `AppliedEffect[]` on items                                           |
| Badges    | Separate `EarnedBadge` in KV                  | `earnedBadges[]` and `badgeProgress[]` embedded on Player            |

### 3.5 Badge System

| Aspect     | Codebase                                    | Study                                                  |
| ---------- | ------------------------------------------- | ------------------------------------------------------ |
| Definition | `BadgeDef` with `check()` function          | `BadgeDef` with declarative `BadgeCriteria[]`          |
| Evaluation | Imperative: `check(stats)` returns boolean  | Declarative: filter + increment expression + threshold |
| Scope      | Per-role hardcoded badges                   | Configurable, marketplace-publishable                  |
| Progress   | `BadgeCheckState` (all roles in one object) | `BadgeProgress` per badge (focused)                    |

### 3.6 Events: Current vs Planned

| Aspect               | Codebase                                                                                    | Study                                               |
| -------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Types                | 5: audit-completed, review-decided, appeal-decided, remediation-submitted, message-received | 50+ across all domains                              |
| TTL                  | AppEvent: 24h, BroadcastEvent: 24h, Message: persistent                                     | Same TTL model                                      |
| Automation           | None; events are read-only notifications                                                    | `EventConfig` with trigger -> condition -> dispatch |
| Broadcast animations | `PrefabEventDef` with hardcoded templates                                                   | `BroadcastEvent` with configurable triggers         |

### 3.7 Webhooks: 4-Kind vs EventConfig

The codebase has 4 hardcoded webhook kinds (terminate, appeal, manager, judge) with simple POST configuration. The study replaces this entirely with `EventConfig` + `WebhookCommunicationProvider`, which can trigger on any of 50+ events with field-level filtering and conditional execution.

### 3.8 Email Reports: Cadence vs EventConfig

The codebase has `EmailReportConfig` with cadence-based scheduling and section toggles. The study replaces this with `schedule.report` events in the `EventConfig` system + `EmailCommunicationProvider` with expression-based content.

### 3.9 Combo System

| Aspect  | Codebase                                   | Study                                      |
| ------- | ------------------------------------------ | ------------------------------------------ |
| Model   | Built-in mechanic in review/judge flow     | Purchasable `ComboPack` in store           |
| Audio   | Sound packs with 9 named slots             | `soundUrl` per `ComboTier`                 |
| Tiers   | Implicit (count maps to sound slot)        | Explicit `ComboTier[]` with effect + sound |
| Timeout | `comboTimeoutMs` in `GamificationSettings` | Same but on `GamificationSettings`         |
| Visuals | `shared/combometer.ts` UI component        | `AppliedEffect` per tier                   |

### 3.10 Authentication & Sessions

| Aspect   | Codebase                          | Study                                                        |
| -------- | --------------------------------- | ------------------------------------------------------------ |
| Password | SHA-256 hash with `randomUUID`    | `passwordHash` (algorithm not specified)                     |
| Session  | `{email, orgId, role, createdAt}` | `Session` with capabilities[], permissions[], teamId, roleId |
| Access   | Role string check                 | Capability check + permission check                          |
| Scope    | Org-level                         | Team-level with tree traversal                               |

---

## Section 4: Structural Inconsistencies & Quality Issues

### 4.1 Naming Inconsistencies Between Study and Code

| Concept                | Codebase Name        | Study Name       |
| ---------------------- | -------------------- | ---------------- |
| Core audit entity      | `AuditFinding`       | `AuditInstance`  |
| Question answers       | `IAnsweredQuestion`  | `AnswerEntry`    |
| Reviewer role          | `reviewer`           | `supervisor`     |
| Agent role             | `user`               | `agent`          |
| Remediation            | `ManagerRemediation` | `CoachingAction` |
| Audit blueprint        | `QLConfig`           | `AuditConfig`    |
| Gamification profile   | `GameState`          | `Player`         |
| Badge progress tracker | `BadgeCheckState`    | `BadgeProgress`  |

### 4.2 Study References Implementation Snapshot but Doesn't Reconcile

The file `study/research/rough-draft-state-2.24.md` documents the current codebase state (as of 2025-02-24). However, the data model files (`study/data-model/`) and specs (`study/specs/`) describe the **target** state without explicitly marking what requires migration from the current state. There is no migration plan or diff document.

### 4.3 Underdocumented in Study

- **Chunked KV storage**: The codebase uses a custom chunking system for >64KB values. The study doesn't address this constraint or propose an alternative.
- **QStash orchestration**: No mention of how async pipeline steps are triggered.
- **Fan-out/fan-in pattern**: The batch question-answering parallelization is not documented.
- **Dual-account Genie failover**: Current reliability pattern has no study equivalent.
- **Seed data generation**: No tooling or strategy documented.
- **Testing strategy**: No mention of test infrastructure.

### 4.4 Study Introduces Complexity Without Addressing Current Simplifications

The codebase works because it makes simplifying assumptions:

- One org per deployment (or simple multi-org via KV key prefix)
- Flat role hierarchy (5 hardcoded roles)
- Direct provider imports (no indirection)
- QuickBase as single source of truth for records

The study replaces all of these with more flexible but more complex systems (team trees, configurable roles, provider abstraction, generic field definitions) without documenting:

- Migration steps from current to target
- Backward compatibility strategy
- Performance implications of cascading resolution
- How to handle data already in Deno KV under the old schema

---

## Appendix: Feature Coverage Matrix

| Feature Domain                                                | In Code       | In Study                      | Status                                     |
| ------------------------------------------------------------- | ------------- | ----------------------------- | ------------------------------------------ |
| Audit pipeline (init/transcribe/prepare/ask/finalize/cleanup) | Yes           | Partially (lifecycle only)    | Orchestration detail missing from study    |
| QuickBase integration                                         | Yes           | No                            | Replaced by abstract providers             |
| Genie recording                                               | Yes           | No                            | Replaced by abstract storage               |
| S3 storage                                                    | Yes           | No                            | Replaced by abstract storage               |
| AssemblyAI transcription                                      | Yes           | No (abstract service)         | Current vendor unnamed                     |
| Groq LLM                                                      | Yes           | No (abstract service)         | Current vendor unnamed                     |
| Pinecone RAG                                                  | Yes           | Partially (RagRetrieveParams) | Per-question config is new                 |
| Review queue                                                  | Yes           | Yes                           | Role renamed (reviewer->supervisor)        |
| Judge/appeals queue                                           | Yes           | Yes                           | Mostly aligned                             |
| Manager/remediation queue                                     | Yes           | Replaced by coaching          | Architectural shift                        |
| Team hierarchy                                                | No            | Yes                           | New feature                                |
| Configurable roles                                            | No            | Yes                           | New feature                                |
| Capability-based auth                                         | No            | Yes                           | New feature                                |
| Provider abstraction                                          | No            | Yes                           | New feature                                |
| Service bindings                                              | No            | Yes                           | New feature                                |
| Idempotency kernel                                            | No            | Yes                           | New feature                                |
| Marketplace                                                   | No            | Yes                           | New feature                                |
| Expression language                                           | Partial (AST) | Yes (full engine)             | Major expansion                            |
| EventConfig automation                                        | No            | Yes                           | New feature                                |
| Report engine                                                 | No            | Yes                           | New feature                                |
| Dashboard builder                                             | No            | Yes                           | New feature                                |
| Sidebar navigation                                            | No            | Yes                           | New feature                                |
| Coaching module                                               | No            | Yes                           | New feature                                |
| Structured logging                                            | No            | Yes                           | New feature                                |
| Effects/sandbox                                               | No            | Yes                           | New feature                                |
| ThemeDef                                                      | No            | Yes                           | New feature                                |
| Analyst role                                                  | No            | Yes                           | New feature                                |
| Developer role                                                | No            | Yes                           | New feature                                |
| Sound packs                                                   | Yes           | Partially (combo tiers)       | Study redesigns approach                   |
| Combometer UI                                                 | Yes           | No                            | Orphaned component                         |
| Chat/messaging                                                | Yes           | Partially (Message type)      | UI not documented                          |
| Impersonation                                                 | Yes           | Partially (mentioned)         | Implementation detail missing              |
| Swagger/OpenAPI                                               | Yes           | No                            | Not documented                             |
| Webhook (4-kind)                                              | Yes           | Replaced by EventConfig       | Architectural shift                        |
| Email reports (cadence)                                       | Yes           | Replaced by EventConfig       | Architectural shift                        |
| Pipeline stats (KV)                                           | Yes           | Replaced by Loki logging      | Architectural shift                        |
| Token usage tracking                                          | Yes           | No                            | Not documented                             |
| Gamification (badges)                                         | Yes           | Yes                           | Declarative vs imperative shift            |
| Gamification (store)                                          | Yes           | Yes                           | Effects layer added                        |
| Gamification (XP/levels)                                      | Yes           | Yes                           | Mostly aligned                             |
| Gamification (combos)                                         | Yes           | Yes                           | Purchasable vs built-in shift              |
| Question Lab                                                  | Yes           | Partially (AuditConfig)       | Study adds versioning, FieldDef, SkipRules |

---

_End of report._
