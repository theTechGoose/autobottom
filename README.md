# Autobottom — Project Context

This file is the canonical orientation doc for any AI agent working in this repo. Read it first when context is fresh.

---

## What this is

Autobottom is an automated quality-auditing platform for sales call recordings. It pulls call recordings ("genies") from QuickBase, transcribes them via AssemblyAI, asks an LLM (Groq) a configurable list of questions about each call, scores the audit, and routes failed audits through a multi-tier human review system (review → judge → manager). Failures can be appealed by the agent.

Production lives on the `main` branch as a monolithic Deno app (~5000-line `main.ts` + inline-HTML page renderers). This repo (`refactor/danet-backend`) is an in-progress rewrite into:

- a **Deno + danet** backend with a NestJS-style module system
- a **Fresh 2 + HTMX + Preact** frontend
- both served from a single `main.ts` Deno process

---

## Architecture at a glance

```
                  ┌──────────────────────────────────────┐
                  │ main.ts (Deno.serve)                 │
                  │ ├── direct dispatch:                 │
                  │ │   /admin/api/me                    │
                  │ │   /audit/step/* (QStash callbacks) │
                  │ │   /audit/api/appeal/upload-recording (multipart)│
                  │ ├── danet router  ─→ src/<feature>/**│
                  │ └── Fresh handler ─→ frontend/_fresh/server.js │
                  └──────────────────────────────────────┘
                                │
            ┌───────────────────┼───────────────────┐
            ▼                   ▼                   ▼
       Deno KV            S3 (recordings)      External APIs
   (chunked findings,     (audio bytes)       AssemblyAI / Groq
    queues, indexes)                          Pinecone / Postmark
                                              QStash / Google Sheets
```

- **`main.ts`** is the single entrypoint. It owns request routing, direct-dispatches anything where danet's `@Req` decorator falls down (broken via `router.fetch`), and then hands the rest off to either danet (backend) or Fresh (frontend).
- **`isBackendRequest()`** in `main.ts` decides each request: prefix lists for backend (`/admin`, `/audit`, `/review/api`, etc.) vs. frontend (`/api/admin/`, `/api/review/`, page routes, static).
- The frontend SSRs against `API_URL`, which is forced to `localhost:<port>` in unified mode so the frontend never crosses deployments.

---

## Module structure (`src/`)

```
src/<feature>/
├── entrypoints/
│   └── <thing>/
│       ├── mod.ts          # @Controller — danet routes
│       ├── e2e.test.ts     # end-to-end test
│       └── (no smk.test.ts)
├── domain/
│   ├── business/
│   │   └── <thing>/
│   │       ├── mod.ts      # pure business logic
│   │       └── test.ts     # smoke test
│   └── data/
│       └── <thing>/
│           ├── mod.ts      # adapter to external system / KV
│           └── smk.test.ts # smoke test, verifies connectivity
└── mod-root.ts             # danet @Module() declaration
```

