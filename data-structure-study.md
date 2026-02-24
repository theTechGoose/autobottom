# Auto-Bot Data Structure Study

## 1. Core Domain Types (`types/mod.ts`)

```
IQuestionSeed
  └─ IQuestion (extends IQuestionSeed + astResults, resolvedAst, autoYesVal, autoYesMsg)
       └─ IAnsweredQuestion (extends IQuestion + answer, thinking, defense, snippet?)

ILlmQuestionAnswer        { answer, thinking, defense }
IQuestionAstNode           { question, flip }
IAstResults                { ast?, raw?, notResults?, andResults?, orResult? }
FeedbackCardData           { heading, text, viewUrl, recordingUrl?, disputeUrl? }
FindingStatus              union of 10 string literals
JobStatus                  union of 6 string literals
AuditStub                  { auditId, auditRecord }

AuditJob {
  id, doneAuditIds: AuditStub[], status: JobStatus, timestamp,
  owner, updateEndpoint, recordsToAudit: string[]
}

AuditFinding {                          ← PRIMARY AGGREGATE (~30 fields)
  id, auditJobId, findingStatus?, recordingPath?, recordingId?,
  rawTranscript?, fixedTranscript?, diarizedTranscript?,
  unpopulatedQuestions?, populatedQuestions?, answeredQuestions?,
  feedback: FeedbackCardData, job: AuditJob, record: Record<string,any>,
  recordingIdField, owner?, updateEndpoint?, s3RecordingKey?, s3RecordingKeys?,
  qlabConfig?, genieIds?, snipStart?, snipEnd?,
  appealSourceFindingId?, appealType?, appealComment?, reAuditedAt?
}
```

## 2. Auth Types (`auth/kv.ts`)

```
Role                       "admin" | "judge" | "manager" | "reviewer" | "user"
OrgRecord                  { name, slug, createdAt, createdBy }
UserRecord                 { passwordHash, role, supervisor?, createdAt }
AuthContext                { email, orgId, role }
```

## 3. Review Types (`review/kv.ts`)

```
ReviewItem                 { findingId, questionIndex, header, populated, thinking, defense, answer }
ReviewDecision             extends ReviewItem + { decision: "confirm"|"flip", reviewer, decidedAt }
ReviewerLeaderboardEntry   { reviewer, decisions, confirms, flips, flipRate }
ReviewerDashboardData      { queue, personal, byReviewer, recentDecisions }
```

## 4. Judge Types (`judge/kv.ts`)

```
JudgeItem                  { findingId, questionIndex, header, populated, thinking, defense, answer, appealType? }
JudgeDecision              extends JudgeItem + { decision: "uphold"|"overturn", reason?, judge, decidedAt }
AppealRecord               { findingId, appealedAt, status, judgedBy?, auditor?, comment? }
AppealStats                { totalAppeals, overturned, upheld }
AppealHistory              { findingId, auditor, judgedBy, originalScore, finalScore, overturns, timestamp }
```

## 5. Manager Types (`manager/kv.ts`)

```
ManagerQueueItem           { findingId, owner, recordId, recordingId, totalQuestions,
                             failedCount, completedAt, jobTimestamp, status }
ManagerRemediation         { findingId, notes, addressedBy, addressedAt }
RemediationResult          { success, xpGained, level, newBadges }
```

## 6. Agent Types (`agent/kv.ts`)

```
AgentDashboardData {
  email, totalAudits, avgScore,
  recentAudits: Array<{ findingId, recordId, recordingId, totalQuestions,
                         passedCount, failedCount, completedAt, jobTimestamp }>,   ← ANONYMOUS
  weeklyTrend: Array<{ weekStart, audits, avgScore }>                             ← ANONYMOUS
}
```

## 7. Gamification / Badge Types (`shared/badges.ts`)

