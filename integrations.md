# Integrations — Adam's Track

This document details every meaningful change made on Adam's development track (commits by `adamp@monsterrg.com`) relative to Rafa's base codebase. Use this as a merge guide when reconciling the two tracks.

Rafa's base commits: `51b89f8`, `cf11273`, `961e61d`, `4258169`, `613858a`, `abd3638`
Adam's commits (oldest → newest): `6a3fd0c` through `79740e1`

---

## 1. Deno Deploy / Environment Bootstrap

### Files
- `deno.json`
- `env.ts`

### Changes
- Added `deno.json` with `start` and `dev` task definitions (Deno run flags: `--allow-net`, `--allow-env`, `--allow-read`).
- Fixed env var references in `env.ts` (corrected variable names, updated a self-URL reference).
- QuickBase table IDs (`DATE_LEGS_TABLE`, `QUESTIONS_TABLE`) are now hardcoded inline in `providers/quickbase.ts` rather than resolved from env vars (env vars weren't being picked up on Deno Deploy).

---

## 2. Pinecone Provider

### Files
- `providers/pinecone.ts`

### Changes
- Added `ADAM_PINECONE` as a fallback env var for the Pinecone API key (alongside `PINECONE_DB_KEY`).
- Fixed `query()` to correctly destructure the `index` value.
- Improved error responses to include raw response body text for easier debugging.
- Reformatted upload and query functions to multi-line for readability.

---

## 3. Org & User Initialization (Admin Bootstrapping)

### Files
- `main.ts`
- `controller.ts`
- `lib/kv.ts`

### Changes
- **`POST /admin/init-org`** — new endpoint that creates a named org and writes it as `default-org` in KV. Accepts optional `email`/`password` to create the first admin user atomically. Guards against re-creating an org if `default-org` already exists.
- Switched `/audit/test-by-rid` and `/audit/package-by-rid` from `withBodyOrg` to `withOrgId` (orgId now resolved from auth token / query param / `default-org` fallback).
- `handleAuditByRid` and `handlePackageByRid` in `controller.ts` now pass `orgId` in the enqueue body when kicking off the pipeline `init` step.
- `handleAdminMe` now returns `orgId` (used by the dashboard to construct webhook URLs).

---

## 4. QuickBase — Guest Name Field

### Files
- `providers/quickbase.ts`
- `main.ts`
- `dashboard/page.ts`

### Changes
- Added `FIELD_GUEST_NAME = 32` constant.
- Field 32 (`GuestName`) added to the QuickBase date-leg select query and mapped in the return object.
- `guestName` added as a template variable in the `POST /webhooks/audit-complete` email renderer.
- `{{guestName}}` added to the variable reference bar in the email template editor UI.

---

## 5. Dashboard — Active Audits, Search, Recently Completed

### Files
- `dashboard/page.ts`
- `lib/kv.ts`
- `main.ts`

### Changes

#### Active Audits table
- Rows link finding IDs to **Deno Deploy observability logs** (auto-derives org/project from hostname, adds `?query=<findingId>&start=now%2Fy&end=now`).
- Rows show a **QuickBase record ID link** (date leg or package table, based on `isPackage` flag).
- `trackActive()` in `lib/kv.ts` accepts `meta?: { recordId, isPackage }` and merges with existing entry (preserves metadata across step transitions).
- Lazy backfill: `getStats()` detects active entries missing `recordId`, looks up from finding, and writes back best-effort.
- Active table split into separate **Finding ID** and **QB Record** columns (`--` shown for missing).

#### Retry button
- Each active audit row has a **Retry** button.
- `POST /admin/retry-finding` endpoint: smart step detection — re-enqueues `init` if not in KV, `transcribe` if no transcript, `prepare` if no answers, otherwise `finalize`.
- Retry uses `publishStep()` (bypasses QStash queue, runs immediately).
- Retry resets the active entry timer server-side so the dashboard counter restarts.

#### Search
- **"Find Audit" search box** — lookup by finding ID, opens report in a new tab.

#### Recently Completed
- **Recently Completed (24h)** table showing finding ID, QB record link, and completed timestamp.
- `getRecentCompleted()` KV function scans `stats-completed` prefix, sorts newest-first, 25-item limit.
- `trackCompleted()` now stores `{ recordId, isPackage }` metadata.
- `stepFinalize` passes record metadata when calling `trackCompleted`.

#### Terminate All
- **"Terminate All"** button with confirmation modal.
- `terminateAllActive()` KV function marks every active finding as `terminated` and removes from active tracking.
- `POST /admin/terminate-all` endpoint.

#### Test Audit by RID
- Dashboard widget: text input + type selector (date leg / package) + submit.
- Calls `POST /audit/test-by-rid` or `POST /audit/package-by-rid`.

#### Loading overlay
- Animated pulsing robot SVG overlay shown on page load; fades out after first `fetchData()` resolves.

---

## 6. Pipeline — `adminRetry` Propagation

### Files
- `main.ts`
- `lib/queue.ts`
- `steps/prepare.ts`
- `steps/ask-batch.ts`
- `steps/finalize.ts`

### Changes
- **`publishStep()`** added to `lib/queue.ts`: direct QStash publish with 0 retries, bypasses queue backlog for immediate execution.
- Admin retry endpoint emits `adminRetry: true` in the step body.
- `steps/prepare.ts`: when `adminRetry` is set, uses `publishStep` for all downstream dispatches (finalize, ask-batch batches).
- `steps/ask-batch.ts`: when `adminRetry` is set, uses `publishStep` for the finalize trigger on the last batch.
- `steps/finalize.ts`: adjusted chunk size constant.
- End-to-end: a retried audit bypasses the queue backlog at every hop.

---

## 7. Terminated Status Guard

### Files
- `steps/init.ts`
- `steps/transcribe.ts`
- `steps/transcribe-cb.ts`
- `steps/prepare.ts`
- `steps/ask-batch.ts`
- `steps/finalize.ts`

### Changes
- All pipeline steps check `finding.status === "terminated"` at entry.
- If terminated, step returns `{ ok: true, skipped: true, reason: "terminated" }` immediately without doing any work.
- Prevents in-flight steps from continuing after a terminate-all.

---

## 8. Logging / Observability

### Files
- `providers/assemblyai.ts`
- `providers/genie.ts`
- `steps/init.ts`
- `steps/transcribe.ts`

### Changes
- All log lines in `assemblyai.ts` (`transcribe()`, `transcribeWithUtterances()`) prefixed with `[findingId]` tag.
- All log lines in `genie.ts` download functions prefixed with `[findingId]` tag.
- `steps/init.ts` and `steps/transcribe.ts` pass `findingId` through to provider calls.
- Removed noisy poll-retry warnings from `assemblyai.ts`.

---

## 9. ChunkedKV Fix

### Files
- `lib/kv.ts` (or wherever `ChunkedKv` lives)

### Changes
- `ChunkedKv.write()` now writes chunks **sequentially** instead of in a single atomic batch (atomic batches exceeded Deno KV's 800 KB per-commit limit for large findings).
- Delete order fixed: `_n` (chunk count key) is deleted first so readers see the value as absent immediately, preventing partial reads.

---

## 10. Email Templates

### Files
- `lib/kv.ts`
- `main.ts`
- `dashboard/page.ts`

### Changes

#### KV layer
New `EmailTemplate` interface:
```typescript
{ id, name, subject, html, createdAt, updatedAt }
```
New functions: `listEmailTemplates(orgId)`, `getEmailTemplate(orgId, id)`, `saveEmailTemplate(orgId, template)`, `deleteEmailTemplate(orgId, id)`.

#### API routes
- `GET /admin/email-templates` — list all templates
- `GET /admin/email-templates/get?id=X` — get single template
- `POST /admin/email-templates` — create/update template
- `POST /admin/email-templates/delete` — delete template
- `POST /webhooks/audit-complete` — receives terminate webhook, resolves template, substitutes variables, sends email via Postmark

#### Webhook endpoint (`/webhooks/audit-complete`)
- Query params: `?org=<orgId>&template=<templateId>&test=<email>`
- `?test=email` overrides recipient (used for testing without sending to real agents)
- Template variable substitution (mustache-style `{{var}}`):
  - `{{agentName}}`, `{{agentEmail}}`, `{{score}}`, `{{findingId}}`, `{{recordId}}`, `{{guestName}}`
  - `{{reportUrl}}`, `{{recordingUrl}}`, `{{appealUrl}}`, `{{feedbackText}}`
- Falls back to first template in list if no `template` query param given

#### Dashboard UI
- New **Email Templates** sidebar entry (full-screen modal, 90vw × 85vh)
- Three-column layout: template list sidebar (200px) | HTML editor (flex:1) | live iframe preview (flex:1)
- Name + subject inputs, save/delete buttons
- Variable reference bar showing all available `{{variables}}`
- Live preview updates on every keypress
- Webhook URL display with copy buttons (live URL and test URL variants)

---

## 11. Report Page (`controller.ts`)

### Files
- `controller.ts`

### Changes
- Finding ID in the report header is now shown **in full** (removed `shortId` truncation at 16 chars).
- `toggleSection()` now hides the `.sec-summary` truncated text when the full detail section is expanded, and restores it on collapse. Previously both were visible simultaneously.
- "File Appeal" button now shows a **confirmation modal** before opening the appeal panel.
- After a successful appeal submission, the appeal button is locked (`lockAppealBtn()`).

---

## 12. Favicon

### Files
- `favicon.svg` (new file)
- `main.ts`
- `dashboard/page.ts`

### Changes
- Added robot SVG favicon with green accents and antenna.
- `GET /favicon.svg` route added to `main.ts`.
- Dashboard `<head>` links to the favicon.

---

## 13. Review Queue

### Files
- `shared/queue-page.ts`
- `review/kv.ts`

### Changes

#### Decision buttons
- **Confirm No** (`Y` key) and **Flip to Yes** (`N` key) buttons added to the review panel.
- Buttons are a **sticky footer** pinned to the bottom of `#verdict-panel` — always visible regardless of scroll position.
- HTML structure: `#verdict-panel` → `#verdict-scroll` (scrollable content) + `#decision-btns` (sticky, `flex-shrink:0`).

#### Scrollbar
- Transcript body now shows a **thin horizontal scrollbar** instead of hiding it (`scrollbar-width: thin`, custom webkit scrollbar 6px tall).

#### Loading overlay
- Same pulsing robot SVG overlay as the admin dashboard; fades out after the initial `/next` API call resolves.
- Applied to both review and judge dashboards (both use `shared/queue-page.ts`).

#### Performance fix
- `claimNextItem()` in `review/kv.ts` previously iterated the **entire** pending queue to count remaining items.
- Now breaks early: scans only until an unlocked item is found (claim), then scans at most 20 more candidates for the peek item.
- `remaining` counter is no longer derived from this scan — uses `/stats` baseline instead.
- Atomic KV lock (`review-lock:<findingId>:<questionIndex>`, 30s TTL) still prevents two reviewers from claiming the same question.

---

## 14. Manager Dashboard

### Files
- `manager/page.ts`

### Changes
- Added same pulsing robot SVG loading overlay; fades out after `/me` auth check resolves.

---

## 15. Review Queue — Sticky Decision Buttons (`e7d726b`)

### Files
- `shared/queue-page.ts`

### Changes
- Restructured `#verdict-panel` HTML: `#verdict-content` is now wrapped in a `#verdict-scroll` div (the scrollable area), with `#decision-btns` as a direct sibling **after** `#verdict-scroll` — making the buttons a sticky footer that is always visible regardless of scroll position.
- CSS: `#verdict-panel` uses `overflow: hidden`; `#verdict-scroll` is `flex:1; overflow-y:auto`; `#decision-btns` is `flex-shrink:0` with a top border and fixed background.
- `meta-row` (audit ID / question index / remaining count) moved inside `#verdict-scroll` above the scroll boundary.

---

## 16. Loading Overlay — Review, Judge, Manager (`e7d726b`)

### Files
- `shared/queue-page.ts`
- `manager/page.ts`

### Changes
- **`shared/queue-page.ts`** (covers both review and judge): added animated pulsing robot SVG overlay (`#init-overlay`) that fades out after the initial `/next` API call resolves (success or redirect to `/login`).
- **`manager/page.ts`**: same overlay added; fades out after `/me` auth check resolves.
- `@keyframes bot-pulse` animation added inline in both files.

---

## 17. Favicon — All Pages (`9eeb73c`)

### Files
- `shared/queue-page.ts` (review + judge)
- `controller.ts` (audit report page)
- `manager/page.ts`
- `agent/page.ts`
- `auth/page.ts`
- `chat/page.ts`
- `question-lab/page.ts`

### Changes
- Added `<link rel="icon" href="/favicon.svg" type="image/svg+xml">` to the `<head>` of every page. Previously only the admin dashboard had the favicon.

---

## 18. Decide Buttons — Global Scope Fix (`9eeb73c`)

### Files
- `shared/queue-page.ts`

### Changes
- `decide()` function is defined inside the main IIFE so `onclick="decide(...)"` HTML attributes couldn't reach it.
- Added `window.decide = function(decision, reason) { decide(decision, reason); }` immediately before the function definition, exposing it to global scope so the Confirm No / Flip to Yes button `onclick` attributes work correctly.

---

## 19. Impersonation Fixes (`1555c3d`)

### Files
- `shared/impersonate-bar.ts`
- `dashboard/page.ts`
- `main.ts`

### Changes

#### Exit impersonation redirect
- Previously "Exit Impersonation" removed `?as=` from the current URL and stayed on the same role page (e.g. `/review`). Since `requireRolePageAuth` passes admins through, the page reloaded and re-injected the bar — making exit appear broken.
- Fixed: exit link now always redirects to `/admin/dashboard` via `window.location.href`.
- Added `console.log('[IMPERSONATE] Exiting...')` on click for diagnostics.

#### Webhook modal auto-close
- After successfully saving a webhook config, `closeModal('webhook-modal')` is now called so the modal dismisses automatically. Previously the modal stayed open after save (only a toast was shown).

#### Email template variables — missed questions
- Added three new variables to the `POST /webhooks/audit-complete` render context:
  - `{{missedQuestions}}` — pre-rendered HTML `<tr>` rows (one per question answered "No"), drop directly inside a `<table>` tag in the template
  - `{{missedCount}}` — integer count of missed questions as a string
  - `{{totalQuestions}}` — total question count as a string
- Variable hint bar in the email template editor updated to show all three new variables.

---

## 20. Email Webhook — Team Member Name + Score Verbiage + CRM URL (`f1acb72`, `4f6c410`, `b31dcf0`)

### Files
- `main.ts`
- `providers/quickbase.ts`
- `dashboard/page.ts`
- `review/kv.ts`

### Changes

#### Webhook handler (`main.ts`)
- Agent name now parsed from QB field 144 (`VoName`): `"VO MB - Harmony Eason"` → `"Harmony Eason"` / `"Harmony"`.
- `teamMember` and `teamMemberFirst` added as template variables.
- `voEmail` (field 839) and `supervisorEmail` (field 851) extracted and stored for future recipient logic.
- `crmUrl` computed dynamically: `https://<QB_REALM>.quickbase.com/db/<tableId>?a=dr&rid=<recordId>` (uses package vs date-leg table based on `isPackage` flag).
- `scoreVerbiage` added — dynamic phrase based on score range (100% / ≥80% / ≥60% / below 60%).
- All new vars available in email templates: `{{teamMember}}`, `{{teamMemberFirst}}`, `{{crmUrl}}`, `{{scoreVerbiage}}`.
- Debug logging on `[WEBHOOK]` line showing resolved name, VoGenie, crmUrl.

#### QuickBase (`providers/quickbase.ts`)
- Added `FIELD_VO_NAME = 144`, `FIELD_VO_EMAIL = 839`, `FIELD_SUPERVISOR_EMAIL = 851`.
- All three fields added to the date-leg select query.
- Return object extended: `VoName`, `VoEmail`, `SupervisorEmail`.
- Temporary raw field logging added during field discovery (may be removed).

#### Clear Review Queue (`review/kv.ts`, `main.ts`, `dashboard/page.ts`)
- `clearReviewQueue(orgId)` function in `review/kv.ts` — batch-deletes all `review-pending`, `review-audit-pending`, and `review-lock` KV entries in groups of 10 (Deno KV atomic limit).
- `POST /admin/clear-review-queue` endpoint added to `main.ts`.
- Admin dashboard **Review Queue** panel: red **"Clear Queue"** button → confirmation modal → clears queue, leaves `review-decided` history intact.

---

## 21. Diarized Transcript Guard

### Files
- `controller.ts`

### Changes
- `handleGetReport` now only uses the diarized transcript if it actually contains `[AGENT]` or `[CUSTOMER]` speaker labels.
- If diarized text is absent or is a Groq artifact (e.g. "The final reformatted response is as above."), falls back to raw transcript.
- Fallback chain: `storedTranscript.diarized` (if has labels) → `storedTranscript.raw` → `finding.diarizedTranscript` → `finding.rawTranscript`.

---

## 22. Robot Logo PNG Endpoint

### Files
- `main.ts`
- `favicon.svg`

### Changes
- `GET /logo.png` route added — serves the robot SVG rasterized to a 64×64 PNG using `@resvg/resvg-wasm` (pure WASM, no native binaries, works on Deno Deploy).
- PNG is generated once on first request and cached in memory (`_logoPng`).
- Falls back to a 302 redirect to `/favicon.svg` if WASM init fails.
- Used because Gmail blocks both inline SVG and hosted SVG in `<img>` tags; PNG is the only reliable option.

---

## 23. Email Webhook — Logo Variable + Comprehensive Logging

### Files
- `main.ts`
- `lib/kv.ts`
- `dashboard/page.ts`

### Changes

#### Logo in email templates
- `{{logoUrl}}` template variable added — resolves to `${env.selfUrl}/logo.png` in all four webhook handlers (`audit-complete`, appeal filed, appeal result, re-audit result).
- `{{selfUrl}}` variable also added (base URL, useful for constructing custom links).
- `etUpdatePreview()` in the email template editor substitutes `{{logoUrl}}` → `/logo.png` before setting the preview iframe `srcdoc`, so the robot logo renders in the live preview.

#### Webhook logging
- `fireWebhook()` in `lib/kv.ts` logs when it fires a self-email and logs the HTTP status + first 200 chars of the response body.
- `handleAuditCompleteWebhook` in `main.ts` logs `emailTemplateId`, `testEmail`, resolved recipient, CC/BCC, score, and findingId before sending. Wraps `sendEmail()` in try/catch and logs `❌` on failure.

---

## 24. Judge Queue — Disputed Questions Only

### Files
- `steps/finalize.ts`
- `judge/kv.ts`

### Changes
- Previously, when a re-audit finding finalized, **all** newly answered questions were sent to the judge queue — even ones the agent never disputed.
- Now, on the re-audit path (`isAppealReAudit` / `appealSourceFindingId` present), `finalize.ts` looks up the original appeal record via `getAppeal()`, reads its `appealedQuestions` array (the specific question headers the agent disputed), and filters `answeredQuestions` to only the disputed subset before calling `populateJudgeQueue()`.
- If the original appeal has no `appealedQuestions` (legacy), falls back to queuing all answers.
- `appealedQuestions` is also preserved on the new appeal record created during re-audit.
- `getAppeal` import added from `../judge/kv.ts`.

---

## 25. ChunkedKv Race Condition Fix (v2)

### Files
- `lib/kv.ts`

### Changes
**Root cause:** `prepare` and `diarize-async` run in parallel. When `prepare` saves an updated finding that crossed the 30,000-char threshold (single → multi-chunk), it wrote chunk0 (30 KB truncated JSON) and chunk1, then set `_n=2`. If `diarize-async` read `_n=1` (stale) after chunk0 was already overwritten, it tried to `JSON.parse` a 30,000-char truncated JSON string → `SyntaxError: Unterminated string in JSON at position 30000`.

**Fix in `set()`:**
- Writes `_n = 0` first (a sentinel: readers see null, not corrupt data), then writes all chunks, then writes `_n = n`.
- Concurrent readers that race during the write window get null → step exits cleanly → QStash retries → succeeds.
- Same sentinel applied for the single-chunk path (writes `_n=0`, then chunk0, then `_n=1`) to cover the multi→single shrink transition.

**Fix in `get()`:**
- Treats `_n === 0` as null (the in-progress sentinel).
- Wraps `JSON.parse(parts.join(""))` in try/catch — returns null on malformed JSON instead of throwing. Defensive fallback in case of any mid-write read that slips through.

---

## 26. Multi-Genie Appeal UI — Submit New/More Genies

### Files
- `controller.ts`

### Changes
- **Separate input slots** per Genie ID instead of a single comma-separated text field. Each slot is its own `<input>` with `maxlength="8"`.
- **`+ Add Another`** button appends a new empty input row (with a `×` remove button) and focuses it.
- **Paste-to-split**: pasting a comma- or space-separated string into any input (e.g. `27465709, 24765716`) automatically splits it across individual rows via `onRecordingPaste()`.
- **Blur validation**: `validateRecordingInput()` runs on `onblur` — turns border teal if the value is all-digit and non-empty, clears to neutral otherwise. No red during normal interaction.
- **Submit validation**: `isAllDigits()` (charCode 48–57 comparison, no regex) validates each non-empty field on submit. Invalid fields turn red and submission is blocked.
- **Spacing consistency**: first input row has an invisible placeholder `×` button so all rows have identical flex layout.
- **`oninput` clears state**: typing clears the validation border immediately (neutral while editing).
- Backend validation unchanged: `handleAppealDifferentRecording` validates `/^\d+$/` per ID; accepts any-length numeric IDs.

---

## 27. Appeal Re-Audit — `orgId` Missing in Enqueued Steps

### Files
- `controller.ts`

### Changes
- `handleAppealDifferentRecording`: `enqueueStep("init", { findingId: newFindingId })` was missing `orgId` → init step received `orgId: undefined` → `getPipelineConfig(undefined)` threw `TypeError: expected string, number, bigint, ArrayBufferView, boolean` from Deno KV on every attempt → 3 retries exhausted → finding stuck at `pending` forever.
- Fixed: both appeal handlers now pass `orgId` in the step body:
  - `handleAppealDifferentRecording`: `enqueueStep("init", { findingId: newFindingId, orgId })`
  - `handleAppealUploadRecording`: `enqueueStep("transcribe", { findingId: newFindingId, orgId })`

---

---

## 28. Three Dedicated QStash Queues (`speedy` series)

### Files
- `lib/queue.ts`

### Changes
- Replaced single-queue design with **three independent named queues**, each with its own pool of 20 parallel slots:
  - `audit-transcribe` — init, transcribe, poll-transcript, transcribe-complete, prepare
  - `audit-questions` — ask-batch, ask-all
  - `audit-cleanup` — finalize, diarize-async, pinecone-async, bad-word-check
- `STEP_QUEUE` routing table maps each step name to its queue so callers just call `enqueueStep("step-name", body)`.
- `ALL_QUEUES` export lists all three queue names so admin parallelism changes can be applied to all at once.
- `LOCAL_MODE` support: when `LOCAL_QUEUE=true`, `enqueueStep` POSTs directly to `localhost` (with optional delay via `setTimeout`) instead of calling QStash — for local development without QStash credentials.
- Delayed messages: QStash queue-based enqueue does not support `Upstash-Delay`, so delayed steps (e.g. poll-transcript re-enqueues with 15s delay) use `publish` endpoint instead of `enqueue`.

---

## 29. Async Transcription — poll-transcript Step (`speedy` series)

### Files
- `steps/transcribe.ts`
- `steps/poll-transcript.ts` (new)
- `providers/assemblyai.ts`

### Changes

#### `steps/transcribe.ts`
- **Single-genie path is now non-blocking**: calls `submitTranscription()` (returns transcript ID immediately) instead of `transcribe()` (which waited ~90s for result).
- Saves `assemblyAiTranscriptId` and `assemblyAiSubmittedAt` (epoch ms) to the finding.
- Immediately enqueues `poll-transcript` with a 15-second initial delay, then returns `200 OK`.
- Multi-genie path (multiple `s3RecordingKeys`) still uses the synchronous per-file `transcribe()` path because it concatenates results.
- If the finding already has a transcript, skips to `transcribe-complete`.

#### `steps/poll-transcript.ts` (new)
- Polls AssemblyAI using `pollTranscriptOnce(transcriptId)`.
- Status `queued` or `processing`: re-enqueues `poll-transcript` with 15s delay and returns.
- Status `completed`: calls `processTranscriptResult()`, saves `rawTranscript`, enqueues `transcribe-complete`.
- Status error/unknown: saves `Genie Invalid` transcript, enqueues `transcribe-complete`.
- Logs elapsed time since `assemblyAiSubmittedAt` for every poll.
- Poll failures (network errors) re-enqueue rather than failing permanently.

---

## 30. Off-Critical-Path Async Steps (`speedy` series, `batchybatch` series)

### Files
- `steps/diarize-async.ts` (new)
- `steps/pinecone-async.ts` (new)

### Changes

#### `steps/diarize-async.ts`
- Runs in parallel with `prepare` — enqueued from `transcribe-complete` (or the old `transcribe-cb`).
- Calls `diarize()` from Groq to produce `[AGENT]`/`[CUSTOMER]`-labeled transcript text.
- Saves result to both `finding.diarizedTranscript` and a separate `saveTranscript(orgId, findingId, raw, diarized)` KV key.
- Idempotent: skips if `finding.diarizedTranscript` is already set (handles QStash at-least-once delivery).
- Does not call `trackActive()` for finished findings — prevents ghost entries in active audits list.
- Non-fatal: diarization failure is logged but does not block the pipeline; report page falls back to raw transcript automatically.

#### `steps/pinecone-async.ts`
- Formerly used to upload transcript to Pinecone off-path. This step still exists in routing but Pinecone upload has been moved inline into `ask-all` (before questions fire). This step is now a no-op safety valve.

---

## 31. ask-all Replaces ask-batch Fan-out (`batchybatch` series)

### Files
- `steps/ask-all.ts` (new, replaces ask-batch fan-out)
- `steps/prepare.ts`

### Changes
- **ask-all** answers all questions for a finding in a **single QStash step** instead of fan-out batches.
- Uses `Promise.all()` with a **100ms stagger** between question starts (`index * 100ms delay`) to avoid Groq burst rate limits while still running fully concurrently.
- **Pinecone upload runs inline** before questions start — `pineconeUpload(findingId, rawTranscript)` is called once at the top of ask-all. Falls back to raw transcript in each question if Pinecone isn't available.
- **15-minute step ceiling**: `AbortController` + `Promise.race()` hard-kills the step after 15 minutes if questions hang (last line of defense after per-call timeouts in Groq/Pinecone providers).
- Saves answers using `saveBatchAnswers(orgId, findingId, 0, answers)` — batch 0, totalBatches=1 — keeping full compatibility with `finalize`'s `getAllBatchAnswers()`.
- Per-question timing: logs a warning for any question taking >10s.
- **Per-node logging**: for compound questions (multi-node AST), each sub-node's answer and flip is logged individually for debugging.
- Reads populated questions from `getPopulatedQuestions(orgId, findingId)` (dedicated KV key that survives finding trim) with fallback to `finding.populatedQuestions`.
- `adminRetry` propagation: uses `publishStep` instead of `enqueueStep` for downstream finalize dispatch.

---

## 32. autoYes Expression System + QB Field Fetches (`autoyesfeets`, `fieldsneededfeet` series, `fixyfeet`)

### Files
- `providers/question-expr.ts`
- `providers/quickbase.ts`
- `controller.ts`
- `steps/prepare.ts`
- `lib/kv.ts`

### Changes

#### autoYes Expression Operators (`providers/question-expr.ts`)
`evaluateAutoYes(expr, record, fieldLookup)` supports:
- `{{fieldId}}/sub::message` — auto-Yes if field value does NOT contain `sub` (e.g. guest is not single)
- `{{fieldId}}~sub::message` — auto-Yes if field value CONTAINS `sub`
- `{{fieldId}}=val::message` — auto-Yes if field equals `val` (special case: `0=0` always true)
- `{{fieldId}}#val::message` — auto-Yes if field does NOT equal `val`
- `{{fieldId}}<num::message` — auto-Yes if field value is numerically less than `num`

#### Compound Question Prefix (`+:`) Fix (`providers/question-expr.ts`)
- `parseAst()` now strips `+:` from `cleaned` text before building the AND/OR AST.
- Previously `+:` leaked into the first AST node's question text (sent literally to the LLM), causing extra noise and degraded accuracy.
- `body = isPrefixed ? cleaned.replace(/^\+:/, "").trim() : cleaned` — applied before splitting on `|` and `&` operators.

#### QuickBase Date-Leg autoYes Fields (`providers/quickbase.ts`)
- `DATE_LEG_AUTOYES_FIELDS = [49, 460, 553, 594, 706]` added to `getDateLegByRid()`:
  - 49 = MaritalStatus
  - 460 = TotalWGSAttached
  - 553 = DepositCollected
  - 594 = TotalMCCAttached
  - 706 = TotalAmountPaid
- Fields returned as numeric string keys: `{ "49": "Single Female", "460": "0", ... }` — matches the `{{49}}` field reference syntax.

#### New `getPackageByRid()` Function (`providers/quickbase.ts`)
- Package table: `bttffb64u` (was previously incorrect — `bu3e8x98x` is the audit questions table).
- Fields selected: 3 (RecordId), 18 (GenieNumber), 67 (MaritalStatus), 306 (MSPSubscription), 345 (HasMCC).
- `PACKAGE_AUTOYES_FIELDS = [67, 306, 345]` returned as numeric string keys.

#### Controller Always-Fetch Fix (`controller.ts`)
- **Root cause**: QB trigger sends `body.record` with only named fields (RecordId, VoGenie, etc.), completely bypassing `getDateLegByRid` and leaving numeric autoYes fields empty.
- **Fix**: Both `handleAuditByRid` and `handlePackageByRid` now **always call their QB fetch function first**; `body.record` is only the fallback if QB fetch fails or returns null:
  ```typescript
  // handleAuditByRid:
  const record = await getDateLegByRid(rid) ?? body.record ?? { RecordId: rid };
  // handlePackageByRid:
  const record = await getPackageByRid(rid) ?? body.record ?? { RecordId: rid };
  ```
- CRM URL bug fixed in both `controller.ts` and `main.ts`: `bu3e8x98x` → `bttffb64u` for the package table deep link.

#### Populated Questions KV Key (`lib/kv.ts`, `steps/prepare.ts`)
- `savePopulatedQuestions(orgId, findingId, questions)` / `getPopulatedQuestions(orgId, findingId)` — saves populated question array to a **dedicated KV key** separate from the finding object.
- Prevents populated questions from being lost when the finding object is trimmed (ChunkedKV size management).
- `steps/prepare.ts` saves to this key immediately after `populateQuestions()`.
- `steps/ask-all.ts` reads from this key first (fallback to finding).

#### Prepare Logging (`steps/prepare.ts`)
- Logs all record keys at entry: `[STEP-PREPARE] record keys=[...]`.
- Logs autoYes expressions after population showing resolved field values: `"MaritalStatus": {{49}}/single::Guest is married`.

---

## 33. Bad Word Detection (`badwords` commit)

### Files
- `steps/bad-word-check.ts` (new)
- `providers/bad-word.ts` (new)
- `lib/kv.ts` (new functions: `getBadWordConfig`, `saveBadWordConfig`)
- `main.ts` (new routes)
- `dashboard/page.ts` (new config UI)

### Changes
- Off-critical-path step enqueued from `prepare` when `finding.rawTranscript` is set and `finding.recordingIdField === "GenieNumber"` (package audits only).
- `checkFindingForBadWords(config, transcript, ctx)` scans transcript for configured word/phrase violations.
- Context passed includes: `findingId`, `recordId`, `agentEmail`, `officeName`, `guestName`, `reservationId`.
- Non-fatal: errors are logged but returned as `{ ok: true, error: ... }` — never blocks the audit pipeline.
- Admin config stored in KV as `bad-word-config` per org.
- `GET /admin/bad-word-config` and `POST /admin/bad-word-config` routes for managing the word list.
- Routes: `bad-word-check` step assigned to `CLEANUP_QUEUE`.

---

## 34. Finalize — All Findings to Review Queue + Timing Tracking (`flowfeet` series)

### Files
- `steps/finalize.ts`
- `lib/kv.ts`

### Changes

#### Queue Routing
- **All findings — including recording re-audits — now go to the review queue** via `populateReviewQueue()`.
- Previously, recording re-audits (`different-recording`, `additional-recording`, `upload-recording`) had separate routing logic. Now they're treated uniformly.
- Formal judge appeal re-audits (`appealSourceFindingId` present, not a recording re-audit) still go through `handleFileAppeal` on the original finding, not through finalize.
- Log message includes the appeal type when routing: `→ review queue (recording re-audit: different-recording)`.

#### Timing Tracking
- `startedAt` is set in `steps/init.ts` (first step) and preserved on the finding.
- `completedAt` is set in finalize at the moment of save.
- `durationMs = completedAt - startedAt` computed in finalize.
- `trackCompleted()` now accepts and stores `{ startedAt, durationMs }` alongside existing `recordId`/`isPackage`.
- `getRecentCompleted()` returns `startedAt` and `durationMs` in the result array for dashboard display.

#### Agent Gamification Events
- `emitEvent(orgId, finding.owner, "audit-completed", { findingId, score, recordingId })` fired for every completed audit.
- Prefab broadcast events: `sale_completed` (always), `perfect_score` (score=100), `badge_earned` (when new badge awarded).
- XP formula: `floor(score * 0.3)` + 50 bonus for 100%, +20 for ≥90%.
- Badge stat tracking: `totalAudits`, `perfectScoreCount`, `avgScore`, `dayStreak`, `lastActiveDate`.

---

## 35. Judge Queue — Overturn Reasons (`judgefeets` commit)

### Files
- `judge/kv.ts`
- `shared/queue-page.ts`

### Changes

#### `judge/kv.ts`
- `JudgeDecision` interface extended with `reason?: "error" | "logic" | "fragment" | "transcript"`.
- `recordDecision(orgId, item, decision, judge, reason?)` accepts and persists the reason code.
- On overturn: `judgeAction` and `judgeReason` stored on the corrected answer in the re-audit finding.
- Appeal webhook payload includes `reason` field per question override.

#### `shared/queue-page.ts`
- Four overturn reason buttons replace the single "Flip to Yes" button:
  - **Error (A)** — bot made a factual error
  - **Logic (S)** — bot's logic was flawed
  - **Fragment (D)** — transcript fragment was misread
  - **Transcript (F)** — transcript quality issue
- Keyboard hotkeys: `Y` = Uphold, `A/S/D/F` = Overturn with reason.
- Toast messages: `"Upheld"` or `"Overturned: Error"` / `"Overturned: Logic"` / etc.
- `REASON_LABELS` map for display: `{ error: 'Error', logic: 'Logic', fragment: 'Fragment', transcript: 'Transcript' }`.

---

## 36. Pipeline Config — Admin Parallelism Control

### Files
- `main.ts`
- `lib/kv.ts`

### Changes
- `getPipelineConfig(orgId)` / `setPipelineConfig(orgId, config)` KV functions.
- Config shape: `{ parallelism: number }` — controls QStash queue parallelism.
- `GET /admin/pipeline-config` — returns current config.
- `POST /admin/pipeline-config` — updates parallelism (applied to all three queues via `ALL_QUEUES`).
- `stepInit` reads pipeline config at startup and logs `[parallelism=N]`.
- `trackActive()` metadata extended: accepts `startedAt` in addition to `recordId`/`isPackage`.

---

## 37. Bulk Audit Dashboard UI (`bulk` series)

### Files
- `dashboard/page.ts`

### Changes
- **Bulk Audit** button added to the test audit widget row (small secondary button labeled "Bulk").
- Opens a modal with:
  - Textarea for pasting Record IDs (one per line or comma-separated, max 200).
  - Type selector (Date Leg / Package) pre-filled from the single-audit type selector.
  - Stagger delay input (ms between each audit fire, default 100ms).
  - Progress log area showing per-RID status as audits fire.
- JS fires audits **sequentially** with the configured stagger delay between each (not parallel) to avoid overwhelming the queue.
- Each audit calls the same `POST /audit/test-by-rid` or `POST /audit/package-by-rid` endpoints as the single-audit widget.
- Progress log shows: RID, HTTP status, findingId or error for each audit as it completes.

---

## 38. Report Page — Live SSE Updates (`reportfeet` commit)

### Files
- `controller.ts`
- `main.ts`

### Changes

#### `GET /audit/report-sse?id=X`
- Server-Sent Events endpoint that streams live audit progress while a finding is still processing.
- Polls the finding every 3 seconds; emits `update` events with `{ score, passed, failed, total, status }`.
- Closes the stream when `finding.findingStatus === "finished"` (emits one final update first).
- Returns `text/event-stream` with `Connection: keep-alive` and `Cache-Control: no-cache`.
- Client disconnection detected via `req.signal.aborted`.

#### Report page client-side SSE
- Report page subscribes to `report-sse` when the finding is not yet `"finished"`.
- Live updates: score hero (`#live-score`), progress bar (`#live-bar`), passed/failed/total counters.
- "Live" badge indicator (pulsing teal dot) shown while streaming, hidden on completion.
- EventSource auto-closes on the `close` event from the server.

---

## 39. Init Step — Multi-Genie Parallel Download + AssemblyAI Pre-Upload + startedAt (`newgeniefeet` commit)

### Files
- `steps/init.ts`

### Changes

#### Multi-Genie Parallel Download
- When `finding.genieIds` (array) is present, all genies are downloaded **in parallel** using `Promise.all()`.
- Invalid genie IDs are filtered before download: empty strings, `"0"`, all-zeros are skipped with a warning.
- Each downloaded file is saved to S3 as `recordings/<auditJobId>/<genieId>.mp3`.
- Resulting S3 keys stored in `finding.s3RecordingKeys` (array) and `finding.s3RecordingKey` (first key).
- If all genies are invalid or download fails, sets `rawTranscript = "Invalid Genie"` and skips to finalize.

#### AssemblyAI Pre-Upload
- After saving to S3, `init` attempts to **pre-upload the audio to AssemblyAI** (`uploadAudio(bytes)`).
- Pre-upload URL saved to `finding.assemblyAiUploadUrl`.
- In `transcribe`, if `assemblyAiUploadUrl` is already set, the S3 re-download is skipped and the cached URL is used directly — reduces transcribe step latency.
- Pre-upload failure is non-fatal: transcribe step will upload on its own.

#### startedAt Tracking
- `finding.startedAt = Date.now()` set in `init` if not already set (idempotent on retry).
- `trackActive()` called with `{ recordId, isPackage, startedAt }` metadata after QB record is known.

---

---

## 40. Groq Model Update + LLM Timeout Refactor (`modelfeet`, `timeoutfeet`, `errorfeet`, `loggedfeets`, `resubfeets`)

### Files
- `providers/groq.ts`
- `providers/pinecone.ts`
- `providers/assemblyai.ts`
- `steps/ask-all.ts`

### Changes

#### Model Update (`modelfeet`)
- Removed deprecated `meta-llama/llama-4-maverick-17b-128e-instruct` from fallback chain.
- `FALLBACK_MODELS` is now: `openai/gpt-oss-120b` (primary) → `meta-llama/llama-4-scout-17b-16e-instruct` → `llama-3.3-70b-versatile`.

#### Timeout Refactor (all timeout commits)
- `askQuestion()` and `groqCallWithRetry()` in `providers/groq.ts`: replaced `AbortController` (unreliable through npm SDK in Deno Deploy) with `Promise.race + setTimeout` pattern.
- `LLM_TIMEOUT_MS` reduced to 25s per call (fits within QStash 30s default).
- `groqCallWithRetry()` used across `generateFeedback()`, `summarize()`, `diarize()` — no more bespoke per-function fetch/abort logic.
- `404` and `model_not_found` added to fallback trigger conditions (alongside 429, 503, timeout, rate_limit_exceeded).
- `providers/pinecone.ts`: `embed()` also switched to `Promise.race + setTimeout` pattern.
- `providers/assemblyai.ts`: `uploadAudio()` gets `AbortController + 60s setTimeout` with `finally` cleanup.

#### ask-all Step Ceiling (`loggedfeets`)
- Hard ceiling reduced from 15 min to **110s** (fires just before QStash's 120s slot timeout for a clean 500 return).
- Ceiling now uses `setTimeout` directly (not AbortController).
- Per-question error count added to the summary log line.
- Log lines added before/after saving answers and enqueuing finalize.

#### RAG False Negative Fix (`newbugfixyfix`)
- Added `SHORT_TRANSCRIPT_THRESHOLD = 8000` chars.
- Transcripts ≤8000 chars skip Pinecone entirely — full raw transcript passed directly to the LLM.
- Raw transcript fallback size increased from 4000 → 8000 chars for longer transcripts.
- `getContext()` wraps `vectorQuery()` in try/catch — Pinecone failure now falls back gracefully.

---

## 41. QStash Queue Pause / Resume / Purge (`terminatefeet`, `queuefeet`, `fullsyncfeet`)

### Files
- `lib/queue.ts`
- `main.ts`
- `dashboard/page.ts`

### Changes

#### DRY helpers (`queuefeet`)
- Extracted `qstashAuth()` helper (returns auth header object — used everywhere instead of repeated inline).
- Extracted `forEachQueue<T>(fn)` helper — `Promise.all(ALL_QUEUES.map(fn))` — used by all four queue operations.

#### Pause / Resume
- `setAllQueuesState(action)` DRY helper calls QStash `POST /v2/queues/{q}/pause|resume` for every managed queue.
- `pauseAllQueues()` and `resumeAllQueues()` exported as named constants.
- `handleTerminateAll` now calls `pauseAllQueues()` after terminating active findings.
- `POST /admin/pause-queues` and `POST /admin/resume-queues` endpoints added.
- Dashboard: **Pause/Resume Queues toggle button** next to "Terminate All". State flips on each click; after Terminate All the button automatically switches to "Resume Queues" mode.

#### Purge (`queuefeet`, `fullsyncfeet`)
- `purgeAllQueues()` — paginates through `GET /v2/messages?queueName={q}` for each queue, deletes every pending message via `DELETE /v2/messages/{id}`, returns total deleted count.
- `handleTerminateAll` now also calls `purgeAllQueues()` in parallel; response includes `purged` count; toast shows both terminated + purged counts.
- Fixed endpoint: initially tried `/v2/queues/{q}/messages` (405), corrected to `/v2/messages?queueName={q}`.

#### Queue Counts (`queuefeet`)
- `getQueueCounts()` — fetches `messageCount` from `GET /v2/queues/{q}` for each queue.
- `handleDashboardData` calls `getQueueCounts()` in parallel with other stats; exposes `queued` (sum) and `activeCount` on the pipeline payload.
- `inPipe` stat now = `activeCount + queued`.

#### Dashboard Stat Cards (`queuefeet`, `displayfeet`)
- Added **Active** and **Queued** stat cards (6 cards total in the pipeline stat row).
- Grid updated from 4 → 6 columns; responsive breakpoint from 2 → 3.

---

## 42. Watchdog Cron — Stuck Audit Recovery (`modelfeet`)

### Files
- `lib/kv.ts`
- `main.ts`

### Changes
- `trackActive()` now writes a global `["watchdog-active", findingId]` KV entry (TTL 2h) with `{ orgId, findingId, step, ts }`.
- `trackCompleted()` and `terminateAllActive()` both delete the watchdog entry on completion/termination.
- `getStuckFindings(thresholdMs)` — scans the `watchdog-active` prefix; returns any findings whose `ts` is older than the threshold.
- `Deno.cron("watchdog", "0 * * * *", ...)` added to `main.ts` — runs hourly, detects findings stuck >30 min, re-publishes them via `publishStep`, bumps their watchdog timestamp.

---

## 43. Transcript Timestamps + Audio Seeking (`timestamps`)

### Files
- `steps/poll-transcript.ts`
- `steps/transcribe-cb.ts`
- `lib/kv.ts`
- `shared/queue-page.ts`

### Changes
- `poll-transcript` saves `utteranceTimes` (array of utterance start times in ms) from AssemblyAI poll result onto the finding.
- `transcribe-cb` passes `utteranceTimes` through to `saveTranscript()`.
- `saveTranscript()` / `getTranscript()` updated to persist and return `utteranceTimes?: number[]`. Save merges with existing `diarized` transcript to avoid overwriting.
- Review queue page: when `utteranceTimes` present, `data-time` attribute (seconds) added to each transcript line div.
- Timestamp chip (`mm:ss`, monospace) shown per utterance in transcript view.
- `seekToTranscriptLine()` uses `data-time` for precise audio seeking; falls back to proportional position estimate.
- Clicking waveform now auto-plays if paused.

---

## 44. Audio Waveform Visualizer (`wavefeet`)

### Files
- `shared/queue-page.ts`

### Changes
- Replaced the simple `ap-track`/`ap-fill` progress bar with a **Canvas-based waveform visualizer**.
- `loadWaveform(findingId)` fetches the audio, decodes it with Web Audio API, downsamples to 120 bars.
- Draws filled/unfilled bars with a playhead that moves on `timeupdate`.
- DPR-aware canvas sizing for sharp rendering on retina displays.
- Bottom bar height increased to 72px to accommodate the waveform.

---

## 45. Review Queue — Type Breakdown, Progress Chip, QB Record Link (`dashfeet`, `newbie feets`, `badgefeet`)

### Files
- `review/kv.ts`
- `steps/finalize.ts`
- `dashboard/page.ts`
- `shared/queue-page.ts`

### Changes

#### Review Stats by Type (`dashfeet`)
- `ReviewItem` interface extended with `recordingIdField`.
- `populateReviewQueue()` accepts and stores `recordingIdField`.
- `getReviewStats()` now returns separate `dateLegPending`, `dateLegDecided`, `packagePending`, `packageDecided` counts.
- Admin dashboard Review Queue panel replaced single pending/decided donut with a two-row table (Date Legs row + Packages row).
- `steps/finalize.ts` passes `finding.recordingIdField` to `populateReviewQueue()`.

#### ReviewItem Enrichment (`newbie feets`)
- `ReviewItem` extended: `reviewIndex` (1-based position within finding), `totalForFinding`, `recordId` (QB record ID).
- `populateReviewQueue()`, `backfillFromFinished()`, and `undoDecision()` all set/preserve these fields.
- `steps/finalize.ts` passes `recordId` to `populateReviewQueue()`.

#### Review UI (`newbie feets`, `badgefeet`)
- Meta row now shows: **N/M progress** chip, **Package/Date Leg** type badge, **Record ID** chip, **View Record →** QB deep-link.
- **View Report →** purple meta chip added (links to `/audit/report?id=...`).
- QB realm and table IDs embedded from env.
- Keyboard shortcut cheat sheet updated (J/K skip audio, Ctrl+Up/Down playback speed).
- Arrow key handling moved to capture phase to prevent browser scroll stealing.
- Ctrl+Up/Down controls audio playback speed.

---

## 46. Review — Corrected Answers Saved Back to Finding (`fix updates`, `777d803`)

### Files
- `review/kv.ts`

### Changes
- After `postCorrectedAudit()` finalizes review decisions, the corrected `answeredQuestions`, `reviewedAt`, and `reviewScore` are saved back to the finding via `saveFinding()` so the report page reflects the review outcome immediately.
- Batch 0 overwritten via `saveBatchAnswers()` (report page reads batch KV, not `finding.answeredQuestions`).
- Stale batch keys (1+) cleaned up by deleting their `_n` sentinel keys.

---

## 47. Undo Decision — Skip Finalized Audits (`putitinreverseterry`)

### Files
- `review/kv.ts`

### Changes
- `undoDecision()` previously could undo decisions from already-finalized audits (where the `review-audit-pending` counter was deleted).
- Fixed: collects all decisions by the reviewer sorted newest-first, then checks each candidate's `review-audit-pending` counter key — skips any where the counter is null (finalized audit).

---

## 48. Invalid Genie — Score, Review Skip, Webhook, Email (`zerosfeet`, `777d803`, `newbugfixyfix`)

### Files
- `steps/finalize.ts`
- `main.ts`

### Changes
- Invalid Genie findings now receive `score = 0` instead of `undefined` in finalize.
- Invalid Genie findings are **skipped from the review queue** — go directly to terminated.
- Finalize immediately fires the terminate webhook for Invalid Genie with `reason: "invalid_genie"`.
- `handleAuditCompleteWebhook` detects `isInvalidGenie` and injects a `notesSection` variable: "Recording Invalid" banner with report + new-recording link (instead of the missed questions table).
- Email link for Invalid Genie fixed: was pointing to `/audit/appeal?findingId=X` (404), now points to `/audit/report?id=X`.
- `passedOrFailed` template variable added (derives from score).

---

## 49. Audit History Page (`recentlyauditedfeet`, `storefeets`, `newbie feets`)

### Files
- `lib/kv.ts`
- `main.ts`
- `providers/quickbase.ts`
- `steps/finalize.ts`
- `dashboard/page.ts`

### Changes

#### KV Layer
- `CompletedAuditStat` interface extended with `owner` and `department`.
- `trackCompleted()` accepts and stores `owner` (finding.owner) and `department` (ActivatingOffice or OfficeName).
- `getAllCompleted(orgId, since?)` — scans completed stats with reverse iteration + early-break for O(window) performance.
- `getRecentCompleted()` refactored to use `reverse: true, limit` scan.
- Removed 24h TTL from `trackCompleted()` — completed stats now stored permanently.

#### QuickBase
- `FIELD_ACTIVATING_OFFICE` (field 140) added to date leg queries → `ActivatingOffice`.
- `PKG_FIELD_OFFICE_NAME` (field 46) added to package queries → `OfficeName`.

#### API Routes
- `GET /admin/audits` — full dark-themed HTML page with stat cards (total, pass/fail, packages, date legs, avg score), table, filters, and pagination.
- `GET /admin/audits/data` — JSON API supporting query params: `type`, `owner`, `department`, `scoreMin`, `scoreMax`, `since`, `until`, `page`.

#### UI Features
- Time window buttons: 1h / 4h / 12h / 24h / 3d / 7d.
- Custom date range picker (start/end date inputs with Go/Clear).
- Filter dropdowns: type, team member, department, score range.
- "View All →" link added next to "Recently Completed (24h)" on the main dashboard.

---

## 50. Email Template Variables — Package Support + New Vars (`audit email update`, `67c1d88`, `b6a97c5`)

### Files
- `main.ts`

### Changes
- `subjectGuest` variable: guest name for date legs, `"Package #<recordId>"` for packages.
- `passedOrFailed` variable: `"Passed"` or `"Failed"` based on score.
- `gmEmail` variable: `GmEmail` field from QB (used to route package emails to the GM instead of VO).
- `notesSection`: rendered HTML block — Invalid Genie banner, perfect score banner, or missed questions table.
- `greeting`, `auditTypeLabel`, `guestContext`, `supportTeamName`, `recordTypeLabel`, `urgentNote` dynamic vars.
- All four email webhook handlers (audit-complete, appeal-filed, appeal-decided, re-audit) route package emails to `gmEmail` and date-leg emails to `voEmail/agentEmail`.

---

## 51. User Account Management — Delete User (`accountfeets`, `accountfeet2`, `accountsfeet`)

### Files
- `dashboard/page.ts`
- `main.ts`
- `auth/kv.ts`

### Changes
- User list rendering fixed: was reading `u.username`, now correctly reads `u.email`.
- Supervisor dropdown allows admins as valid supervisors.
- Email input changed from `type="email"` to `type="text"` with `autocomplete="off"` (prevents browser validation interference).
- Email validation simplified to `indexOf('@')` / `lastIndexOf('.')` check (in both dashboard JS and `handleAdminAddUser`).
- Delete (✕) button added per user row → confirmation prompt → `POST /admin/users/delete`.
- `handleAdminDeleteUser` validates email, prevents self-deletion, calls `deleteUser()`.

---

## 52. Genie Retry Logic + Verbose Logging (`geniefeet`, `a59547b`)

### Files
- `providers/genie.ts` — per-attempt logging, findingId tag propagation
- `steps/init.ts` — isRetryableGenie, job-level retry with QStash delay
- `lib/kv.ts` — trackActive meta extended with genieRetryAt/genieAttempts
- `dashboard/page.ts` — genie-retry step badge with live countdown

### Changes

#### Genie Provider Logging (`providers/genie.ts`)
- Added `tag` (findingId) param to `searchOnce`, `searchWithRetry`, `downloadWithRetry`, `tryStrategy` — all log lines now include the findingId for easy log grep.
- `searchOnce`: logs exact reason for each null return — HTTP status, API error body, empty data array, missing `contract` field, missing/blank `src`.
- `searchWithRetry`: logs `search attempt i/max` before each attempt; logs "exhausted N attempts" at the end.
- `downloadWithRetry`: all existing log lines now include `${tag}`.
- `getRecordingUrl`: updated to pass `tag` to `searchWithRetry` (was missing, caused TypeScript compile error).

#### Job-Level Genie Retry (`steps/init.ts`)
- `isRetryableGenie(rid)`: regex `/^[23]\d{7}$/` — true for real 8-digit Genie IDs starting with 2 or 3; false for all-zeros, placeholder, or other formats.
- `MAX_GENIE_RETRIES = 3` (allows 2 retries after initial attempt).
- `GENIE_RETRY_DELAY_SEC = 600` (10 minutes between retries).
- When `downloadRecording` returns null for a retryable Genie ID:
  - Increments `finding.genieAttempts`; saves `finding.genieRetryAt = now + 10min`.
  - Calls `trackActive(orgId, findingId, "genie-retry", { genieRetryAt, genieAttempts })`.
  - Re-enqueues `init` step with a 600-second QStash delay (uses `Upstash-Delay: 600s` via the publish path).
  - Returns `{ ok: true, retrying: true, attempt, retryAt }`.
- After `MAX_GENIE_RETRIES - 1` failed retries, falls through to existing "Invalid Genie" path (rawTranscript = "Invalid Genie", finalize).

#### KV Extension (`lib/kv.ts`)
- `trackActive` meta type extended: added optional `genieRetryAt?: number` and `genieAttempts?: number` fields.
- These are stored in `stats-active:<findingId>` and surfaced to the dashboard.

#### Dashboard Genie-Retry Badge (`dashboard/page.ts`)
- In `renderActive()`, when `a.step === 'genie-retry'` and `a.genieRetryAt` is set:
  - Calculates seconds remaining until retry: `Math.max(0, Math.round((a.genieRetryAt - Date.now()) / 1000))`.
  - Renders yellow badge: `⏳ genie-retry (Xm Ys)` with title showing attempt number and countdown.
  - Style: `background: rgba(210,153,34,0.15); color: var(--yellow)`.

---

## New API Endpoints Summary

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/admin/init-org` | Admin | Create org + optional first admin user |
| POST | `/admin/retry-finding` | Admin | Smart-retry a finding at the correct step |
| POST | `/admin/terminate-all` | Admin | Mark all active findings as terminated |
| POST | `/admin/clear-review-queue` | Admin | Batch-delete all pending review items + locks |
| GET | `/admin/pipeline-config` | Admin | Get pipeline parallelism config |
| POST | `/admin/pipeline-config` | Admin | Set pipeline parallelism (applied to all 3 queues) |
| GET | `/admin/bad-word-config` | Admin | Get bad word detection config |
| POST | `/admin/bad-word-config` | Admin | Save bad word detection config |
| GET | `/audit/report-sse?id=X` | None | SSE stream of live audit progress |
| POST | `/audit/step/poll-transcript` | QStash | Poll AssemblyAI for transcript result |
| POST | `/audit/step/ask-all` | QStash | Answer all questions in one parallel step |
| POST | `/audit/step/diarize-async` | QStash | Off-path speaker diarization |
| POST | `/audit/step/pinecone-async` | QStash | Off-path Pinecone upload (legacy, now inline in ask-all) |
| POST | `/audit/step/bad-word-check` | QStash | Off-path bad word scan for package audits |
| GET | `/admin/email-templates` | Admin | List email templates |
| GET | `/admin/email-templates/get?id=X` | Admin | Get single template |
| POST | `/admin/email-templates` | Admin | Create/update template |
| POST | `/admin/email-templates/delete` | Admin | Delete template |
| POST | `/webhooks/audit-complete` | None | Receive terminate webhook, send agent email |
| GET | `/favicon.svg` | None | Serve robot favicon |
| GET | `/logo.png` | None | Serve robot PNG (rasterized from SVG via resvg-wasm, email-safe) |
| POST | `/admin/terminate-all` | Admin | Mark all active as terminated + purge QStash queues + pause queues |
| POST | `/admin/pause-queues` | Admin | Pause all QStash queues (stop message delivery) |
| POST | `/admin/resume-queues` | Admin | Resume all QStash queues after a pause |
| GET | `/admin/audits` | Admin | Full audit history page with filters, date range, pagination |
| GET | `/admin/audits/data` | Admin | JSON audit history (type/owner/dept/score/since/until filters) |
| POST | `/admin/users/delete` | Admin | Delete a user account (prevents self-deletion) |

---

## New KV Keys / Namespaces

| Key Pattern | Type | Description |
|---|---|---|
| `<org>:email-template:<id>` | `EmailTemplate` | Stored email templates |
| `<org>:stats-active:<findingId>` | `ActiveEntry` | Now includes `recordId`, `isPackage` |
| `<org>:stats-completed:<ts>:<findingId>` | `CompletedEntry` | Now includes `recordId`, `isPackage` |
| `<org>:review-lock:<findingId>:<qIndex>` | `LockEntry` | 30s reviewer claim lock (new) |
| `<org>:populated-questions:<findingId>` | `IQuestion[]` | Dedicated key for populated questions (survives finding trim) |
| `<org>:bad-word-config` | `BadWordConfig` | Bad word detection configuration |
| `<org>:pipeline-config` | `{ parallelism: number }` | QStash queue parallelism setting |
| `default-org` | `string` | Default orgId used when none specified |
| `watchdog-active:<findingId>` | `{ orgId, findingId, step, ts }` | Global stuck-audit index (2h TTL); written by trackActive, deleted by trackCompleted/terminateAllActive |
| `<org>:stats-completed:<ts>:<findingId>` | `CompletedAuditStat` | Extended: now includes `owner`, `department`, `startedAt`, `durationMs`; permanent (no TTL) |
| `<org>:review-pending:<findingId>:<qIndex>` | `ReviewItem` | Extended: now includes `reviewIndex`, `totalForFinding`, `recordId`, `recordingIdField` |

---

## Environment Variables Added

| Variable | Used In | Description |
|---|---|---|
| `ADAM_PINECONE` | `providers/pinecone.ts` | Fallback Pinecone API key |

(All other env vars were pre-existing on Rafa's track.)

---

## Merge Notes for Rafa

1. **`deno.json`** — likely conflicts if Rafa has his own. Merge task definitions.
2. **`lib/kv.ts`** — significant additions (EmailTemplate CRUD, terminateAllActive, trackCompleted metadata, ChunkedKv fix, review lock). Merge carefully with any KV changes Rafa made.
3. **`main.ts`** — many new routes and handlers added. Merge route maps (GET/POST) carefully.
4. **`shared/queue-page.ts`** — review queue UI rewritten substantially (decision buttons, sticky footer, overlay, scrollbar, perf fix). High conflict probability if Rafa touched this.
5. **`steps/*.ts`** — terminated guard added to every step file. Each is a small early-return check at the top — low conflict risk.
6. **`providers/quickbase.ts`** — `FIELD_GUEST_NAME = 32`, `GuestName`, new autoYes fields (49, 460, 553, 594, 706 on date legs; 67, 306, 345 on packages), new `getPackageByRid()`. Low conflict risk unless Rafa changed the QB query structure.
7. **`controller.ts`** — report page changes (full ID, toggle fix, appeal modal), SSE endpoint, always-fetch QB fix, CRM URL fix for package table. Low conflict risk if Rafa didn't touch these areas.
8. **`lib/queue.ts`** — complete redesign: 3 queues, step routing table, LOCAL_MODE. High conflict risk if Rafa has any queue changes.
9. **`steps/ask-all.ts`** — entirely new file (replaces ask-batch fan-out). No Rafa equivalent.
10. **`steps/poll-transcript.ts`**, **`steps/diarize-async.ts`**, **`steps/pinecone-async.ts`**, **`steps/bad-word-check.ts`** — all new files. No conflict risk.
11. **`steps/transcribe.ts`** — single-genie now async/non-blocking. If Rafa modified transcribe, merge the non-blocking submit path carefully.
12. **`steps/init.ts`** — multi-genie parallel download, pre-upload, startedAt. Merge carefully if Rafa modified init.
13. **`steps/finalize.ts`** — routing (all to review queue), timing, gamification. High conflict risk if Rafa touched finalize.
14. **`providers/question-expr.ts`** — `+:` prefix strip fix in `parseAst`, `evaluateAutoYes` operator additions. Review carefully.
