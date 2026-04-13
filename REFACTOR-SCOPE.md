# Autobottom Danet Backend Refactor — Complete Scope Reference

> This file is the master reference for the full backend refactor. It survives context
> compaction and should be re-read at the start of each session. It documents every route,
> function, provider, and module that must be ported to the new danet architecture.

## Branch: `refactor/danet-backend`

## Completed Phases
- **Phase 0**: Scaffold (14 modules, bootstrap/mod.ts, Swagger UI) — `8c4dd7c`
- **Phase 1**: Core infra (KvRepository, auth, S3, QStash, DTOs, 23 tests) — `cbc74a3`
- **Phase 2a**: Scoring engine + chargeback classification (32 tests) — `4693f3c`
- **Phase 2b**: QuickBase, Postmark, Google Sheets adapters — `2c100a6`
- **Phase 2c**: AssemblyAI, Groq, Pinecone adapters (8 tests) — `bf8b5d1`
- **Phase 2d**: AuditController + StepController (16 endpoints) — `1bd704d`
- **Phase 3**: Review + Judge + Manager controllers (39 endpoints, 6 tests) — `65e9c36`
- **Phase 4**: Reporting + Admin controllers (80+ endpoints, 8 tests) — `73ef75c`
- **Phase 5**: Question Lab, Gamification, Agent, Chat, Events, Weekly Builder, Auth (54 endpoints) — `1bce4e0`
- **Phase 6**: Cron jobs — watchdog + weekly sheets (7 tests) — `866335c`
- **Phase 8a**: Audit repository — findings, jobs, batches, transcripts, cache, dedup (13 tests) — `ceeb197`
- **Phase 8b**: Stats repository — tracking, index, chargebacks, wire (7 tests) — `43e11bd`
- **Phase 8c**: Config repository — pipeline, webhooks, bypass, bonus, dimensions (12 tests) — `d667eb4`

## Current State: 148 tests passing, 21 commits, ~200 endpoints registered, controllers wired to real repos

## Completed Since Last Update
- **Phase 8d-8f**: Email, gamification, events, chat repos (20 tests) — `0385fcd`
- **Phase 8g**: Judge, manager, question-lab repos (12 tests) — `ca24e87`
- **Phase 9a**: Wire admin + reporting controllers — `bde03cb`
- **Phase 9c**: Wire review/judge/manager controllers — `288d978`
- **Phase 9d**: Wire remaining controllers (qlab, gamification, agent, chat, events, weekly) — `aa255cd`
- **Phase 10**: Swagger limitation documented, generic DTOs added — `ea6b3b2`

## Remaining Work (follow-up sessions)

### Swagger Fix
@danet/swagger crashes on async controller methods (Reflect.construct(Promise)).
Options: fix upstream package, add @ReturnType decorators, or use sync wrappers.

