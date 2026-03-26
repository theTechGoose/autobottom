# Refactor Plan: autobottom (Revised)

## What Has Been Done

- **Phase 0 (Infrastructure)**: `deno.json` created, test infrastructure (`test-utils/`), `kv-factory.ts` replacing all 20+ `Deno.openKv()` singletons, `lib/s3.ts` lazy-init, `.gitignore` updated.
- **Phase 1 (Baseline Tests)**: 288 tests written — characterization tests (controller, finalize, review), Zod DTO schemas + snapshots (10 files), unit tests for all pure functions (types, question-expr, badges, combometer, groq, assemblyai, pinecone, ask-batch, org), integration tests (lib/kv, auth/kv, review, judge, manager queues), handler tests (review, judge, manager, question-lab).
- **Phase 2 (Structural Refactor)**: All source code copied into `backend/src/domain/` following business/data/coordinator pattern. Old files at root converted to single-line re-export shims. 385 tests passing.
- **Phase 3 (Cleanup)**: Dead files deleted (empty kv.ts, serve.ts, sounds-backup, PNGs, proto/, instrument/).

## What Remains

The project is in a broken intermediate state. The real code lives in `backend/src/` but every file still imports via `../../../../../` paths back to root-level shims. The root is cluttered with shim files, old directories, scattered tests, and page template files.

**The goal**: a clean Deno workspace monorepo with two projects.

---

## Target Structure

```
autobottom/
├── deno.json                          # Workspace: ["./projects/backend", "./projects/ui"]
├── .env
├── .gitignore
├── autobottom.rune
├── seed-data.json
│
├── projects/
│   ├── backend/
│   │   ├── deno.json                  # @autobottom/backend
│   │   ├── main.ts                    # Server entry (current main.ts, 2344 lines)
│   │   ├── env.ts                     # Env var access (current env.ts)
│   │   ├── kv-factory.ts             # KV singleton factory
│   │   ├── swagger.ts                # OpenAPI spec
│   │   ├── src/
│   │   │   ├── bootstrap.ts
│   │   │   ├── domain/
│   │   │   │   ├── business/
│   │   │   │   │   ├── audit-job/        (mod.ts, test.ts)
│   │   │   │   │   ├── audit-finding/    (mod.ts, test.ts)
│   │   │   │   │   ├── question/         (mod.ts, test.ts)
│   │   │   │   │   ├── question-expr/    (mod.ts, test.ts)
│   │   │   │   │   └── gamification/
│   │   │   │   │       ├── badges/       (mod.ts, test.ts)
│   │   │   │   │       └── combometer/   (mod.ts, test.ts)
│   │   │   │   ├── data/
│   │   │   │   │   ├── kv/               (mod.ts, smk.test.ts)
│   │   │   │   │   ├── s3/              (mod.ts)
│   │   │   │   │   ├── queue/           (mod.ts)
│   │   │   │   │   ├── groq/            (mod.ts)
│   │   │   │   │   ├── assemblyai/      (mod.ts)
│   │   │   │   │   ├── pinecone/        (mod.ts)
│   │   │   │   │   ├── quickbase/       (mod.ts)
│   │   │   │   │   ├── genie/           (mod.ts)
│   │   │   │   │   └── postmark/        (mod.ts)
│   │   │   │   └── coordinators/
│   │   │   │       ├── auth/            (mod.ts, int.test.ts)
│   │   │   │       ├── review/          (mod.ts, handlers.ts, int.test.ts)
│   │   │   │       ├── judge/           (mod.ts, handlers.ts, int.test.ts)
│   │   │   │       ├── manager/         (mod.ts, handlers.ts, int.test.ts)
│   │   │   │       ├── agent/           (mod.ts, handlers.ts)
│   │   │   │       ├── question-lab/    (mod.ts, handlers.ts, int.test.ts)
│   │   │   │       └── pipeline/
│   │   │   │           ├── init/        (mod.ts)
│   │   │   │           ├── transcribe/  (mod.ts)
│   │   │   │           ├── diarize/     (mod.ts)
│   │   │   │           ├── prepare/     (mod.ts)
│   │   │   │           ├── ask-batch/   (mod.ts)
│   │   │   │           ├── finalize/    (mod.ts, int.test.ts)
│   │   │   │           └── cleanup/     (mod.ts)
│   │   │   └── entrypoints/
│   │   │       └── api.ts
│   │   ├── dto/                       # Zod schemas + snapshot tests
│   │   ├── lib/
│   │   │   └── org.ts                 # orgKey helper
│   │   ├── pages/                     # Legacy HTML templates (until UI replaces them)
│   │   │   ├── auth.ts
│   │   │   ├── dashboard.ts
│   │   │   ├── chat.ts
│   │   │   ├── agent.ts
│   │   │   ├── manager.ts
│   │   │   ├── review.ts
│   │   │   ├── review-dashboard.ts
│   │   │   ├── judge.ts
│   │   │   ├── judge-dashboard.ts
│   │   │   ├── question-lab.ts
│   │   │   ├── queue-page.ts
│   │   │   ├── gamification.ts
│   │   │   ├── store.ts
│   │   │   ├── badge-editor.ts
│   │   │   ├── super-admin.ts
│   │   │   ├── impersonate-bar.ts
│   │   │   ├── store-ui.ts
│   │   │   ├── icons.ts
│   │   │   └── sound-engine.ts
│   │   ├── test-utils/
│   │   │   ├── kv.ts
│   │   │   ├── mock-fetch.ts
│   │   │   └── mod.ts
│   │   └── scripts/
│   │       └── seed-local.ts
│   │
│   └── ui/                            # Sprig source (Angular-like → Fresh transpiler)
│       ├── deno.json                  # @autobottom/ui
│       └── src/                       # Sprig components, routes, services
│           └── (TBD — Phase 2 of this plan)
│
└── (nothing else at root)
```

