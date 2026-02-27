# Handoff: Expand Rune Markdown + Redesign Question DSL

## Prompt for Next Instance

You are picking up a multi-session project. Your job has two parts:

### Part 1: Redesign V1's Compound Question DSL for V2

V1 had a compound question expression engine in
`providers/question-expr.ts` that let admins write questions like:

```
Did the agent state the resort name? | Did the agent mention rooms?
```

Operators: `|` (OR), `&` (AND), `!` (NOT), `+:` (compound prefix)
Evaluation: OR-of-ANDs boolean logic tree (like CNF/DNF).
Template syntax: `{{fieldId!default}}` for field interpolation.
Triple backtick notes extraction.

V2's AuditQuestion has `questionText` (plain text with
`{{field}}` expression interpolation) and `autoYesExp` (expression
that can auto-resolve to "yes"), but has NO compound question DSL.
V2 needs one. Redesign V1's DSL to fit V2's data model.

Read these files to understand the V1 implementation:
- `/Users/raphaelcastro/Documents/programming/autobottom/providers/question-expr.ts`

Read these files to understand V2's question model:
- `study/specs/audit-template/questions.md`
- `study/specs/expressions.md`
- `study/specs/question-lab.md`

The redesigned DSL should be documented in the rune markdown
section (it's an implementation detail for the audit pipeline).

### Part 2: Expand the Rune Markdown Section

The file `autobottom.rune` has a markdown documentation section
starting at line ~1711 that captures business context, implementation
details, and system behavior. It needs to be expanded to extract
EVERY useful implementation detail from the study specs and V1
codebase before we move on. The user said "pick the bones clean."

**CRITICAL INSTRUCTION: Look extra hard at V1 code for reusable
snippets.** Many V2 systems were redesigned but the core functions
are largely the same. Small snippets of code that define business
logic or domain rules can be adapted to fit V2's data structure.
We want to get MAXIMUM value out of V1. Include code snippets
inline in the markdown (as plain text descriptions since the rune
format doesn't support code blocks -- describe algorithms, formulas,
key logic patterns in prose).

### What to include in the expanded markdown:

New sections and expansions (details in "Sections to Add/Expand"
below). All lines must be <= 80 characters (rune file constraint).
Only modify the markdown section (after the DTO blocks). Do NOT
change any REQ, NON, TYP, or DTO blocks.

After writing, run `rune oracle validate autobottom.rune` to
confirm zero errors.

---

## Current State of autobottom.rune

- 2327 lines total
- Lines 1-753: 65 REQs
- Lines 754-989: 80 NONs
- Lines 990-1365: 187 TYPs
- Lines 1366-1710: 170 DTOs
- Lines 1711-2327: Markdown documentation (16 sections)
- Validates with zero errors, 69 warnings (all "unused" for
  data model entities -- this is expected)

### Current markdown sections (lines 1711-2327):

1. Business Context (1718-1737)
2. Audit Pipeline (1739-1763)
3. Review and Appeals (1765-1783)
4. Provider System (1785-1796)
5. Gamification (1798-1915) -- largest section with 12 subsections
6. Events and Notifications (1917-1995)
7. Reports (1997-2050)
8. Dashboard (2052-2095)
9. Question Lab (2097-2120)
10. Audit Template (2122-2176)
11. Roles and Capabilities (2178-2218)
12. Marketplace (2220-2240)
13. Idempotency (2243-2274)
14. Expression Language (2276-2298)
15. Services (2300-2321)
16. Storage (2323-2327)

---

## V1 vs V2 Boundary (CRITICAL -- read carefully)

V2 redesigned several V1 systems. Only carry V1 material
that fits V2's architecture.

### V2-redesigned (V1 does NOT apply directly):

- **Roles**: V1 hardcodes 5 roles ("admin", "judge",
  "manager", "reviewer", "user"). V2 uses data-driven
  RoleDef with capabilities[] and permissions[]. V1 role
  constants don't port. BUT: default role names, level
  hierarchy, and capability-to-tab mappings DO apply.

- **Badges**: V1 uses function-based `check(stats)` with
  BadgeCheckState. V2 uses declarative BadgeCriteria with
  source/key/operator/value/chain and expression-based
  increments. V1's BadgeCheckState interface is NOT
  applicable. BUT: the badge DEFINITIONS (names,
  descriptions, categories, thresholds) might port.

- **Webhooks/Emails**: V1 has standalone WebhookConfig and
  EmailReportConfig. V2 folds these into EventConfig +
  CommunicationProvider. V1 entities don't exist in V2.
  BUT: the trigger/filter/condition pattern and field
  token interpolation DO apply.

- **Auth**: V1 has simple role string on UserRecord. V2
  has capabilities[], permissions[], team hierarchy, level
  system. BUT: login flow, session TTL, password hashing
  patterns apply.

- **Store item types**: V1 taxonomy (avatar_frame,
  bubble_font, bubble_color) differs from V2 (letter,
  frame, title, email, flair, name_color, font, animation,
  theme). BUT: purchase/equip logic patterns apply.

- **Question parsing**: V1's AST with |, &, !, +: operators
  needs redesign for V2 (Part 1 of this task).

### V1 elements that DO apply to V2:

- Level thresholds: [0, 100, 300, 600, 1000, 1500, 2200,
  3200, 4500, 6500] for reviewer/judge/supervisor.
  Agent: [0, 50, 150, 350, 700, 1200, 2000, 3000, 4500,
  7000]. V2 still computes levels from totalXp.

- Sound system: 9 slots (ping, double, triple, mega, ultra,
  rampage, godlike, levelup, shutdown). 5 built-in packs
  (synth, smite, opengameart, mixkit-punchy, mixkit-epic).
  V2 gamification uses sounds.

- Prefab broadcast events: sale_completed, perfect_score,
  ten_audits_day, level_up, badge_earned, streak_milestone,
  queue_cleared, weekly_accuracy_100.

- ChunkedKV pattern: 64KB Deno KV limit, chunk at 30K chars,
  store count at "_n" key. V2 still uses Deno KV.

- KV key naming CONVENTIONS (rootTeamId-scoping, TTL
  patterns, lock keys with 30-min TTL, index keys).

- Provider external API details AS STARTER TEMPLATES.

- Pinecone chunking: 2000 char max, 200 overlap.

- S3: Native AWS Signature V4, no SDK.

- QStash: POST to step endpoints, Upstash-Retries: 0
  (app manages retries), local mode fallback.

- Token usage tracking: per-function metrics with 24h
  KV expiry.

- Pipeline orchestration: queue-driven fan-out/fan-in
  with atomic counters.

### study/research/ files ARE V2 specs -- 100% applicable

---

## V1 Files Worth Mining for Code Snippets

The user specifically asked to find reusable code. Here are
the V1 files with the most portable business logic:

### providers/question-expr.ts
- `populateQuestions(questions, record, fieldLookup)` --
  template population with `{{id!default}}` syntax
- `parseAst(question)` -- AST parsing for compound questions
- The core algorithm for OR-of-ANDs evaluation
- NEEDS REDESIGN for V2 but core logic patterns apply

### providers/groq.ts
- `askQuestion(question, transcript)` -- QA prompt template
- `generateFeedback(failedQuestions)` -- feedback generation
- `diarize(rawTranscript, maxAttempts)` -- diarization with
  multi-turn QA (manager review + quality checks)
- `parseLlmJson()` -- robust JSON extraction from LLM output
- `summarize(texts)` -- multi-text summarization
- Token tracking to KV per function
- Model: meta-llama/llama-4-maverick-17b-128e-instruct
- System prompts for each function

### providers/assemblyai.ts
- `transcribe(audioBytes, maxAttempts, delayMs)` -- upload +
  poll pattern
- `transcribeWithUtterances()` -- structured result
- `identifyRoles()` -- speaker role identification by
  speaking duration (agent vs customer heuristic)
- Retry with configurable attempts/delay

### providers/pinecone.ts
- Semantic chunking: 2000 char max, 200 char overlap
- OpenAI embeddings (text-embedding-3-small)
- Batch upsert of 100 vectors
- MMR reranking logic
- Query with top-4 + similarity filter
- 20-second index warm-up wait
- Namespace isolation per finding

### providers/genie.ts
- Dual-account fallback strategy
- 1024-byte minimum payload validation
- Exponential backoff retry
- URL construction for search + download

### providers/postmark.ts
- Simple POST: from, to, subject, htmlBody
- Single or multiple recipients

### lib/kv.ts (966 lines -- most portable logic)
- ChunkedKv class (set/get/delete with chunking)
- hashString() -- SHA-256 for cache keys
- setBatchCounter / decrementBatchCounter -- atomic fan-in
- awardXp() -- dual currency update (totalXp + tokenBalance),
  level-up check, streak tracking, event emission
- purchaseStoreItem() -- atomic token deduction
- resolveGamificationSettings() -- 4-layer cascade merge
  (defaults -> org -> judge -> personal)
- sendMessage() -- dual-direction KV storage pattern
- fireWebhook() -- 30s timeout, fire-and-forget
- emitEvent() / emitBroadcastEvent() -- TTL-based events
- checkAndEmitPrefab() -- prefab event matching
- Pipeline stat tracking (trackActive, trackCompleted, etc.)

### lib/s3.ts
- AWS Signature V4 signing (no SDK dependency)
- HMAC-SHA256 utilities
- UNSIGNED-PAYLOAD for GET
- 404 returns null

### lib/queue.ts
- QStash enqueue: POST with Upstash-Retries: 0
- Local mode fallback for dev/testing
- Separate cleanup queue

### lib/org.ts
- orgKey() -- multi-tenancy key prefix function

### types/mod.ts (217 lines)
- FindingStatus enum values
- createFinding() / createJob() factory functions
- normalizeAnswer() -- answer string normalization
- pickRecords() -- batch record selection
- markAuditDone() -- audit completion logic
- answerQuestion() -- question answering helper

### shared/badges.ts
- LEVEL_THRESHOLDS and AGENT_LEVEL_THRESHOLDS arrays
- STORE_CATALOG -- built-in store items (structure/values)
- PREFAB_EVENTS -- built-in broadcast event definitions
- rarityFromPrice() -- rarity tier derivation from price

### auth/kv.ts
- authenticate() -- session validation
- resolveEffectiveAuth() -- auth with impersonation support
- Password hashing (SHA-256)

---

## Sections to Add or Expand in Markdown

### NEW: Report Builder UI
Source: study/research/reports.md
Content: Reports Panel layout (Recents left + Folders right
with counts), Create Report Dialog (name + folder dropdown +
5 type cards in grid), Report View page structure (action
bar with CSV/Print/Edit/More, filter summary bar with
clickable popover, data grid with sortable column headers),
Column Picker (dual-list: Available searchable on left,
Report Columns with reorder on right, arrow buttons to
add/remove, up/down to reorder), Column Menu items
(Sort A-Z, Sort Z-A, Group A-Z, Group Z-A, Hide column,
Show more columns, Column properties), Report Customization
Page (Basics: type/name/description/folder/showDescription;
Columns: default vs custom with dual-list picker; Filters:
initial show-all vs filter-findings with condition builder
+ dynamic filters custom/none/quickSearch; Sorting &
Grouping: group display collapsed/expanded + multi-level
sort rows with direction dropdown; Options: row height
relaxed/normal/condensed, column header truncate/wrap,
hide totals checkbox, row actions checkbox, disable bulk
delete checkbox, editing behavior inline/no-inline; Color-
Coding: none/field-choices/formula with pale/full
appearance), More Actions menu (save/save-as/revert,
fullscreen, email/copy-link, find-replace/delete-findings,
row spacing radio), URL structure /org/{id}/reports/{id}.

### NEW: Notification Configuration
Source: study/research/emails.md + webhooks.md
Content: Shared trigger model (When event + AND field filter
+ AND condition filter + Then action). Three recipient
modes: static email list, conditional per-user (send when
user email appears in field), dynamic from-field (send to
email in field). Single vs multiple record templates.
Rich HTML email with [Field Name] token interpolation.
Field token syntax: [Field Name] resolves to record value.
Subject and body both support tokens. Relative date
conditions: the date (absolute), day(s) in the past,
yesterday, today, tomorrow, day(s) from now, the
previous/current/next day/week/month/quarter/fiscal-
quarter. Value sources: literal value vs cross-field
comparison ("the value in the field"). From address: system
address, app manager, dynamic from user field. Operations
filter: single records only, multiple records only, either.
Blank field handling: insert "empty" or leave blank.
Scheduled sending cadence: daily (time), weekly (day +
time), monthly (day of month + time), yearly (month +
time). Report embedding: inline rendered report in email
body. LLM interpolation: llm(prompt, ...context) calls LLM
at send time for dynamic content. Webhook HTTP action:
endpoint URL, method (POST/GET/PUT/PATCH/DELETE), format
(JSON/XML/RAW), headers, body with field tokens. Error
history for debugging. Owner-based permissions.

### NEW: Provider Starter Templates
Source: V1 providers/*.ts + study/specs/provider.md
Content: For each built-in provider adapter, document the
external API configuration shape that becomes a default
ProviderConfig record. These are starter templates users
get out of the box:
- recordings/genie: base URL, auth header, primary/secondary
  account keys, min payload bytes (1024), retry config
- transcription/assemblyai: API key header, upload endpoint,
  poll endpoint, max attempts, delay between polls
- audit-questions/groq: API key, model name, system prompt
  templates (QA, diarization, feedback), JSON response
  format, token tracking
- embeddings/openai: API key, model (text-embedding-3-small)
- vector-store/pinecone: API key, index name, chunk size
  (2000), overlap (200), batch size (100), warm-up wait (20s)
- email/postmark: server token, from address
- queue/qstash: URL, token, retry policy (0 retries, app
  manages), local mode URL for testing
- storage/s3: access key, secret key, region, bucket name

### NEW: Compound Question DSL (redesigned for V2)
Source: V1 providers/question-expr.ts + V2 specs
Content: The redesigned DSL that replaces V1's AST parsing.
This section captures the design decisions and behavior.
(You will design this as Part 1 of the task.)

### EXPAND: Reports
Add: 13 chart sub-types (bar, stacked-bar, horizontal-bar,
horizontal-stacked-bar, line, line-bar, area, pie, funnel,
scatter, bubble, waterfall, solid-gauge). Additional
grouping methods: first-letter, first-word, fiscal-quarter,
fiscal-year, decade, numeric ranges (.001 through 1000000).
Summary properties: SummarizeItem (type: field-value |
number-of-records | summary-formula, aggregation, showAs:
value/% of column total/% of crosstab total/running column
total/running crosstab total), SummaryVariable (fieldId +
label + aggregation), SummaryFormula (formula referencing
variables by label), crosstabs (rowField + columnField +
valueField + formula). Aggregation enum: AVG, SUM, MAX,
MIN, STD-DEV, COUNT, DISTINCT-COUNT. ReportOptions expanded
fields: dynamicFilterMode, quickSearchEnabled, colorMethod
(none/field_choices/formula), colorField, colorFormula,
colorAppearance (pale/full), hideTotals, showViewIcon,
disableBulkDelete, editingBehavior, showDescription,
columnHeaderText (truncate/wrap). ColumnProperty:
fieldId + labelOverride. FieldType enum for formula results:
rich-text, text, numeric, currency, percent, rating, date,
timestamp, timeofday, duration, checkbox, phone, email,
user, multiuser, url. Report Folder: id, name, orgId,
createdBy, isDefault. Folder deletion moves reports to
General. Reports sorted alphabetically within folder.
Drag-and-drop between folders.

### EXPAND: Dashboard
Add: Sidebar CSS (position fixed, 3-4px width, box-shadow
0 0 8px 1px var(--accent) glow, 200ms ease-out width
transition, ~240px expanded, z-index above content below
modals, overlays content no layout shift). KV keys:
[rootTeamId, "dashboard", "default", role] for system
default, [rootTeamId, "dashboard", dashboardId] for user
dashboards, [rootTeamId, "dashboard-active", userId] for
active selection, [rootTeamId, "dashboard-index", userId]
for dashboard ID list. Widget configs per type:
ReportWidgetConfig (reportId, height), TextWidgetConfig
(markdown content), ButtonBarWidgetConfig (buttons[] with
label + action + variant, ButtonAction union: navigate/
create-instance/external), LinkBarWidgetConfig (links[]
with label + target, LinkTarget union: internal/report/
external), SearchWidgetConfig (entity: instance/config/
user/team, fields[] with key/label/helpText, exactMatch),
ReportsListWidgetConfig (folderId, tags, maxItems),
EmbedWidgetConfig (url, height, sandbox). 2-column grid
with span 1 or 2. Edit mode: pencil icon toggle, page
name input, 7 draggable widget type buttons in toolbar,
per-widget overlay with edit/delete/drag-handle, config
dialog per type, save/cancel. Default widgets per role
from V2 spec: admin (system stats + team overview + user
management), judge (pending reviews + recent decisions +
quick search), analyst (my queue + audit stats + start
audit), supervisor (team performance + remediation queue +
escalations), agent (my audits + quick actions +
announcements). Copy-on-write: clone default, set ownerId,
save new, set as active.

### EXPAND: Gamification
Add: Level thresholds [0, 100, 300, 600, 1000, 1500, 2200,
3200, 4500, 6500] for reviewer/judge/supervisor.
Agent thresholds [0, 50, 150, 350, 700, 1200, 2000, 3000,
4500, 7000]. Sound system: 9 slots (ping, double, triple,
mega, ultra, rampage, godlike, levelup, shutdown). 5
built-in packs (synth, smite, opengameart, mixkit-punchy,
mixkit-epic). SoundPackMeta has id, name, slots (partial
record of slot to URL). GamificationSettings cascade:
platform defaults -> org root team -> child team ->
personal overrides. Personal override fields: threshold,
comboTimeoutMs, enabled, sounds. XP award logic from V1:
add amount to both totalXp and tokenBalance, check if
totalXp crosses next threshold, if so increment level
and fire player.levelUp, update dayStreak (check if
lastActiveDate is yesterday: increment, is today: skip,
else: reset to 1 and fire player.streakBroken). Purchase
logic: atomic token deduction from tokenBalance, add
item ID to inventory, fire store.itemPurchased.

### EXPAND: Provider System
Add: External API integration patterns from V1. Genie:
REST API, dual-account failover (if primary returns error
or <1024 bytes, try secondary), exponential backoff.
AssemblyAI: 3-phase (upload audio bytes -> submit job ->
poll until complete), configurable maxAttempts/delayMs,
returns text + speaker-labeled utterances. Speaker role
identification: longest-speaking channel = agent heuristic.
Groq: JSON response format with system/user messages,
parseLlmJson() extracts JSON from freeform LLM output,
separate system prompts for QA/diarization/feedback.
Diarization uses multi-turn: initial labeling -> manager
review pass -> QA check pass. Token usage tracked per
function to KV with 24h expiry for metering. Pinecone:
semantic chunking (2000 max / 200 overlap), OpenAI
text-embedding-3-small for embeddings, batch upsert 100
vectors, MMR reranking, namespace-per-audit isolation,
cleanup deletes namespace after 24h. S3: native AWS
Signature V4 signing with crypto.subtle HMAC-SHA256, no
SDK dependency. QStash: Upstash-Retries: 0, app owns
retry logic, local mode fallback for dev.

### EXPAND: Audit Pipeline
Add: Step sequence from V1: init (download recording from
provider to S3) -> transcribe (S3 audio to AssemblyAI) ->
transcribe-complete (Groq diarization with speaker
labeling) -> prepare (fetch questions, populate with field
values, embed transcript in Pinecone, set up fan-out
batches with atomic counter) -> ask-batch (RAG vector
query per question + Groq LLM answer, atomic decrement
counter, when zero trigger finalize) -> finalize (collect
all batch answers, aggregate, generate feedback, populate
review/judge queue, post webhooks, award XP, emit events)
-> cleanup (delete Pinecone namespace after 24h delay).
Post-audit branches: perfect score -> terminate webhook
(done). Has "No" answers -> Review Queue -> reviewer
decides -> consolidate -> Manager Queue. Agent files
appeal -> Judge Queue -> judge decides -> Manager Queue.
Retry: maxRetries 5, retryDelaySeconds 10, recording
failure -> terminal no-recording state, LLM errors
re-enqueued with backoff.

### EXPAND: Storage
Add: ChunkedKV: 64KB Deno KV value limit workaround.
Serialize to JSON string, if >30K chars split into chunks.
Store each chunk at [...prefix, chunkIndex]. Store chunk
count at [...prefix, "_n"]. Read: get count, fetch all
chunks, join, parse. Delete: get count, delete all chunks
+ count key. Atomic fan-in: setBatchCounter(key, count)
initializes counter. decrementBatchCounter(key) does
atomic decrement, returns new value. At zero, next step
auto-triggered. KV key conventions: all entity keys
prefixed with rootTeamId for multi-tenancy. Lock keys
use 30-min TTL (CAS for claim locks). Event keys use
24h TTL. Session keys use 24h TTL. Cache keys use
10-min TTL. Key pattern examples: [rootTeamId, "user",
email], [rootTeamId, "session", token], [rootTeamId,
"event", targetEmail, eventId], [rootTeamId, "review-
lock", findingId, qIdx].

### EXPAND: Expression Language
Add: Context per use-site: email/webhook/chat gets event,
currentUser, record, field values. Badge increment gets
fields.*, result. Skip rules get fields.*. Function list:
data fetchers (audits(user), appeals(user), scores(user,
configId)), transformers (extractFailedQuestions(audits,
limit), average(), count(), latest()), AI (llm(prompt,
...context)), helpers (string/math/date utilities). Badge
increment examples: default "1" (count events), custom
"fields.wgsRevenue" (accumulate revenue). Skip rule
examples: {{fields.callType}} === 'inbound',
{{fields.department}} === 'sales' AND
{{fields.wgsRevenue}} > 0.

### Sections kept as-is (light edits only):
Business Context, Review and Appeals, Events and
Notifications, Question Lab, Audit Template, Roles and
Capabilities, Marketplace, Idempotency, Services.

---

## File to Modify

`/Users/raphaelcastro/Documents/programming/autobottom/autobottom.rune`
- Only the markdown section (lines 1711+)
- Do NOT change REQ/NON/TYP/DTO blocks

## Verification

1. `rune oracle validate autobottom.rune` -- zero errors
2. All lines <= 80 characters
3. REQ/NON/TYP/DTO blocks unchanged

---

## Rune Validator Gotchas (from memory)

| Element | Multiline? | Notes |
|---------|-----------|-------|
| REQ headers | YES | continuation at 4-space indent |
| Steps | NO | return type on continuation line not parsed |
| TYP definitions | NO | union values on continuation line not parsed |
| DTO property lists | NO | properties on continuation line not parsed |
| NON descriptions | YES | standard 4-space continuation |

The validator enforces that every `noun::verb` or `noun.verb`
call across ALL REQs must have the same parameter type names
and return type. If you need different param types, use unique
verb names.

Scope rules:
1. Input DTO properties enter scope at REQ start
2. Each step's return value enters scope
3. Returned DTO's properties ALSO expand into scope
4. [NEW] puts a noun instance in scope
5. [PLY] output enters scope; cases run at 8-space indent

Fitting in 80 characters:
- Abbreviate long noun names (auditInstance -> inst)
- Bundle multiple params into a DTO
- Use short verb names
- Event emissions are side effects (waitUntil) -- don't model
  as steps, document in markdown
