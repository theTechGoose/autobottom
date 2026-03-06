# Integrations — Adam's Track

This document details every meaningful change made on Adam's development track (commits by `adamp@monsterrg.com`) relative to Rafa's base codebase. Use this as a merge guide when reconciling the two tracks.

Rafa's base commits: `51b89f8`, `cf11273`, `961e61d`, `4258169`, `613858a`, `abd3638`
Adam's commits (oldest → newest): `6a3fd0c` through `1555c3d`

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

## New API Endpoints Summary

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/admin/init-org` | Admin | Create org + optional first admin user |
| POST | `/admin/retry-finding` | Admin | Smart-retry a finding at the correct step |
| POST | `/admin/terminate-all` | Admin | Mark all active findings as terminated |
| POST | `/admin/clear-review-queue` | Admin | Batch-delete all pending review items + locks |
| GET | `/admin/email-templates` | Admin | List email templates |
| GET | `/admin/email-templates/get?id=X` | Admin | Get single template |
| POST | `/admin/email-templates` | Admin | Create/update template |
| POST | `/admin/email-templates/delete` | Admin | Delete template |
| POST | `/webhooks/audit-complete` | None | Receive terminate webhook, send agent email |
| GET | `/favicon.svg` | None | Serve robot favicon |
| GET | `/logo.png` | None | Serve robot PNG (rasterized from SVG via resvg-wasm, email-safe) |

---

## New KV Keys / Namespaces

| Key Pattern | Type | Description |
|---|---|---|
| `<org>:email-template:<id>` | `EmailTemplate` | Stored email templates |
| `<org>:stats-active:<findingId>` | `ActiveEntry` | Now includes `recordId`, `isPackage` |
| `<org>:stats-completed:<ts>:<findingId>` | `CompletedEntry` | Now includes `recordId`, `isPackage` |
| `<org>:review-lock:<findingId>:<qIndex>` | `LockEntry` | 30s reviewer claim lock (new) |
| `default-org` | `string` | Default orgId used when none specified |

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
6. **`providers/quickbase.ts`** — `FIELD_GUEST_NAME = 32` and `GuestName` field added. Low conflict risk unless Rafa changed the QB query structure.
7. **`controller.ts`** — report page changes (full ID, toggle fix, appeal modal). Low conflict risk.