---

## Phase 1: Consolidate Into `projects/backend/`

Everything moves into `projects/backend/`. All imports rewritten to be project-internal. No file escapes the project boundary.

### 1.1 Create Workspace Structure

```bash
mkdir -p projects/backend projects/ui/src
```

Root `deno.json` becomes:
```json
{
  "workspace": ["./projects/backend", "./projects/ui"]
}
```

### 1.2 Move Backend Code

Move existing `backend/` contents into `projects/backend/`:
- `backend/src/` → `projects/backend/src/`
- `backend/dto/` → `projects/backend/dto/`
- `backend/deno.json` → `projects/backend/deno.json`
- `backend/scripts/` → `projects/backend/scripts/`

Move root-level backend files into `projects/backend/`:
- `env.ts` → `projects/backend/env.ts`
- `kv-factory.ts` → `projects/backend/kv-factory.ts`
- `main.ts` → `projects/backend/main.ts`
- `swagger.ts` → `projects/backend/swagger.ts`
- `lib/org.ts` → `projects/backend/lib/org.ts`
- `types/mod.ts` → `projects/backend/types/mod.ts` (still needed — has interfaces + factory functions used by main.ts)

Move page template files into `projects/backend/pages/`:
- `auth/page.ts` → `projects/backend/pages/auth.ts`
- `dashboard/page.ts` → `projects/backend/pages/dashboard.ts`
- `chat/page.ts` → `projects/backend/pages/chat.ts`
- `agent/page.ts` → `projects/backend/pages/agent.ts`
- `manager/page.ts` → `projects/backend/pages/manager.ts`
- `review/page.ts` → `projects/backend/pages/review.ts`
- `review/dashboard.ts` → `projects/backend/pages/review-dashboard.ts`
- `judge/page.ts` → `projects/backend/pages/judge.ts`
- `judge/dashboard.ts` → `projects/backend/pages/judge-dashboard.ts`
- `question-lab/page.ts` → `projects/backend/pages/question-lab.ts`
- `shared/queue-page.ts` → `projects/backend/pages/queue-page.ts`
- `shared/gamification-page.ts` → `projects/backend/pages/gamification.ts`
- `shared/store-page.ts` → `projects/backend/pages/store.ts`
- `shared/store-ui.ts` → `projects/backend/pages/store-ui.ts`
- `shared/badge-editor-page.ts` → `projects/backend/pages/badge-editor.ts`
- `shared/super-admin-page.ts` → `projects/backend/pages/super-admin.ts`
- `shared/impersonate-bar.ts` → `projects/backend/pages/impersonate-bar.ts`
- `shared/icons.ts` → `projects/backend/pages/icons.ts`
- `shared/sound-engine.ts` → `projects/backend/pages/sound-engine.ts`

