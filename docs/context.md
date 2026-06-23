# Autobottom — LLM Onboarding Context

> Read this first when you open this repo with fresh context. It is the single
> orientation doc: what the product does, the domain language, the architecture,
> the data model, and how to work in the codebase safely. For deeper, workflow-
> level detail see [README.md](../README.md); for frontend specifics see
> [frontend/CLAUDE.md](../frontend/CLAUDE.md); for what changed recently see
> [CHANGELOG.md](CHANGELOG.md).

---

## 1. What Autobottom is (in one paragraph)

Autobottom is an automated **quality-auditing platform for sales call recordings**.
It pulls call recordings ("genies") from QuickBase, transcribes them
(AssemblyAI), asks an LLM (Groq) a configurable list of yes/no questions about
each call, scores the result, and routes failing audits through a multi-tier
**human review system** (reviewer → judge → manager). Team members can appeal a
failure; a judge decides the appeal and can overturn it. The platform also
surfaces analytics for operations and quality leadership.

It runs as a **single Deno process on Deno Deploy** that serves both a Danet
(NestJS-style) backend and a Fresh 2 + HTMX + Preact frontend.

> **Repo status:** the Danet + Fresh rewrite (formerly `refactor/danet-backend`)
> has been **merged into `main`** — `main` IS the unified production app. Bug
> fixes and features land on `main` directly. (The legacy monolithic build is
> still readable for visual/behavioral reference via `git show main:<path>`,
> but it is not what deploys.)

---

## 2. Domain glossary (learn this before reading code)

| Term | Meaning |
|---|---|
| **Genie** | A call recording, identified by a numeric genie ID. Pulled from QuickBase. |
| **TM (team member)** | The salesperson whose call is audited (a.k.a. agent / VO). Surfaced as `voName`. |
| **Audit / finding** | One evaluation of a TM's call against a question set. Stored as a `audit-finding` doc with `answeredQuestions[]`. Result is a 0-100 **score** (% of questions answered "Yes"). |
| **Question** | One scored yes/no item inside an audit. "Yes" = compliant, "No" = a **fail**. |
| **Autobot** | The automated audit/scoring pipeline itself (the LLM grader). "Autobot issue" = a fail the bot raised wrongly. |
| **VO app** | The app TMs use to record/submit calls. "VO app issue" = a fail caused by a bad recording/transcript. |
| **Reviewer** | First human tier. Reviews failed questions and **confirms** or **flips** the bot's answer (Yes↔No). |
| **Appeal** | A TM's challenge to a failed review. Files specific failed question **indices**. Stored as an `appeal` record + populates the judge queue. |
| **Judge** | Second human tier. Decides appeals: **overturn** (reverses the fail → score recomputes) or **uphold** (fail stands = appeal denied). Records a `judgeReason` (`error`/`logic`/`fragment`/`transcript`). |
| **Overturn rate** | How often a reviewer's confirmed fail gets reversed by a judge. A reviewer-quality signal. |
| **Manager** | Coaches TMs; works a remediation queue. |
| **Chargeback / wire deduction** | Money-impact records derived from failed audits. |
| **Bonus** | TM bonus eligibility. There is **no codified bonus rule in-repo today** (only chargeback/wire artifacts); "why did they miss bonus" analytics are deferred. |
| **failureSource** | Root-cause attribution on a failed question: `autobot` / `vo_app` / `team_member` / `unknown`. Auto-seeded + admin-overridable. |
| **org** | Tenant id. Single-org mode today (`DEFAULT_ORG_ID`); multi-org hooks exist but aren't routed. Auth/global data use `org=""`. |

---

## 3. Lifecycle of an audit (end to end)

```
QuickBase genie ──> [pipeline] init → transcribe → grade (LLM) → score
                          │
              score 100 / Invalid Genie ──> terminate webhook (audit-complete email). Done.
                          │
              score < 100 (has fails) ──> review-pending queue (/review)
                          │
        reviewer confirms/flips each failed question  ──> finalize, score may change
                          │
              TM appeals (optional) ──> judge-pending queue (/judge)
                          │
        judge overturns (score recomputes) or upholds (appeal denied)
                          │
              manager remediation (optional) ──> coaching
```

Key truth: a **"failed finding"** is a question whose **final** answer is "No". A
reviewer flip (No→Yes) or a judge overturn removes a fail; a confirm/uphold makes
it stick.

---

## 4. Tech stack & runtime