```
BadgeTier                  "common" | "uncommon" | "rare" | "epic" | "legendary"
BadgeRole                  "reviewer" | "judge" | "manager" | "agent"
BadgeCategory              "milestone" | "speed" | "streak" | "combo" | "level" | "quality" | "special"

BadgeDef                   { id, role, tier, name, description, icon, category, xpReward, check() }
EarnedBadge                { badgeId, earnedAt, earnedValue? }
BadgeCheckState            { totalDecisions, dayStreak, lastActiveDate, bestCombo, level,
                             avgSpeedMs, decisionsForAvg,              ← reviewer only
                             totalOverturns, consecutiveUpholds,       ← judge only
                             totalRemediations, fastRemediations24h,   ← manager only
                             fastRemediations1h, queueCleared, allAgentsAbove80,
                             totalAudits, perfectScoreCount, avgScore, ← agent only
                             auditsForAvg, weeklyImprovement, consecutiveWeeksAbove80 }

GameState                  { totalXp, tokenBalance, level, dayStreak, lastActiveDate,
                             purchases, equippedTitle, equippedTheme, animBindings }
StoreItemType              union of 9 string literals
StoreRarity                "common" | "uncommon" | "rare" | "epic" | "legendary"
StoreItem                  { id, name, description, price, type, icon, rarity, preview? }
PrefabEventDef             { type, label, description, icon, defaultMessage() }
```

## 8. Infrastructure / KV Config Types (`lib/kv.ts`)

```
PipelineConfig             { maxRetries, retryDelaySeconds }
WebhookConfig              { postUrl, postHeaders }
WebhookKind                "terminate" | "appeal" | "manager" | "judge"
ReportSection              "pipeline" | "review" | "appeals" | "manager" | "tokens"
DetailLevel                "low" | "medium" | "high"
SectionConfig              { enabled, detail }
ReportCadence              "daily" | "weekly" | "biweekly" | "monthly"
EmailReportConfig          { id, name, recipients, cadence, cadenceDay?, sections, createdAt, updatedAt }
SoundSlot                  union of 9 string literals
SoundPackId                union of 5 named + open string
SoundPackMeta              { id, name, slots, createdAt, createdBy }
GamificationSettings       { threshold?, comboTimeoutMs?, enabled?, sounds? }
ResolvedGamificationSettings  { threshold, comboTimeoutMs, enabled, sounds }   ← non-nullable mirror
EventType                  union of 5 string literals
AppEvent                   { id, type, payload, createdAt }
BroadcastEvent             { id, type, triggerEmail, displayName, message, animationId, ts }
Message                    { id, from, to, body, ts, read }
```

## 9. Question Lab Types (`question-lab/kv.ts`)

```
QLVersion                  { text, timestamp }
QLConfig                   { id, name, createdAt, questionIds }
QLQuestion                 { id, name, text, configId, autoYesExp, versions, testIds }
QLTest                     { id, questionId, snippet, expected, lastResult, lastAnswer,
                             lastThinking, lastDefense, lastRunAt }
```

## 10. Provider Types (`providers/groq.ts`, `providers/quickbase.ts`)

```
LlmAnswer                 { answer, thinking, defense }             ← DUPLICATE of ILlmQuestionAnswer
QBQueryOptions             { tableId, where, select, sortBy? }      ← local, unexported
```

QuickBase returns are untyped:
- `getQuestionsForDestination` -> `Array<{ header, question, autoYes }>`
- `getDateLegByRid` -> `{ RecordId, VoGenie, RelatedDestinationId }`

---

## 11. Deno KV Key Schema

### Auth namespace (NOT org-scoped)

| Key | Value |
|---|---|
| `["org", orgId]` | `OrgRecord` |
| `["org-by-slug", slug]` | `OrgId` |
| `[orgId, "user", email]` | `UserRecord` |
| `["email-index", email]` | `{ orgId }` |
| `["session", token]` | `{ email, orgId, role, createdAt }` (unnamed) |

### Token usage (NOT org-scoped)

| Key | Value |
|---|---|
| `["token-usage", ts, fn]` | `{ fn, model, prompt_tokens, completion_tokens, total_tokens, ts }` (24h TTL, unnamed) |

### Pipeline data (org-scoped)