Move test utilities:
- `test-utils/` → `projects/backend/test-utils/`

### 1.3 Rewrite ALL Imports

Every file in `projects/backend/src/` currently imports via `../../../../../lib/kv.ts` (escaping to root shims). All must be rewritten to project-internal paths.

**Import rewrite map** (from `src/domain/coordinators/<name>/mod.ts`, depth = 4 dirs below `src/`):

| Old import | New import |
|---|---|
| `../../../../../lib/kv.ts` | `../../data/kv/mod.ts` |
| `../../../../../lib/queue.ts` | `../../data/queue/mod.ts` |
| `../../../../../lib/s3.ts` | `../../data/s3/mod.ts` |
| `../../../../../lib/org.ts` | `../../../../lib/org.ts` |
| `../../../../../env.ts` | `../../../../env.ts` |
| `../../../../../kv-factory.ts` | `../../../../kv-factory.ts` |
| `../../../../../shared/badges.ts` | `../../business/gamification/badges/mod.ts` |
| `../../../../../providers/groq.ts` | `../../data/groq/mod.ts` |
| `../../../../../providers/assemblyai.ts` | `../../data/assemblyai/mod.ts` |
| `../../../../../providers/pinecone.ts` | `../../data/pinecone/mod.ts` |
| `../../../../../providers/quickbase.ts` | `../../data/quickbase/mod.ts` |
| `../../../../../providers/genie.ts` | `../../data/genie/mod.ts` |
| `../../../../../providers/postmark.ts` | `../../data/postmark/mod.ts` |
| `../../../../../providers/question-expr.ts` | `../../business/question-expr/mod.ts` |
| `../../../../../types/mod.ts` | `../../../../types/mod.ts` |
| `../../../../../review/kv.ts` | `../review/mod.ts` |
| `../../../../../judge/kv.ts` | `../judge/mod.ts` |
| `../../../../../manager/kv.ts` | `../manager/mod.ts` |
| `../../../../../question-lab/kv.ts` | `../question-lab/mod.ts` |
| `../../../../../dto/*.ts` | `../../../../dto/*.ts` |
| Page imports (e.g., `../../../../../agent/page.ts`) | `../../../../pages/agent.ts` |

For `src/domain/coordinators/pipeline/<step>/mod.ts` (depth = 5), add one more `../` to each.

For `src/domain/data/<name>/mod.ts` (depth = 4): same depth as coordinators.

For `src/domain/business/<name>/mod.ts` (depth = 4): only imports from `dto/`.

For `src/entrypoints/api.ts` (depth = 2):
| Old import | New import |
|---|---|
| `../../../lib/kv.ts` | `../domain/data/kv/mod.ts` |
| `../../../env.ts` | `../../env.ts` |
| etc. | (compute from depth 2) |

For `main.ts` (at `projects/backend/` root): imports from `./src/domain/...`, `./env.ts`, etc.

### 1.4 Move and Rewrite Test Files