**Shape-checker enforces:**
- One feature per business folder (don't put 2+ unrelated business modules under the same `src/<feature>/domain/business/`)
- `data/` adapters use `smk.test.ts`; `business/` modules use `test.ts`
- Imports use the `@<feature>/` aliases declared in `deno.json`
- No barrel-style exports

Run `deno task shape-check` to verify. Run `deno task check` for type checking.

**Features:**
| Folder | What it owns |
|---|---|
| `src/audit/` | Audit pipeline (init → transcribe → finalize) + audit report API |
| `src/review/` | Human review queue (flip Yes↔No) |
| `src/judge/` | Judge appeal queue + appeal records |
| `src/manager/` | Manager remediation queue + agent coaching |
| `src/admin/` | Admin config (pipeline, webhooks, dashboard data, super-admin) |
| `src/reporting/` | Email handlers + chargeback/wire reports + Google Sheets |
| `src/question-lab/` | LLM question config + test cases |
| `src/gamification/` | XP, badges, sound packs, store, leaderboards |
| `src/agent/` | Agent dashboard + history endpoints |
| `src/chat/` | In-app chat between roles |
| `src/cron/` | Scheduled jobs (weekly sheets, watchdog) |
| `src/events/` | Event/prefab broadcasts (used for sale_completed etc.) |
| `src/weekly-builder/` | Weekly report builder (currently placeholder) |
| `src/core/` | Shared: KV, S3, qstash, OpenTelemetry, auth, DTOs, Google Sheets |

---

## Audit pipeline (QStash steps)

Steps fire in order via QStash callbacks. Each step is a Deno function in `src/audit/domain/business/step-*/mod.ts`. They're dispatched **directly from `main.ts`** (not through danet) because `@Req` returns undefined via `router.fetch`.

```
test-by-rid / package-by-rid / appeal/different-recording / appeal/upload-recording
                 │
                 ▼
1.  init               ← download from genie API, save to S3, retry up to 4×
2.  transcribe         ← submit to AssemblyAI (with optional snipStart/snipEnd)
3.  poll-transcript    ← poll AssemblyAI until done
4.  transcribe-complete← write raw + diarized transcript
5.  diarize-async      ← speaker label fixup
6.  pinecone-async     ← embed chunks for semantic search
7.  prepare            ← fetch questions from QuickBase, expand variables
8.  ask-batch          ← Groq grades each question (parallel batches)
9.  ask-all            ← collect answers, run autoYes overrides
10. bad-word-check     ← scan transcript for prohibited language
11. finalize           ← write score, route to review queue or terminate-webhook
12. cleanup            ← delete pinecone namespace (24h delay)
```

`step-finalize` is where most of the routing happens:
- Score 100 OR Invalid Genie → fire `terminate` webhook (audit-complete email)
- Score < 100 + reviewable → populate `review-pending` queue, audit shows up in `/review`
- Recording re-audit (`appealType` set) → routes the same way, just with `appealSourceFindingId` linking back

---

## KV key schema

All keys are scoped by `orgId` via `orgKey(orgId, ...)` from `@core/data/deno-kv/mod.ts`.

| Key prefix | Purpose | Notes |
|---|---|---|
| `audit-finding/<id>` | Finding document | Chunked (`_n` + numbered chunks) |
| `audit-job/<id>` | Audit job (groups findings) | Plain |
| `audit-done-idx/<padTs>/<id>` | Time-ordered completion index | Used for date-range queries |
| `active-tracking/<id>` | In-flight pipeline state | TTL'd via watchdog |
| `completed-audit-stat/<ts>-<id>` | Completion record for dashboard | All-time |
| `error-tracking/<ts>-<id>` | Error log | 24h TTL |
| `retry-tracking/<ts>-<id>` | Retry log | 24h TTL |
| `review-pending/<fid>/<qIdx>` | Review queue items | Per failed question |
| `review-active/<reviewer>/<fid>/<qIdx>` | Claimed by reviewer | TTL refreshed |
| `review-decided/<fid>/<qIdx>` | Saved decision | |
| `review-audit-pending/<fid>` | Counter (remaining items) | |
| `review-done/<fid>` | Sentinel (idempotency) | |
| `judge-pending/<fid>/<qIdx>` | Judge queue items | After agent files appeal |
| `judge-active/<judge>/<fid>/<qIdx>` | Claimed | |
| `judge-decided/<fid>/<qIdx>` | Final decision (uphold/overturn) | |
| `judge-audit-pending/<fid>` | Counter | |
| `appeal/<fid>` | AppealRecord | One per finding |
| `manager-queue/<fid>` | Manager remediation item | |
| `chargeback-entry/<fid>` | Failed-audit money tracking | |
| `wire-deduction-entry/<fid>` | Partner-audit deductions | |
| `webhook-config/<kind>` | Per-webhook admin settings | |
| `email-template/<id>` | Admin-defined email templates | |
| `pipeline-paused` | Boolean | Drives Pause/Resume button |
| `org/<orgId>` | Org record (top-level, not org-scoped) | |
| `email-index/<email>` | `{orgId}` lookup for login | Top-level |

---

## Webhooks + emails

Six kinds. Every webhook fires via `fireWebhook(orgId, kind, payload)` from `@admin/domain/data/admin-repository/mod.ts` and looks up an in-process handler.

| Kind | Triggered when | Default template? |
|---|---|---|
| `terminate` | Audit completes (score 100 / invalid / after review finalizes) | ✅ `Audit Complete` |
| `appeal` | Agent files a judge appeal | ✅ `Appeal Filed` |
| `judge` | Judge decides all appealed Qs OR dismisses an appeal with a reason | ✅ `Appeal Result` (none for dismissal) |
| `judge-finish` | **Never fired** — placeholder for template config UI | n/a (no-op handler) |
| `manager` | Manager submits remediation notes | ✅ `Manager Review Notes` |
| `re-audit-receipt` | Re-audit queued (any of three appeal paths) | ✅ `Re-Audit Receipt` |

All handlers live in [src/reporting/domain/business/webhook-handlers/mod.ts](src/reporting/domain/business/webhook-handlers/mod.ts) and are registered at startup via `registerAllWebhookEmailHandlers()` (called from `main.ts`).

Recipient resolution rule (used by every handler): `isPackage ? gmEmail : (voEmail || agentEmail)`. CC = supervisor (skipped in test mode). BCC from `webhookCfg.bcc`. `webhookCfg.testEmail` overrides everything for testing.

---

## Auth + impersonation

- `authenticate(req)` reads the session cookie, returns `{ email, orgId, role }` or null.
- Roles: `admin` | `judge` | `manager` | `reviewer` | `user`.
- `defaultOrgId()` from `@core/business/auth/mod.ts` reads `DEFAULT_ORG_ID` / `CHARGEBACKS_ORG_ID` env. Single-org mode for now; multi-org hooks exist but aren't routed.
- `?as=<email>` in URL impersonates that user (admin only). Middleware swaps `ctx.state.user` and stashes the real admin email in `ctx.state.impersonatedBy`.
- **Super Admin** is gated to `ai@monsterrg.com` only — checked in `frontend/routes/_middleware.ts` for `/super-admin` and in `Sidebar.tsx` for the Dev Tools / Super Admin sidebar entries.

---

## Frontend conventions

```
frontend/
├── main.ts                    # Fresh entry
├── lib/
│   ├── api.ts                 # apiFetch + parseHtmxBody (forwards session cookie)
│   ├── auth.ts                # role types, public paths, redirects
│   ├── define.ts              # createDefine<State>() — typed page/handler/middleware
│   └── theme.ts               # per-role accent colors
├── components/                # Server-rendered Preact (no client JS)
├── islands/                   # Client-side interactive (only when JS is required)
└── routes/
    ├── _app.tsx
    ├── _middleware.ts         # auth + impersonation + super-admin gate
    ├── api/                   # HTMX/JSON fragment endpoints (proxies to backend)
    └── <section>/             # Page routes
```

**Rules:**
- Backend does the work; frontend is a thin display + cookie forwarder.
- Islands only when the browser physically needs JS (canvas, audio, chord input, file upload, multi-step modal state).
- HTMX POST handlers return **HTML directly** — never `Response.redirect` or `HX-Redirect`.
- `parseHtmxBody(req)` handles both form-encoded (HTMX) and JSON (island fetch). Auto-coerces integer strings.

**Per-role accent colors:**
admin `#58a6ff` · review `#8b5cf6` · judge `#14b8a6` · manager `#bc8cff` · agent `#f97316` · chat `#39d0d8`

---

## Critical workflows (with file pointers)

### File Appeal (3 paths)
1. **Judge Appeal** — failed-question checkboxes → judge queue + `appeal` webhook. [src/audit/domain/business/file-appeal/mod.ts](src/audit/domain/business/file-appeal/mod.ts), [frontend/islands/AppealModal.tsx](frontend/islands/AppealModal.tsx).
2. **Re-audit with new genies** — soft-deletes original, creates new finding with `appealSourceFindingId`. [src/audit/domain/business/reaudit/mod.ts](src/audit/domain/business/reaudit/mod.ts).
3. **Upload recording with snip** — multipart upload to S3, snipStart/snipEnd → AssemblyAI's `audio_start_from`/`audio_end_at`. [src/audit/domain/business/upload-reaudit/mod.ts](src/audit/domain/business/upload-reaudit/mod.ts). Direct-dispatched in `main.ts` because @Req can't read multipart.

### Bulk Audit
Paste a list of RIDs + stagger interval. Loops sequentially through `/audit/test-by-rid` or `/audit/package-by-rid`. [frontend/islands/BulkAuditRunner.tsx](frontend/islands/BulkAuditRunner.tsx).

### Pause/Resume Queues
KV-backed `pipeline-paused` flag mirrors the QStash queue pause state. Toggle button on Active Audits table flips label based on flag.

### Super Admin
- `/super-admin` page — list orgs, create, seed, wipe (typed `WIPE`), delete (typed `DELETE`).
- All endpoints under `/admin/super-admin/*` in `AdminConfigController`. Gated at the Fresh middleware layer by email check.

---

## Critical env vars

| Var | Purpose |
|---|---|
| `DEFAULT_ORG_ID` / `CHARGEBACKS_ORG_ID` | Single-org mode org id |
| `SELF_URL` | This deployment's origin (used for QStash callbacks + email links). Branch previews compute it dynamically via `runWithOrigin`. |
| `API_URL` | Frontend SSR target. Forced to `http://localhost:<port>` in unified mode. |
| `S3_BUCKET` (or `AWS_S3_BUCKET`) | All audio + uploaded SA JSON live here |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` | S3 auth |
| `ASSEMBLYAI_API_KEY` | Transcription |
| `GROQ_API_KEY` | Question grading |
| `PINECONE_API_KEY` | Semantic transcript search |
| `QSTASH_TOKEN` / `QSTASH_CURRENT_SIGNING_KEY` / `QSTASH_NEXT_SIGNING_KEY` | Pipeline queue |
| `POSTMARK_TOKEN` | Email sending |
| `QB_REALM` / `QB_USER_TOKEN` | QuickBase API auth |
| `KV_REPORT_URL` | External report mirror (write-only fire-and-forget) |
| `SHEETS_SA_S3_KEY` | S3 object key of Google service-account JSON |
| `CHARGEBACKS_SHEET_ID` | Target Google Sheets spreadsheet |

---

## Reading prod for reference

```bash
git show main:<path>                # read any prod file
git show main:main.ts | sed -n '2904,2950p'   # read a range
```

Key prod files:
- `main.ts` — all routes, ~5000 lines
- `controller.ts` — audit report HTML render (the source of truth for visual parity on the report page)
- `dashboard/page.ts` — admin dashboard inline HTML (~5500 lines)
- `judge/page.ts`, `review/page.ts`, `manager/page.ts`, `agent/page.ts`, `chat/page.ts` — per-role pages
- `lib/kv.ts` — every KV op
- `providers/sheets.ts`, `providers/assemblyai.ts`, `providers/groq.ts`, `providers/pinecone.ts` — external service adapters
- `shared/queue-page.ts` — review/judge queue UI (the long one)
- `shared/icons.ts` — SVG icons
- `env.ts` — every env var prod uses

---

## Working conventions

- **No comments that describe WHAT the code does** — well-named identifiers do that. Comments only for non-obvious WHY.
- **No comments referencing the current task** ("added for X flow", "fixes bug Y") — that belongs in the commit message.
- **No `Co-Authored-By` lines in commits.**
- **Never `git push` without explicit user approval.**
- **Plan-then-execute** for non-trivial work: propose plan in text, await approval, then ship. If user has approved a text plan, don't bounce through `ExitPlanMode` — just execute.
- **Run `deno task check && deno task shape-check`** after backend changes. Frontend gets `cd frontend && deno task check`.
- **Use Edit > Write** for existing files. Use Write only for new files / full rewrites.
- **Emoji logging** for visual scanning: 🚀 start · ✅ success · ❌ error · ⚠️ warning · 🔍 search · 📧 email · 📮 enqueue · 📊 stats.

## Memory

Persistent AI memory lives at `~/.claude/projects/-Users-adam-Programming-autobottom-autobottom/memory/`. `MEMORY.md` is the index, loaded into context every session. Active feedback memories cover: no-coauthored, no-push-without-asking, plan-approval-flow, backend-does-work, deno-deploy gotchas. Add to memory when: user gives durable feedback, makes a non-obvious decision worth remembering, or shares a domain detail you'd otherwise need to re-derive.

---

## Where things still need work (as of last commit)

| Area | What's left |
|---|---|
| Role dashboards | Agent `type` field crash, missing `perfectCount`, real `weeklyTrend`, manager prefab subs UI + backfill button + finding detail, review queue preferences load, auto-refresh everywhere |
| Question Lab | `updateTest` real impl, `getTestRuns` real lookup, frontend editor (currently shell), question operator types in DTO |
| Gamification | No `/gamification` frontend, sound pack upload (S3), sound pack seed data, leaderboard endpoints, badge editor UI |
| Weekly Builder | Page is "coming in Phase 2" placeholder |
| Misc backend stubs | `/admin/dump-state`, `import-state`, `pull-state`, `setQueue`, `saveGamificationSettings`, `judge`/`review` `saveGamification` |

When working on any of these, read the relevant `main:` prod file first and prefer minimal-but-functional Fresh ports over 1:1 inline-HTML ports.