| Key | Value |
|---|---|
| `[orgId, "audit-finding", findingId, chunkIndex]` | `string` (chunked) |
| `[orgId, "audit-finding", findingId, "_n"]` | `number` (chunk count) |
| `[orgId, "audit-job", jobId]` | `AuditJob` |
| `[orgId, "question-cache", auditId, hash]` | `{ answer, thinking, defense }` (10min TTL, unnamed) |
| `[orgId, "destination-questions", destId, ...]` | `IQuestionSeed[]` (chunked, 10min TTL) |
| `[orgId, "audit-batches-remaining", findingId]` | `number` |
| `[orgId, "audit-populated-questions", findingId, ...]` | `IQuestion[]` (chunked) |
| `[orgId, "audit-answers", findingId, batchIndex, ...]` | `IAnsweredQuestion[]` (chunked) |
| `[orgId, "audit-transcript", findingId, ...]` | `{ raw, diarized }` (chunked, unnamed) |

### Stats (org-scoped, all unnamed values)

| Key | Value |
|---|---|
| `[orgId, "stats-active", findingId]` | `{ step, ts }` |
| `[orgId, "stats-completed", key]` | `{ findingId, ts }` (24h TTL) |
| `[orgId, "stats-error", key]` | `{ findingId, step, error, ts }` (24h TTL) |
| `[orgId, "stats-retry", key]` | `{ findingId, step, attempt, ts }` (24h TTL) |

### Config (org-scoped)

| Key | Value |
|---|---|
| `[orgId, "pipeline-config"]` | `PipelineConfig` |
| `[orgId, "webhook-settings", kind]` | `WebhookConfig` |
| `[orgId, "email-report-config", id]` | `EmailReportConfig` |
| `[orgId, "sound-pack", packId]` | `SoundPackMeta` |
| `[orgId, "gamification"]` | `GamificationSettings` |
| `[orgId, "gamification", role, email]` | `GamificationSettings` (user override) |
| `[orgId, "store-item", itemId]` | `StoreItem` (custom) |

### Badges / Game (org-scoped)

| Key | Value |
|---|---|
| `[orgId, "badge", email, badgeId]` | `EarnedBadge` |
| `[orgId, "badge-stats", email]` | `BadgeCheckState` |
| `[orgId, "game-state", email]` | `GameState` |

### Events / Messaging (org-scoped)

| Key | Value |
|---|---|
| `[orgId, "event", email, id]` | `AppEvent` (24h TTL) |
| `[orgId, "broadcast", id]` | `BroadcastEvent` (24h TTL) |
| `[orgId, "prefab-subs"]` | `Record<string, boolean>` |
| `[orgId, "message", from, to, id]` | `Message` |
| `[orgId, "message", to, from, id]` | `Message` (mirror) |
| `[orgId, "unread-count", email]` | `number` |

### Review (org-scoped)

| Key | Value |
|---|---|
| `[orgId, "review-pending", findingId, qIdx]` | `ReviewItem` |
| `[orgId, "review-decided", findingId, qIdx]` | `ReviewDecision` |
| `[orgId, "review-lock", findingId, qIdx]` | `{ claimedBy, claimedAt }` (30min TTL, unnamed) |
| `[orgId, "review-audit-pending", findingId]` | `number` |

### Judge (org-scoped)

| Key | Value |
|---|---|
| `[orgId, "judge-pending", findingId, qIdx]` | `JudgeItem` |
| `[orgId, "judge-decided", findingId, qIdx]` | `JudgeDecision` |
| `[orgId, "judge-lock", findingId, qIdx]` | `{ claimedBy, claimedAt }` (30min TTL, unnamed) |
| `[orgId, "judge-audit-pending", findingId]` | `number` |
| `[orgId, "appeal", findingId]` | `AppealRecord` |
| `[orgId, "appeal-stats", email]` | `AppealStats` |
| `[orgId, "appeal-history", findingId]` | `AppealHistory` |

### Manager (org-scoped)