### Pipeline Step Implementations (Phase 9b)
Port steps/*.ts logic into business features under src/audit/domain/business/pipeline-orchestrator/.
Also port: genie.ts (downloadRecording), bad-word.ts, question-expr.ts.

### Auth Context Injection
Controllers use hardcoded ORG="default". Need proper auth middleware that extracts
orgId from session cookie and injects into controller methods.

### Shape-checker Violations
301 violations total — mostly from legacy root-level files (old monolith code).
When legacy files are deleted, only empty placeholder directories under src/ remain.
Add mod.ts files to empty business feature dirs or remove them.

### Previously listed remaining work (now completed):
~~Phase 8d: Email/Template Repository~~ DONE
Port from lib/kv.ts: listEmailReportConfigs, getEmailReportConfig, saveEmailReportConfig, deleteEmailReportConfig, listEmailTemplates, getEmailTemplate, saveEmailTemplate, deleteEmailTemplate, getEmailReportPreview, saveEmailReportPreview, deleteEmailReportPreview, getReportLastFired, setReportLastFired
→ src/reporting/domain/data/email-repository/

### Phase 8e: Gamification Repository
Port from lib/kv.ts: listSoundPacks, getSoundPack, saveSoundPack, deleteSoundPack, getGamificationSettings, saveGamificationSettings, resolveGamificationSettings, get/saveJudgeGamificationOverride, get/saveReviewerGamificationOverride, listCustomStoreItems, saveCustomStoreItem, deleteCustomStoreItem, getEarnedBadges, awardBadge, hasBadge, getBadgeStats, updateBadgeStats, getGameState, saveGameState, awardXp, purchaseStoreItem
→ src/gamification/domain/data/gamification-repository/

### Phase 8f: Events/Chat Repository
Port from lib/kv.ts: emitEvent, getEvents, deleteEvents, emitBroadcastEvent, getBroadcastEvents, checkAndEmitPrefab, getPrefabSubscriptions, savePrefabSubscriptions, sendMessage, getConversation, getUnreadCount, markConversationRead, getConversationList
→ src/events/domain/data/ + src/chat/domain/data/chat-repository/

### Phase 8g: Review/Judge/Manager/Question Lab Repositories
Port review/kv.ts remaining: claimNextItem (full FIFO with sweep), undoDecision, listReviewQueueFindings, adminFlipFinding, getReviewerDashboardData, backfillFromFinished, previewFinding
Port judge/kv.ts: populateJudgeQueue, claimNextItem, recordDecision, undoDecision, getJudgeStats, getAppealStats, getJudgeDashboardData, dismissFindingFromJudgeQueue, clearJudgeQueue, getAppeal, saveAppeal, backfillChargebackEntries, pruneBypassedFromQueues, findDuplicates, deleteDuplicates, cleanupFindingFromIndices, adminDeleteFinding
Port manager/kv.ts: populateManagerQueue, getManagerQueue, getManagerFindingDetail, submitRemediation, getManagerStats, backfillManagerQueue
Port question-lab/kv.ts (24 functions): all config/question/test/assignment CRUD

### Phase 9: Wire Controllers to Real Services
Update all ~191 stub controller methods to call the real repository/service functions.
9a: Admin controllers (51 methods)
9b: Pipeline steps (12 methods — port steps/*.ts as business features)
9c: Review/Judge/Manager controllers
9d: All remaining controllers

### Phase 10: Zod DTOs + Swagger Re-enablement
Create typed Zod schemas in each module's dto/ folder, replace Record<string, any> in controllers, re-enable swagger: true in bootstrap/mod.ts.

### Phase 11: Shape-checker + Final Verification
Run shape-checker, fix violations. Full test suite. Cross-reference every route against this doc.

## Target Architecture
- Framework: `@mrg-keystone/danet` (NestJS-like for Deno)
- Shape-checker compliant: `src/<module>/mod-root.ts, domain/business/, domain/data/, dto/, entrypoints/`
- No frontend — pure JSON API + Swagger UI at `/docs`
- Repository pattern over Deno KV (swappable)
- Full test coverage (test.ts for business, smk.test.ts for data adapters)

---

## ROUTES TO PORT (205 total)

### POST Routes (106)

**Pipeline Steps (12):**
POST /audit/step/init → stepInit (steps/init.ts)
POST /audit/step/transcribe → stepTranscribe (steps/transcribe.ts)
POST /audit/step/poll-transcript → stepPollTranscript (steps/poll-transcript.ts)
POST /audit/step/transcribe-complete → stepTranscribeCb (steps/transcribe-cb.ts)
POST /audit/step/diarize-async → stepDiarizeAsync (steps/diarize-async.ts)
POST /audit/step/pinecone-async → stepPineconeAsync (steps/pinecone-async.ts)
POST /audit/step/prepare → stepPrepare (steps/prepare.ts)
POST /audit/step/ask-batch → stepAskBatch (steps/ask-batch.ts)
POST /audit/step/ask-all → stepAskAll (steps/ask-all.ts)
POST /audit/step/finalize → stepFinalize (steps/finalize.ts)
POST /audit/step/cleanup → stepCleanup (steps/cleanup.ts)
POST /audit/step/bad-word-check → stepBadWordCheck (steps/bad-word-check.ts)

**Audit API (2):**
POST /audit/test-by-rid → handleAuditByRid (controller.ts)
POST /audit/package-by-rid → handlePackageByRid (controller.ts)

**Appeal (4):**
POST /audit/appeal → handleFileAppeal (controller.ts)
POST /audit/appeal/different-recording → handleAppealDifferentRecording (controller.ts)
POST /audit/appeal/upload-recording → handleAppealUploadRecording (controller.ts)
POST /audit/send-reaudit-receipt → handleSendReauditReceipt (controller.ts)

**Auth (3):**
POST /register → handleRegisterPost (main.ts)
POST /login → handleLoginPost (main.ts)
POST /logout → handleLogoutPost (main.ts)

**Review API (5):**
POST /review/api/decide → handleDecide (review/handlers.ts)
POST /review/api/back → handleBack (review/handlers.ts)
POST /review/api/settings → handleSaveSettings (review/handlers.ts)
POST /review/api/backfill → handleBackfill (review/handlers.ts)
POST /review/api/gamification → handleReviewerSaveGamification (main.ts)

**Judge API (8):**
POST /judge/api/decide → handleJudgeDecide (judge/handlers.ts)
POST /judge/api/back → handleJudgeBack (judge/handlers.ts)
POST /judge/api/reviewers → handleJudgeCreateReviewer (judge/handlers.ts)
POST /judge/api/reviewers/delete → handleJudgeDeleteReviewer (judge/handlers.ts)
POST /judge/api/reviewer-config → handleJudgeSaveReviewerConfig (judge/handlers.ts)
POST /judge/api/dismiss-finding → handleJudgeDismissFinding (judge/handlers.ts)
POST /judge/api/dismiss-appeal → handleDismissAppeal (judge/handlers.ts)
POST /judge/api/gamification → handleJudgeSaveGamification (main.ts)

**Manager API (5):**
POST /manager/api/remediate → handleManagerRemediate (manager/handlers.ts)
POST /manager/api/backfill → handleManagerBackfill (manager/handlers.ts)
POST /manager/api/agents → handleManagerCreateAgent (manager/handlers.ts)
POST /manager/api/agents/delete → handleManagerDeleteAgent (manager/handlers.ts)
POST /manager/api/prefab-subscriptions → handleSavePrefabSubscriptions (main.ts)

**Admin Config (30+):**
POST /admin/pipeline-config → handleSetPipelineConfig
POST /admin/settings/{kind} → handleAdminSaveSettings (7 kinds: terminate, appeal, manager, review, judge, judge-finish, re-audit-receipt)
POST /admin/users → handleAdminAddUser
POST /admin/users/delete → handleAdminDeleteUser
POST /admin/parallelism → handleSetParallelism
POST /admin/email-reports → handleSaveEmailReport
POST /admin/email-reports/delete → handleDeleteEmailReport
POST /admin/email-reports/preview → handlePreviewEmailReport
POST /admin/email-reports/preview-inline → handlePreviewInlineEmailReport
POST /admin/email-reports/send-now → handleSendNowEmailReport
POST /admin/email-templates → handleSaveEmailTemplate
POST /admin/email-templates/delete → handleDeleteEmailTemplate
POST /admin/bad-word-config → handleSaveBadWordConfig
POST /admin/bonus-points-config → handleSaveBonusPointsConfig
POST /admin/office-bypass → handleSaveOfficeBypass
POST /admin/manager-scopes → handleSaveManagerScope
POST /admin/audit-dimensions → handleSaveAuditDimensions
POST /admin/post-to-sheet → handlePostToSheet
POST /admin/purge-old-audits → handlePurgeOldAudits
POST /admin/purge-bypassed-wire-deductions → handlePurgeBypassedWireDeductions
POST /admin/backfill-review-scores → handleBackfillReviewScores
POST /admin/backfill-chargeback-entries → handleBackfillChargebackEntries
POST /admin/backfill-partner-dimensions → handleBackfillPartnerDimensions
POST /admin/backfill-audit-index → handleBackfillAuditIndex
POST /admin/backfill-stale-scores → handleBackfillStaleScores
POST /admin/deduplicate-findings → handleDeduplicateFindings
POST /admin/reset-finding → handleResetFinding
POST /admin/flip-answer → handleAdminFlipAnswer
POST /admin/bulk-flip → handleBulkFlip
POST /admin/settings/gamification → handleAdminSaveGamification

**Admin Operations (8):**
POST /admin/wipe-kv → handleWipeKv
POST /admin/force-nos → handleForceNos
POST /admin/seed → handleSeed
POST /admin/init-org → handleInitOrg
POST /admin/retry-finding → handleRetryFinding
POST /admin/terminate-finding → handleTerminateFinding
POST /admin/terminate-all → handleTerminateAll
POST /admin/clear-errors → handleClearErrors

**Gamification (5):**
POST /gamification/api/pack → handleSavePack
POST /gamification/api/pack/delete → handleDeletePack
POST /gamification/api/upload-sound → handleUploadSound
POST /gamification/api/seed → handleSeedSoundPacks
POST /gamification/api/settings → handleGamificationPageSaveSettings

**Badge Editor (2):**
POST /admin/badge-editor/item → handleBadgeEditorSave
POST /admin/badge-editor/item/delete → handleBadgeEditorDelete

**Store (3):**
POST /api/store/buy → handleAgentStoreBuy
POST /api/equip → handleEquip
POST /agent/api/store/buy → handleAgentStoreBuy

**Messaging (1):**
POST /api/messages → handleSendMessage

**Question Lab (1):**
POST /api/qlab-assignments → handleQlabAssignments

**Weekly Builder (2):**
POST /admin/weekly-builder/test-send → handleWeeklyBuilderTestSend
POST /admin/weekly-builder/publish → handleWeeklyBuilderPublish

**Webhooks (4):**
POST /webhooks/audit-complete → handleAuditCompleteWebhook
POST /webhooks/appeal-filed → handleAppealFiledWebhook
POST /webhooks/appeal-decided → handleAppealDecidedWebhook
POST /webhooks/manager-review → handleManagerReviewWebhook

### GET Routes (99)

**Audit (6):**
GET /audit/finding → handleGetFinding
GET /audit/report → handleGetReport
GET /audit/stats → handleGetStats
GET /audit/recording → handleGetRecording
GET /audit/appeal/status → handleAppealStatus
GET /audit/report-sse → handleReportSSE

**Review (10):**
GET /review/api/next → handleNext
GET /review/api/settings → handleGetSettings
GET /review/api/stats → handleStats
GET /review/api/me → handleReviewMe
GET /review/api/preview → handlePreviewFinding
GET /review/api/dashboard → handleReviewDashboardData
GET /review/api/gamification → handleReviewerGetGamification

**Judge (9):**
GET /judge/api/next → handleJudgeNext
GET /judge/api/stats → handleJudgeStats
GET /judge/api/me → handleJudgeMe
GET /judge/api/reviewers → handleJudgeListReviewers
GET /judge/api/reviewer-config → handleJudgeGetReviewerConfig
GET /judge/api/dashboard → handleJudgeDashboardData
GET /judge/api/gamification → handleJudgeGetGamification

**Manager (10):**
GET /manager/api/queue → handleManagerQueueList
GET /manager/api/finding → handleManagerFinding
GET /manager/api/stats → handleManagerStatsFetch
GET /manager/api/me → handleManagerMe
GET /manager/api/game-state → handleManagerGameState
GET /manager/api/agents → handleManagerListAgents
GET /manager/audits/data → handleManagerAuditsData
GET /manager/api/prefab-subscriptions → handleGetPrefabSubscriptions

**Agent (5):**
GET /agent/api/dashboard → handleAgentDashboardData
GET /agent/api/me → handleAgentMe
GET /agent/api/game-state → handleAgentGameState
GET /agent/api/store → handleAgentStore

**Admin Config (20+):**
GET /admin/pipeline-config → handleGetPipelineConfig
GET /admin/settings/{kind} → handleAdminGetSettings
GET /admin/parallelism → handleGetParallelism
GET /admin/users → handleAdminListUsers
GET /admin/email-reports → handleListEmailReports
GET /admin/email-reports/preview-view → handlePreviewViewEmailReport
GET /admin/email-templates → handleListEmailTemplates
GET /admin/email-templates/get → handleGetEmailTemplate
GET /admin/bad-word-config → handleGetBadWordConfig
GET /admin/bonus-points-config → handleGetBonusPointsConfig
GET /admin/office-bypass → handleGetOfficeBypass
GET /admin/manager-scopes → handleGetManagerScopes
GET /admin/audit-dimensions → handleGetAuditDimensions
GET /admin/partner-dimensions → handleGetPartnerDimensions
GET /admin/chargebacks → handleGetChargebacks
GET /admin/wire-deductions → handleGetWireDeductions
GET /admin/trigger-weekly-sheets → handleTriggerWeeklySheets
GET /admin/unreviewed-audits → handleGetUnreviewedAudits
GET /admin/queues → handleGetQueues
GET /admin/token-usage → handleTokenUsage

**Admin Dashboard (8):**
GET /admin/dashboard/data → handleDashboardData
GET /admin/dashboard/section → handleDashboardSection
GET /admin/audits/data → handleAuditsData
GET /admin/review-queue/data → handleReviewQueueData
GET /admin/delete-finding → handleDeleteFinding
GET /admin/audits-by-record → handleAuditsByRecord
GET /admin/api/me → handleAdminMe
GET /admin/retry-finding → handleRetryFinding (GET variant)

**Gamification (2):**
GET /gamification/api/packs → handleListPacks
GET /gamification/api/settings → handleGamificationPageGetSettings

**Badge Editor (1):**
GET /admin/badge-editor/items → handleBadgeEditorItems

**Events/Messages (4):**
GET /api/events → handleSSE
GET /api/messages/unread → handleGetUnread
GET /api/messages/conversations → handleGetConversations
GET /api/users → handleGetOrgUsers

**Weekly Builder (1):**
GET /admin/weekly-builder/data → handleWeeklyBuilderGetData

**Question Lab (1):**
GET /api/qlab-assignments → handleQlabAssignments (GET)

**Auth (2):**
GET /register → getRegisterPage
GET /login → getLoginPage

**Store/Chat (4):**
GET /store → handleStorePage
GET /chat → handleChatPage
GET /chat/api/me → handleChatMe
GET /chat/api/cosmetics → handleChatCosmetics

---

## DATA LAYER FUNCTIONS TO PORT

### lib/kv.ts (~180 functions)
Finding CRUD: getFinding, saveFinding
Dedup: claimAuditDedup
Job CRUD: getJob, saveJob
Question cache: getCachedAnswer, cacheAnswer, getCachedQuestions, cacheQuestions
Batch: setBatchCounter, decrementBatchCounter, savePopulatedQuestions, getPopulatedQuestions, saveBatchAnswers, getAllBatchAnswers, getAllAnswersForFinding
Stats: getRecentCompleted, getAllCompleted, trackActive, trackCompleted, updateCompletedStatScore, deleteCompletedStat, getStuckFindings, terminateAllActive, terminateFinding, trackError, clearErrors, trackRetry, getStats
Chargebacks: saveChargebackEntry, deleteChargebackEntry, getChargebackEntries, getChargebackEntry
Wire: saveWireDeductionEntry, deleteWireDeductionEntry, getWireDeductionEntries, getWireDeductionEntry, purgeBypassedWireDeductions
Transcripts: saveTranscript, getTranscript, backfillUtteranceTimes
Config: getPipelineConfig, setPipelineConfig, getWebhookConfig, saveWebhookConfig, fireWebhook, registerWebhookEmailHandler
Email: listEmailReportConfigs, getEmailReportConfig, saveEmailReportConfig, deleteEmailReportConfig, getEmailReportPreview, saveEmailReportPreview, deleteEmailReportPreview, listEmailTemplates, getEmailTemplate, saveEmailTemplate, deleteEmailTemplate
Index: writeAuditDoneIndex, findAuditsByRecordId, queryAuditDoneIndex, backfillAuditDoneIndex, backfillStaleScores
Bad words: getBadWordConfig, saveBadWordConfig
Bypass: getOfficeBypassConfig, saveOfficeBypassConfig
Manager: getManagerScope, saveManagerScope, listManagerScopes
Dimensions: getAuditDimensions, saveAuditDimensions, updateAuditDimensions, getPartnerDimensions, updatePartnerDimensions, backfillPartnerDimensions
Bonus: getBonusPointsConfig, saveBonusPointsConfig
Reviewer: getReviewerConfig, saveReviewerConfig
Sound: listSoundPacks, getSoundPack, saveSoundPack, deleteSoundPack
Gamification: getGamificationSettings, saveGamificationSettings, resolveGamificationSettings, get/saveJudgeGamificationOverride, get/saveReviewerGamificationOverride
Store: listCustomStoreItems, saveCustomStoreItem, deleteCustomStoreItem
Badges: getEarnedBadges, awardBadge, hasBadge, getBadgeStats, updateBadgeStats
Game: getGameState, saveGameState, awardXp, purchaseStoreItem
Events: emitEvent, getEvents, deleteEvents, emitBroadcastEvent, getBroadcastEvents, checkAndEmitPrefab, getPrefabSubscriptions, savePrefabSubscriptions
Messages: sendMessage, getConversation, getUnreadCount, markConversationRead, getConversationList
Reports: getReportLastFired, setReportLastFired
Purge: purgeOldEntries, purgeBypassedAuditHistory, backfillReviewScores

### review/kv.ts (12 functions)
populateReviewQueue, claimNextItem, recordDecision, undoDecision, getReviewStats, listReviewQueueFindings, adminFlipFinding, getReviewerDashboardData, getReviewedFindingIds, clearReviewQueue, backfillFromFinished, previewFinding

### judge/kv.ts (15 functions)
populateJudgeQueue, claimNextItem, recordDecision, undoDecision, getJudgeStats, getAppealStats, getJudgeDashboardData, dismissFindingFromJudgeQueue, clearJudgeQueue, getAppeal, saveAppeal, deleteAppeal, backfillChargebackEntries, pruneBypassedFromQueues, findDuplicates, deleteDuplicates, cleanupFindingFromIndices, adminDeleteFinding

### manager/kv.ts (6 functions)
populateManagerQueue, getManagerQueue, getManagerFindingDetail, submitRemediation, getManagerStats, backfillManagerQueue

### question-lab/kv.ts (24 functions)
listConfigs, getConfig, createConfig, updateConfig, deleteConfig, bulkDeleteConfig, listConfigNames, bulkImportConfig, getQuestion, getQuestionsForConfig, getAllQuestionNames, bulkSetEgregious, createQuestion, updateQuestion, deleteQuestion, restoreVersion, getTest, getTestsForQuestion, createTest, updateTest, updateTestResult, deleteTest, getInternalAssignments, setInternalAssignment, getPartnerAssignments, setPartnerAssignment, serveConfig, addTestRun, updateTestEmailRecipients

---

## PROVIDERS TO PORT (7 files, 40+ functions)

assemblyai.ts: uploadAudio, transcribe, transcribeWithUtterances, submitTranscription, pollTranscriptOnce, processTranscriptResult
bad-word.ts: detectBadWords, sendBadWordAlert, checkFindingForBadWords
genie.ts: downloadRecording
groq.ts: getTokenUsage, makeUserPrompt, askQuestion, generateFeedback, summarize, diarize
pinecone.ts: upload, query, deleteNamespace
postmark.ts: sendEmail
question-expr.ts: populateQuestions, parseAst, evaluateAutoYes
quickbase.ts: queryRecords, getDateLegByRid, getPackageByRid, getQuestionsForDestination
sheets.ts: parseSheetsServiceAccount, appendSheetRows

---

## CRON JOBS (4)

1. watchdog — hourly — re-publish stuck pipeline steps
2. wire-deductions-weekly — Monday 11:00 UTC — export to Google Sheets
3. chargebacks-weekly — Tuesday 11:00 UTC — export to Google Sheets
4. email-reports — every minute — fire scheduled email reports

---

## ENVIRONMENT VARIABLES (25+)

QSTASH_URL, QSTASH_TOKEN, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, S3_BUCKET, ASSEMBLYAI_API_KEY, GROQ_API_KEY, OPEN_AI_KEY, PINECONE_DB_KEY, PINECONE_INDEX, QB_REALM, QB_USER_TOKEN, POSTMARK_SERVER, GENIE_AUTH, GENIE_AUTH_TWO, GENIE_BASE_URL, GENIE_PRIMARY_ACCOUNT, GENIE_SECONDARY_ACCOUNT, GENIE_SESSION_PASS_9152, GENIE_SESSION_PASS_9054, SELF_URL, KV_SERVICE_URL, KV_REPORT_URL, ALERT_EMAIL, FROM_EMAIL, SHEETS_SA_S3_KEY, CHARGEBACKS_SHEET_ID, CHARGEBACKS_ORG_ID, KV_URL, LOCAL_QUEUE, PORT

---

## EXISTING TESTS (from main branch)

test/audio-stitch_test.ts — 6 tests: MP3 buffer stitching
test/audit-history_test.ts — 11 tests: index entry filtering
test/bonus-points_test.ts — 14 tests: bonus flip scoring
test/chargeback-from-findings_test.ts — 18 tests: chargeback computation
test/question-lab-fields_test.ts — 18 tests: QL field defaults/clamping
test/report-filter_test.ts — 13 tests: report filtering logic
test/review-audit-ownership_test.ts — 12 tests: review state management
test/review-queue-fifo_test.ts — 10 tests: FIFO ordering

---

## NEW TESTS (on refactor branch) — 116 total

src/core/domain/business/auth/test.ts — 12 tests: hashing, roles, cookies
src/core/domain/business/repository-base/test.ts — 8 tests: KV CRUD
src/core/domain/data/deno-kv/smk.test.ts — 3 tests: orgKey
src/audit/domain/business/scoring/test.ts — 18 tests: bonus flips, score calc, auto-complete
src/audit/domain/business/chargeback-engine/test.ts — 14 tests: classification, bypass, headers
src/audit/domain/data/assemblyai/smk.test.ts — 4 tests: role identification, snip filter
src/audit/domain/data/pinecone/smk.test.ts — 4 tests: chunk logic
src/audit/domain/data/audit-repository/smk.test.ts — 13 tests: finding/job/batch/cache/transcript CRUD
src/audit/domain/data/stats-repository/smk.test.ts — 7 tests: tracking lifecycle, index, cb/wire
src/admin/domain/data/admin-repository/smk.test.ts — 12 tests: config CRUD, dimensions, scopes
src/reporting/domain/business/chargeback-report/test.ts — 8 tests: report filtering
src/review/domain/business/review-queue/test.ts — 6 tests: FIFO ordering
src/cron/domain/business/watchdog/test.ts — 4 tests: stuck detection
src/cron/domain/business/weekly-sheets/test.ts — 3 tests: date window calc

## IMPLEMENTED FILES ON REFACTOR BRANCH

### Core module (src/core/)
- domain/business/auth/mod.ts — full auth service (orgs, users, sessions, RBAC)
- domain/business/repository-base/mod.ts — generic KvRepository<T> with chunked storage
- domain/data/deno-kv/mod.ts — KV connection factory, orgKey helper
- domain/data/s3/mod.ts — S3 adapter with AWS Sig V4
- domain/data/qstash/mod.ts — QStash queue adapter (enqueue, publish, pause, resume, purge)
- dto/types.ts — all shared TypeScript interfaces
- entrypoints/auth-controller.ts — login, register, logout

### Audit module (src/audit/)
- domain/business/scoring/mod.ts — applyBonusFlips, calculateScore, getAutoCompleteReason
- domain/business/chargeback-engine/mod.ts — computeFailedQuestions, splitHeaders, buildChargebackEntry, buildWireDeductionEntry, classifyChargebacks, isOfficeBypassed
- domain/data/quickbase/mod.ts — queryRecords, getDateLegByRid, getPackageByRid, getQuestionsForDestination
- domain/data/assemblyai/mod.ts — uploadAudio, transcribe, transcribeWithUtterances, submitTranscription, pollTranscriptOnce, processTranscriptResult, identifyRoles
- domain/data/groq/mod.ts — askQuestion, generateFeedback, summarize, diarize, getTokenUsage
- domain/data/pinecone/mod.ts — upload, query, deleteNamespace, chunkText
- domain/data/audit-repository/mod.ts — getFinding, saveFinding, getJob, saveJob, claimAuditDedup, batch CRUD, cache, transcripts
- domain/data/stats-repository/mod.ts — trackActive, trackCompleted, terminateFinding, trackError, getStats, audit-done-idx CRUD, chargeback/wire CRUD
- entrypoints/audit-controller.ts — createDateLegAudit, createPackageAudit, getFinding, getStats
- entrypoints/step-controller.ts — 12 pipeline step stubs

### Review module (src/review/)
- domain/business/review-queue/mod.ts — populateReviewQueue, selectOldestFinding, recordDecision, getReviewStats, getReviewedFindingIds, clearReviewQueue
- entrypoints/review-controller.ts — 12 endpoints (2 wired, 10 stubs)

### Judge module (src/judge/)
- entrypoints/judge-controller.ts — 15 endpoint stubs

### Manager module (src/manager/)
- entrypoints/manager-controller.ts — 12 endpoint stubs

### Reporting module (src/reporting/)
- domain/business/chargeback-report/mod.ts — queryAuditDoneIndex, getChargebackEntries, getWireDeductionEntries, queryChargebackReport, queryWireReport
- domain/data/postmark/mod.ts — sendEmail
- domain/data/google-sheets/mod.ts — parseSheetsServiceAccount, appendSheetRows
- entrypoints/chargeback-controller.ts — 4 endpoints
- entrypoints/email-report-controller.ts — 7 endpoints

### Admin module (src/admin/)
- domain/data/admin-repository/mod.ts — all config CRUD (pipeline, webhooks, bad word, bypass, bonus, scopes, dimensions, reviewer config)
- entrypoints/admin-controller.ts — 51 endpoint stubs
- entrypoints/user-controller.ts — 4 endpoint stubs
- entrypoints/webhook-controller.ts — 8 endpoint stubs
- entrypoints/dashboard-controller.ts — 6 endpoint stubs

### Other modules
- src/question-lab/entrypoints/question-lab-controller.ts — 24 endpoint stubs
- src/gamification/entrypoints/gamification-controller.ts — 7 endpoint stubs
- src/gamification/entrypoints/badge-controller.ts — 7 endpoint stubs
- src/agent/entrypoints/agent-controller.ts — 5 endpoint stubs
- src/chat/entrypoints/chat-controller.ts — 4 endpoint stubs
- src/events/entrypoints/events-controller.ts — 1 endpoint stub
- src/weekly-builder/entrypoints/weekly-builder-controller.ts — 3 endpoint stubs
- src/cron/domain/business/watchdog/mod.ts — getStuckFindings, runWatchdog
- src/cron/domain/business/weekly-sheets/mod.ts — prevWeekWindow