| Current location | New location |
|---|---|
| `controller_test.ts` | `projects/backend/src/entrypoints/api_test.ts` |
| `lib/kv_test.ts` | `projects/backend/src/domain/data/kv/smk.test.ts` |
| `lib/kv_shim_test.ts` | DELETE |
| `lib/org_test.ts` | `projects/backend/lib/org_test.ts` |
| `auth/kv_test.ts` | `projects/backend/src/domain/coordinators/auth/int.test.ts` |
| `review/kv_test.ts` | `projects/backend/src/domain/coordinators/review/int.test.ts` |
| `review/kv_int_test.ts` | merge into above |
| `review/handlers_test.ts` | `projects/backend/src/domain/coordinators/review/handlers_test.ts` |
| `judge/kv_test.ts` | `projects/backend/src/domain/coordinators/judge/int.test.ts` |
| `judge/handlers_test.ts` | `projects/backend/src/domain/coordinators/judge/handlers_test.ts` |
| `manager/kv_test.ts` | `projects/backend/src/domain/coordinators/manager/int.test.ts` |
| `manager/handlers_test.ts` | `projects/backend/src/domain/coordinators/manager/handlers_test.ts` |
| `question-lab/handlers_test.ts` | `projects/backend/src/domain/coordinators/question-lab/handlers_test.ts` |
| `steps/finalize_test.ts` | `projects/backend/src/domain/coordinators/pipeline/finalize/int.test.ts` |
| `steps/ask-batch_test.ts` | `projects/backend/src/domain/coordinators/pipeline/ask-batch/test.ts` |
| `dto/*_test.ts` | `projects/backend/dto/` (move alongside schemas) |
| `test-utils/kv_test.ts` | `projects/backend/test-utils/kv_test.ts` |
| `types/mod_test.ts` | DELETE (covered by business/ tests) |
| `shared/badges_test.ts` | DELETE (covered by gamification/badges/test.ts) |
| `shared/combometer_test.ts` | DELETE (covered by gamification/combometer/test.ts) |
| `providers/question-expr_test.ts` | DELETE (covered by question-expr/test.ts) |
| `providers/groq_test.ts` | `projects/backend/src/domain/data/groq/test.ts` |
| `providers/assemblyai_test.ts` | `projects/backend/src/domain/data/assemblyai/test.ts` |
| `providers/pinecone_test.ts` | `projects/backend/src/domain/data/pinecone/test.ts` |

Rewrite imports in every moved test file to match the new project-internal paths.

### 1.5 Rewrite `main.ts` Imports

`main.ts` (2344 lines) currently imports from root-relative paths (`./lib/kv.ts`, `./controller.ts`, etc.). All must change to project-internal paths pointing into `src/domain/`. This is the highest-risk file.

Dynamic imports at lines 1345, 1437, 1581, 2123 must also update.

### 1.6 Delete Everything at Root

After all code is inside `projects/`, delete:
- `lib/` (all shims)
- `providers/` (all shims)
- `auth/` (shim + test + page moved)
- `review/` (shims + tests + pages moved)
- `judge/` (shims + tests + pages moved)
- `manager/` (shims + tests + pages moved)
- `agent/` (shim + page moved)
- `question-lab/` (shims + handlers + page moved)
- `steps/` (all shims + tests moved)
- `shared/` (shims + pages moved)
- `types/` (moved)
- `dto/` (moved)
- `test-utils/` (moved)
- `backend/` (emptied)
- `frontend/` (delete — will be `projects/ui/`)
- `controller.ts`, `controller_test.ts` (moved)
- `env.ts`, `kv-factory.ts`, `main.ts`, `swagger.ts` (moved)
- `dashboard/`, `chat/`, `overlay/` (pages moved)
- `sounds/` → `projects/backend/static/sounds/` or `projects/ui/static/sounds/`
- `study/`, `*.md` (except autobottom.rune) — delete or move to `docs/`
- `deno.lock`, `reproduce.json`

### 1.7 Validate

```bash
cd projects/backend && deno task test
```

All 385 tests must pass with zero imports escaping the project boundary.

### 1.8 Create `projects/ui/` Scaffold

```json
// projects/ui/deno.json
{
  "name": "@autobottom/ui",
  "tasks": {
    "dev": "echo 'Sprig UI — not yet implemented'",
    "build": "echo 'Sprig UI — not yet implemented'"
  }
}
```

Empty `projects/ui/src/` ready for Sprig components.

---

## Phase 2: Frontend — Sprig UI

Write Sprig source components in `projects/ui/src/` that replicate every page currently served by the backend's legacy HTML template literals. Transpile with the Sprig engine to generate the Fresh app.

### 2.1 Sprig Source Structure