- **Runtime:** Deno (TypeScript, strict). Single process via root [main.ts](../main.ts).
- **Backend:** [Danet](https://danet.land) (`@Module`/`@Controller`/`@Get`/`@Post` decorators), NestJS-style.
- **Frontend:** Fresh 2 (SSR, file-system routing) + **HTMX 2** (HTML-fragment swaps) + Preact (rendering; islands only when JS is unavoidable).
- **Durable state:** Firestore (single collection, default `autobottom`, in Keystone's Firebase project). Doc IDs encode `(type, org, ...keyParts)`. **In-memory Map fallback** when `FIREBASE_*` env is unset (so tests + local dev run with no Firebase).
- **Object storage:** S3 (audio bytes, service-account JSON blobs).
- **Async pipeline:** QStash (HTTP callback queue) drives the audit steps.
- **External APIs:** AssemblyAI (transcription), Groq (LLM grading), Pinecone (semantic transcript search), Postmark (email), QuickBase (source of truth for records/questions), Google Sheets (report export).
- **Real-time:** in-process pub/sub bus → SSE at `/api/events/stream` + `/api/chat/stream` (per-isolate; polling fallback for cross-isolate misses). Not an external service.
- **Deno KV:** unused at runtime post-cutover (legacy backup only).
- **Deploy:** Deno Deploy. `deno task build` (Fresh build) is required before deploy; new `/admin/*` pages must be registered (see §7).

---

## 5. Repo layout & module conventions

```
main.ts            # single entrypoint: routing + dispatch (danet vs Fresh vs direct)
deno.json          # tasks + import aliases (@<module>/ and #<pkg>)
src/<feature>/     # backend modules (see below)
frontend/          # Fresh app (own CLAUDE.md; excluded from shape-checker)
bootstrap/         # app-startup scripts
fixtures/          # fixtures + scripts (incl. shape-check.sh)
tools/             # one-off scripts (e.g. KV→Firestore migration)
tests/e2e/         # HTTP end-to-end tests that boot the server (helpers.ts)
docs/              # docs not allowed at the repo root (this file, CHANGELOG.md)
```

**Backend module shape (enforced by the shape-checker, `deno task shape-check`):**

```
src/<feature>/
├── mod-root.ts                      # @Module() declaration
├── entrypoints/<thing>/             # @Controller (HTTP). Needs mod.ts + e2e.test.ts
├── domain/business/<thing>/         # pure logic.   Needs mod.ts + test.ts
└── domain/data/<thing>/             # external/Firestore adapter. Needs mod.ts + smk.test.ts
```

Rules that actually bite (codified in README §"Preferred ruleset"):
- **Feature folders are kebab-case.** Ignore the shape-checker's camelCase auto-suggestions.
- **Required test file per kind:** business → `test.ts`; data → `smk.test.ts` (only those two files); entrypoint → `e2e.test.ts` (a placeholder `Deno.test(..., () => {})` is fine).
- **Imports:** `@<module>/...` between modules (never relative); `#<name>` for jsr/npm packages. Both defined in `deno.json` `imports`.
- **No barrel re-exports**, no root `lib/`/`scripts/`, no loose `.ts`/`.txt`/`.md` (besides `README.md`) at the repo root — docs go in `docs/`.
- `deno task check` (types) + `deno task shape-check` (structure) before pushing structural changes.

**Module map:**

| Module | Owns |
|---|---|
| `src/audit/` | Audit pipeline (init → … → finalize) + audit report API + failure indexes |
| `src/review/` | Human review queue (confirm/flip) + review stats + reviewer quality (overturns) |
| `src/judge/` | Judge appeal queue + appeal/decision records + judge analytics |
| `src/manager/` | Manager remediation queue + agent coaching + audit history |
| `src/admin/` | Admin config + dashboard data endpoints + super-admin tooling |
| `src/reporting/` | Email/webhook handlers + chargeback/wire + email reports + failed-audits report + Google Sheets |
| `src/question-lab/` | LLM question config + test cases |
| `src/gamification/` | XP, badges, sound packs, store, leaderboards |
| `src/agent/` | TM/agent dashboard + history |
| `src/chat/` | In-app chat between roles |
| `src/cron/` | Scheduled jobs |
| `src/events/` | Event broadcasts + in-memory pub/sub bus + SSE delivery |
| `src/weekly-builder/` | Weekly report builder |
| `src/core/` | Shared: Firestore, S3, QStash, auth, DTOs, OpenTelemetry, Google Sheets |

---

## 6. Core data model (key DTOs in `src/core/dto/types.ts`)

- **`IAnsweredQuestion`** — one graded question on a finding. Fields you'll use constantly:
  `answer` ("Yes"/"No"), `header` (question label), `thinking`, `defense`,
  `reviewedBy` + `reviewAction` (`flip`/`confirm`/`admin-flip`),
  `judgedBy` + `judgeAction` (`overturn`/`uphold`) + `judgeReason`,
  `reviewHandleMs`/`reviewDiscarded` (per-question review timing),
  `failureSource` + `failureSourceBy` (root-cause attribution + who set it).
- **`AuditDoneIndexEntry`** (`audit-done-idx`) — the fast, time-ordered completion
  index that most analytics scan: `findingId`, `completedAt`, `score`, `reason`
  (`reviewed`/`perfect_score`/`invalid_genie`), `voName`, `owner`, `department`,
  `shift`, `reviewedBy`, `reviewHandleMs`, `reviewedQuestionCount`/`reviewedValidCount`.
- **`AppealRecord`** (`appeal`) — `appealedQuestions` is an array of **question
  indices** (not headers), `status`, `judgedBy`.
- **`JudgeDecision`** (`judge-decided`, keyed `[findingId, questionIndex]`) —
  `decision` (overturn/uphold), `judge`, `header`, `reason`, `decidedAt`. This is
  the authoritative overturn source (it carries no reviewer identity → join to the
  finding's `answeredQuestions[i].reviewedBy`).
- **`FailedFindingIndexEntry`** (`failed-finding-idx`) — one row per failed
  question for the Failed Audits dashboard; carries `failureSource`, `appealed`,
  `appealDenied`, plus dept/shift/voName/header for filtering.

**QuickBase source tables (numeric field-id based):** date legs `bpb28qsnn`,
packages `bttffb64u`, audit questions `bu3e8x98x`. Field maps live in
[src/audit/domain/data/quickbase/mod.ts](../src/audit/domain/data/quickbase/mod.ts).

See README §"Data layer (Firestore)" for the full Firestore type catalogue.

---

## 7. Request routing (main.ts)

`main.ts` owns a single `Deno.serve` and decides each request:
1. **Direct dispatch** for things where Danet's `@Req` breaks under `router.fetch`
   (QStash step callbacks `/audit/step/*`, multipart upload, `/admin/api/me`).
2. **Danet** for backend prefixes (`/admin`, `/audit`, `/review/api`, …).
3. **Fresh** for page routes, static assets, `/api/admin/*`, `/api/review/*`, …

**URL-collision rule (load-bearing):** some paths serve BOTH a Fresh page and a
Danet JSON endpoint (e.g. `/admin/audits`, `/admin/reviewer-throughput`,
`/api/qlab/configs/delete`). The dispatcher resolves these by **`Accept` header**
— but ONLY for paths listed in `FRONTEND_EXACT_PAGES` in `main.ts`. Browser/HTMX
(`Accept: text/html`) → Fresh; a Fresh handler's `apiFetch` (`Accept:
application/json`) → Danet. **Any new `/admin/*` Fresh page must be added to
`FRONTEND_EXACT_PAGES`** and needs a `deno task build`, or it 404s on Danet.

---

## 8. Roles, auth & impersonation

- Roles: `admin` | `judge` | `manager` | `reviewer` | `user`.
- `authenticate(req)` → `{ email, orgId, role }` from the session cookie.
- `defaultOrgId()` reads `DEFAULT_ORG_ID`/`CHARGEBACKS_ORG_ID` (single-org).
- Admins impersonate via `?as=<email>` (middleware swaps `ctx.state.user`, stashes
  the real admin in `impersonatedBy`). Note: `apiFetch` only forwards the cookie,
  so a backend that must act as the impersonated user needs `?as=` forwarded
  explicitly (see frontend/CLAUDE.md gotcha #8).
- **Super Admin** is gated to `ai@monsterrg.com`.
- Analytics/reporting surfaces are **admin-only** (served under `/admin/*`).

---

## 9. Frontend conventions (see frontend/CLAUDE.md for the full set)

- **Backend does the work; the frontend is a thin display + cookie forwarder.**
- **No inline JS** in general; islands only when the browser physically needs JS
  (canvas, audio, file upload, multi-step modal state). Exception: the audit
  report page (`/audit/report`) carries a few `window.*` admin helpers inline by
  established convention (e.g. `flipQuestion`, `setFailureSource`). That page is
  public, so admin-only extras (per-question flip, failure-source override,
  reviewer handle-time `⏱` badges) are gated behind `isAdmin`.
- **`answeredQuestion.snippet` ≠ a display transcript.** It's the *raw* context
  the bot graded against (`step-ask-all`); for short calls that's the whole raw
  transcript, which is a single un-segmented brick when AssemblyAI didn't split
  speakers. Never render `snippet`/`rawTranscript` to a human directly. The
  report's per-question **Transcript Context** is a focused, speaker-split
  excerpt rebuilt from `finding.diarizedTranscript` (Groq's diarized version)
  and narrowed to the `defense` quote — see `buildFocusedExcerpt`
  ([frontend/lib/transcript-excerpt.ts](../frontend/lib/transcript-excerpt.ts)).
  Same rule for the review/judge `TranscriptPanel`: prefer diarized over a
  one-line raw transcript.
- HTMX POST handlers return **HTML fragments directly** (not redirects).
- HTMX-swapped islands do NOT hydrate — islands must be in a page's initial SSR.
- Per-role accent colors via `--accent`: admin `#58a6ff` · review `#8b5cf6` ·
  judge `#14b8a6` · manager `#bc8cff` · agent `#f97316` · chat `#39d0d8`.
- **Template-literal JS escaping:** inside TS template literals never write `'\n'`
  (becomes a raw newline and breaks the browser parser) — use `'\\n'`.

---

## 10. Analytics & reporting surfaces (admin)

These are the operations/quality views (all under `/admin/*`, all read the
`audit-done-idx` + hydrated findings + pre-aggregated counters):

- **Admin Dashboard** `/admin/dashboard` — pipeline activity, errors, review
  queue, recently completed.
- **Reviewer Throughput** `/admin/reviewer-throughput` — per-reviewer + per-
  question handle time (server-measured), true avg/question, and **Reviewer
  Performance**: per-reviewer overturn rate (range + lifetime) + per-question
  overturn breakdown.
- **Question Failures** `/admin/question-failures` — per-question failure rollup
  (monthly `question-fail-stat` counters).
- **Failed Audits** `/admin/failed-audits` — failures-only analytics with
  `failureSource` attribution, four views (findings, appealed-and-still-failed,
  by-question, dept × question matrix) + "#1 fail" drill-down, ISO-week filters.
- **Email Engagement** `/admin/email-engagement` — opens (prefetch-filtered) +
  clicks + appeals.
- **Chargebacks & Weekly Reports** — money tracking + scheduled email reports.

Maintenance/backfill for the counter + index stores lives in the **Data
Maintenance** modal.

---

## 11. How to run, test, and verify

From the repo root (`deno.json` tasks):

| Command | What it does |
|---|---|
| `deno task dev` | Build the frontend, then run the unified server (watch) on :3000 |
| `deno task build` | Fresh build (required before deploy + for new routes) |
| `deno task check` | `deno check main.ts` — type-check the app graph |
| `deno task check:tests` | Type-check `src/**/*.test.ts` (no run) — catches test arity/signature drift |
| `deno task test` | Unit/module tests (excludes `frontend/`, `tests/e2e/`) |
| `deno task test:e2e` | HTTP end-to-end suites (boot server + hit it) |
| `deno task shape-check` | Enforce the module-structure ruleset over `src/` |
| `deno task verify` | **The gate:** `check` + `check:tests` + `shape-check` + `test:e2e` |

Frontend-only type-check: `cd frontend && deno task check`.

**Notes / gotchas when changing code:**
- New `/admin/*` Fresh page → add to `FRONTEND_EXACT_PAGES` in `main.ts` + `deno task build` (else 404).
- Firestore is mocked in-memory when `FIREBASE_*` is unset, so tests run offline.
- Mixing `||` and `??` without parens is a **build error** on Deno Deploy — use `(a || b) ?? c`.
- Deno Deploy: `Deno.env.set()` is effectively read-only at runtime; request budget ~60s (chunk heavy endpoints, 20-wide concurrency); SSE needs a <30s keepalive heartbeat.

---

## 12. Working conventions (how the human wants you to operate)

- **No `Co-Authored-By` lines in commits.**
- **Never `git push` without explicit approval.** Bug-fix/feature work commits to `main` directly.
- **Plan-then-execute** for non-trivial work: propose a plan, await approval, then ship.
- **Comments explain WHY, not WHAT;** no "added for X" task references in code (that's the commit message).
- **Emoji logging** for scanability: 🚀 start · ✅ success · ❌ error · ⚠️ warning · 🔍 search · 📧 email · 📮 enqueue · 📊 stats. **Never remove existing `console.log` statements.**
- **No em dashes** in user-facing copy/labels/comments.
- **Never create `.env.example`/`.env.*` template files;** document env vars in the README instead. Treat `.env` and credential files as never-commit.
- Persistent AI memory lives at `~/.claude/projects/-Users-adam-Programming-autobottom-autobottom/memory/` (`MEMORY.md` is the index). Add to it when the human gives durable feedback or a non-obvious decision worth remembering.

---

## 13. Where to read more

- [README.md](../README.md) — detailed, workflow-by-workflow reference with file pointers (audit pipeline race rules, webhooks, every critical workflow, env vars, Deno Deploy gotchas).
- [frontend/CLAUDE.md](../frontend/CLAUDE.md) — Fresh/HTMX conventions, the islands-don't-hydrate gotcha, the pages/implementation-status table, and 8 load-bearing frontend lessons.
- [CHANGELOG.md](CHANGELOG.md) — concise log of recent big feature changes.
- Legacy prod (visual/behavioral reference only): `git show main:<path>` for the original monolithic build's page renderers.
