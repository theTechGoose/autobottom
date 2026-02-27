# Integrations — Adam's Track

This document details every meaningful change made on Adam's development track (commits by `adamp@monsterrg.com`) relative to Rafa's base codebase. Use this as a merge guide when reconciling the two tracks.

Rafa's base commits: `51b89f8`, `cf11273`, `961e61d`, `4258169`, `613858a`, `abd3638`
Adam's commits (oldest → newest): `6a3fd0c` through `9eeb73c`

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

## New API Endpoints Summary

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/admin/init-org` | Admin | Create org + optional first admin user |
| POST | `/admin/retry-finding` | Admin | Smart-retry a finding at the correct step |
| POST | `/admin/terminate-all` | Admin | Mark all active findings as terminated |
| GET | `/admin/email-templates` | Admin | List email templates |
| GET | `/admin/email-templates/get?id=X` | Admin | Get single template |
| POST | `/admin/email-templates` | Admin | Create/update template |
| POST | `/admin/email-templates/delete` | Admin | Delete template |
| POST | `/webhooks/audit-complete` | None | Receive terminate webhook, send agent email |
| GET | `/favicon.svg` | None | Serve robot favicon |

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