| Key | Value |
|---|---|
| `[orgId, "manager-queue", findingId]` | `ManagerQueueItem` |
| `[orgId, "manager-remediation", findingId]` | `ManagerRemediation` |

### Question Lab (org-scoped)

| Key | Value |
|---|---|
| `[orgId, "qlab", "config-index"]` | `string[]` |
| `[orgId, "qlab", "config", id]` | `QLConfig` |
| `[orgId, "qlab", "question", id]` | `QLQuestion` |
| `[orgId, "qlab", "test", id]` | `QLTest` |

---

## 12. Pipeline Step Payloads (all untyped)

Every step does `const body = await req.json()` with no shared interface.

| Step | Body fields | Response |
|---|---|---|
| `init` | `{ findingId, orgId }` | `{ ok, findingId }` |
| `transcribe` | `{ findingId, orgId }` | `{ ok }` |
| `transcribe-cb` | `{ findingId, orgId }` | `{ ok }` |
| `prepare` | `{ findingId, orgId }` | `{ ok, totalBatches }` |
| `ask-batch` | `{ findingId, orgId, batchIndex, questionIndices, totalBatches }` | `{ ok, batchIndex, answered }` |
| `finalize` | `{ findingId, orgId, totalBatches? }` | `{ ok, yeses, nos }` |
| `cleanup` | `{ findingId, orgId, pineconeNamespace? }` | `{ ok }` |

---

## 13. Identified Problems

### A. Exact Duplicates

| What | Location A | Location B |
|---|---|---|
| `{ answer, thinking, defense }` | `ILlmQuestionAnswer` in `types/mod.ts` | `LlmAnswer` in `providers/groq.ts` |
| `ReviewDecision` | `review/kv.ts` (exported) | `manager/kv.ts` (local unexported copy) |

### B. Near-Duplicates

| What | Diff |
|---|---|
| `ReviewItem` vs `JudgeItem` | Identical 7 fields; `JudgeItem` adds only `appealType?` |
| `ReviewDecision` vs `JudgeDecision` | Differ in decision union, actor field name, and `reason?` |
| `GamificationSettings` vs `ResolvedGamificationSettings` | Nullable vs non-nullable mirror of same 4 fields |

### C. Anonymous / Unnamed Shapes

These shapes exist only as inline object literals, never as named types:

- Session KV value: `{ email, orgId, role, createdAt }`
- Token usage KV value: `{ fn, model, prompt_tokens, completion_tokens, total_tokens, ts }`
- Transcript KV value: `{ raw, diarized }`
- Question cache KV value: `{ answer, thinking, defense }` (same as `ILlmQuestionAnswer`)
- Stats KV values: 4 different shapes for active/completed/error/retry
- Lock KV value: `{ claimedBy, claimedAt }` (used in both review and judge)
- `AgentDashboardData.recentAudits[]` element shape
- `AgentDashboardData.weeklyTrend[]` element shape

### D. Monolithic / God Objects

- **`AuditFinding`** (~30 fields): Acts as the single aggregate for the entire pipeline. Accumulates transcript fields, question arrays, appeal fields, recording metadata, and job references. Every pipeline step reads and writes subsets of this blob.
- **`BadgeCheckState`**: One struct carries stats for all 4 roles. A reviewer instance has 8+ unused agent/judge/manager fields at runtime.

### E. Copy-Pasted Helpers

- `requireAuth()` - identical 3-line function in 5+ handler files
- `json()` response helper - identical definition in `controller.ts`, `steps/finalize.ts`, and multiple handler files

### F. Zero Input Validation

- No Zod, no validation library
- All HTTP bodies parsed as `req.json()` then destructured with manual `if (!field)` checks
- No shared step payload type or validation

### G. ChunkedKv Indirection

`AuditFinding` is too large for a single KV entry, so it's serialized via a custom `ChunkedKv` abstraction that splits JSON across multiple keys with a `_n` count key. This adds complexity to every read/write and makes atomic operations difficult. Several other large values (transcript, questions, answers) also use chunked storage.
