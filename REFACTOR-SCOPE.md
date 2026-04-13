# Autobottom Danet Backend Refactor — Complete Scope Reference

> This file is the master reference for the full backend refactor. It survives context
> compaction and should be re-read at the start of each session. It documents every route,
> function, provider, and module that must be ported to the new danet architecture.

## Branch: `refactor/danet-backend`

## Completed Phases
- **Phase 0**: Scaffold (14 modules, bootstrap/mod.ts, Swagger UI) — commit `8c4dd7c`
- **Phase 1**: Core infra (KvRepository, auth, S3, QStash, DTOs, 23 tests) — commit `cbc74a3`

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

## NEW TESTS (on refactor branch)

src/core/domain/business/auth/test.ts — 12 tests: hashing, roles, cookies
src/core/domain/business/repository-base/test.ts — 8 tests: KV CRUD
src/core/domain/data/deno-kv/smk.test.ts — 3 tests: orgKey