```
projects/ui/src/
├── bootstrap.html                    # Root layout (dark theme, sidebar shell)
├── _dto/                             # Shared types consumed by components
├── home/                             # Landing / demo page
│   └── routes/
├── auth/                             # Login + register
│   ├── domain/business/
│   │   ├── login-form/               # @Component island
│   │   └── register-form/            # @Component island
│   └── routes/
├── admin/                            # Admin dashboard
│   ├── domain/
│   │   ├── business/
│   │   │   ├── stat-card/
│   │   │   ├── stat-row/
│   │   │   ├── pipeline-config/      # island
│   │   │   ├── user-manager/         # island
│   │   │   └── audit-trigger/        # island
│   │   └── data/
│   │       └── admin-api/            # @Service
│   └── routes/
├── review/                           # Review queue
│   ├── domain/business/
│   │   ├── review-queue/             # island
│   │   ├── combometer/               # island
│   │   └── review-dashboard/
│   └── routes/
├── judge/                            # Judge queue
│   ├── domain/business/
│   │   ├── judge-queue/              # island
│   │   └── judge-dashboard/
│   └── routes/
├── manager/                          # Manager portal
│   ├── domain/business/
│   │   └── manager-queue/            # island
│   └── routes/
├── agent/                            # Agent dashboard
│   ├── domain/business/
│   │   ├── agent-dashboard/          # island
│   │   └── store-view/               # island
│   └── routes/
├── chat/                             # Real-time chat
│   ├── domain/business/
│   │   └── chat-room/                # island
│   └── routes/
├── gamification/                     # Settings + store
│   ├── domain/business/
│   │   ├── gamification-settings/    # island
│   │   ├── sound-pack-editor/        # island
│   │   └── badge-editor/             # island
│   └── routes/
├── question-lab/                     # Question config
│   ├── domain/business/
│   │   └── question-lab-editor/      # island
│   └── routes/
└── static/
    ├── styles/
    │   ├── theme.css                 # Extracted dark theme vars
    │   ├── layout.css
    │   ├── components.css
    │   └── animations.css
    └── sounds/                       # Audio files
```

### 2.2 Vertical Slices (Same Pattern as Backend)

Each slice converts one legacy page template into Sprig source. The Sprig engine transpiles it into the Fresh app.

| Slice | Legacy File (lines) | Sprig Module |
|---|---|---|
| U0 | Scaffold: bootstrap.html, theme.css, _dto/ | Infrastructure |
| U1 | auth/page.ts (188) | auth/ |
| U2 | main.ts handleDemoPage | home/ |
| U3 | dashboard/page.ts (1555) | admin/ |
| U4 | shared/queue-page.ts review (2227) | review/ |
| U5 | shared/queue-page.ts judge | judge/ |
| U6 | review/dashboard.ts (443) | review/ (dashboard route) |
| U7 | judge/dashboard.ts (605) | judge/ (dashboard route) |
| U8 | manager/page.ts (1544) | manager/ |
| U9 | agent/page.ts (791) | agent/ |
| U10 | chat/page.ts (1044) | chat/ |
| U11 | shared/store-page.ts + store-ui.ts (576) | gamification/ (store route) |
| U12 | shared/gamification-page.ts (679) | gamification/ (settings route) |
| U13 | question-lab/page.ts (333) | question-lab/ |
| U14 | shared/badge-editor-page.ts (642) | gamification/ (badge-editor route) |
| U15 | shared/super-admin-page.ts (297) | admin/ (super-admin route) |
| U16 | shared/sound-engine.ts (276) + impersonate-bar.ts (79) | Shared utils |
| U17 | Delete `projects/backend/pages/` | Cleanup |

### 2.3 Backend-Frontend Boundary

After U17, the backend serves JSON API only. The Sprig-generated Fresh app handles all page rendering. Backend's `pages/` directory is deleted. `main.ts` strips out all HTML-serving routes.

---

## Execution Order

```
Phase 1: Consolidate monorepo
  ├── 1.1 Create workspace structure
  ├── 1.2 Move all code into projects/backend/
  ├── 1.3 Rewrite ALL imports (the hard part — ~60 files)
  ├── 1.4 Move and rewrite test files
  ├── 1.5 Rewrite main.ts imports
  ├── 1.6 Delete root clutter
  ├── 1.7 Validate: deno task test → all green
  └── 1.8 Create projects/ui/ scaffold

Phase 2: Sprig UI (vertical slices U0–U17)
  ├── U0 Scaffold
  ├── U1-U2 Auth + Landing (sequential)
  ├── U3 Admin dashboard (creates shared components)
  ├── U4-U16 All pages (parallelizable after U3)
  └── U17 Delete legacy pages from backend
```
