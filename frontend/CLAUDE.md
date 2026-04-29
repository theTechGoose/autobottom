# Autobottom Frontend — Fresh 2 + HTMX

## What This Is
A Deno Fresh 2 SSR frontend for the autobottom QA auditing platform. Almost no client-side logic — the server renders everything, the browser is a dumb terminal. HTMX handles partial page updates without writing JavaScript.

## Architecture

### Stack
- **Deno Fresh 2** (RC) — SSR framework, file-system routing, Preact components
- **HTMX** (2.0.4, CDN) — partial page updates via HTML fragment swaps
- **Preact Islands** — only for things that physically require client JS (multi-step modals with local state, file/audio handling, polling-with-progress)
- **Backend** — danet/Deno controllers under `../src/`. In production both ship as a **single unified process** via the root `main.ts` (frontend mounts via `frontend/main.ts`'s `app` export).

### Key Patterns
- **API Client** (`lib/api.ts`): `apiFetch(path, req)` forwards the session cookie to the backend and sets `Accept: application/json` so the unified-server dispatcher routes it to danet (not back to the same Fresh page — see "Frontend ↔ backend URL collisions" below).
- **Auth Middleware** (`routes/_middleware.ts`): calls `authenticate(req)` **directly in-process** (no HTTP self-request), injects user into `ctx.state.user`, redirects to `/login` if unauthenticated. Public paths (`/login`, `/register`, `/api/login`, `/api/register`) skip auth.
- **Shared Define** (`lib/define.ts`): `createDefine<State>()` gives typed `define.page`, `define.handlers`, `define.middleware`, `define.layout`.
- **HTMX Fragment Routes** (`routes/api/*`): return HTML fragments (not JSON) for HTMX swaps — fetch JSON from backend via `apiFetch`, render Preact component, return `text/html`.
- **Layout + Sidebar** (`components/Layout.tsx`, `components/Sidebar.tsx`): shared page shell with 280px sidebar, dark theme, role-aware nav. Pass `hideSidebar` to render full-width admin tools (Question Lab, Weekly Builder).
- **Top bar pattern** (`.ql-topbar`): full-width admin tools use a sticky top bar with icon + breadcrumbs (left) + `← Dashboard` link (right) instead of the sidebar. See `routes/question-lab/index.tsx` for the canonical implementation.

### Per-Role Accent Colors
- admin: `#58a6ff` (blue)
- review: `#8b5cf6` (purple)
- judge: `#14b8a6` (teal)
- manager: `#bc8cff` (purple-light)
- agent: `#f97316` (orange)
- chat: `#39d0d8` (cyan)

Set via CSS variable `--accent` in `Layout.tsx` using `lib/theme.ts`.

## Directory Structure
```
frontend/
├── main.ts                # Standalone-mode entry; also exports `app` for unified-server mount
├── lib/
│   ├── api.ts             # apiFetch (Accept:application/json + cookie forwarding) + parseHtmxBody
│   ├── auth.ts            # Types, role redirects, public paths
│   ├── csv.ts             # Tiny CSV parser used by the import wizard
│   ├── define.ts          # createDefine<State>()
│   └── theme.ts           # Per-role accent colors
├── components/            # Server-rendered Preact components
├── islands/               # Client-side interactive components (use sparingly)
├── routes/                # File-system routes
│   ├── _app.tsx           # Root layout
│   ├── _middleware.ts     # Auth middleware (direct in-process authenticate())
│   ├── api/               # HTMX fragment endpoints
│   └── <section>/         # Page routes (some with [id].tsx dynamic segments)
├── static/                # CSS, favicon, sounds
└── tests/                 # Test files (components/, lib/, routes/)
```

## Running Locally

**Unified mode** (preferred — matches production deployment):
```bash
deno task dev   # from repo root — runs frontend + backend in one process on :3000
```

**Standalone mode** (frontend only, talks to a remote backend):
```bash
cd frontend && deno task dev   # :8000, requires API_URL env to point to a backend
```

## Commands (frontend dir)
```bash
deno task dev      # Development with watch
deno task start    # Production start
deno task check    # Type check (frontend's main.ts)
deno task test     # Run frontend tests (component / lib / routes)
```

The repo root has its own `deno task check` and `deno task test` for backend.

## Auth Flow
1. Browser hits any protected route → middleware calls `authenticate(req)` directly (in-process).
2. If authenticated → `ctx.state.user` is set, page renders.
3. If not → redirect to `/login`.
4. Login form posts to `/api/login` → proxies to backend `/login` → backend sets `Set-Cookie: session=...` → frontend redirects to role-appropriate dashboard.
5. Logout hits `/api/logout` → clears cookie → redirects to `/login`.

Admin impersonation: `?as=<email>` swaps `ctx.state.user` to the target user; the real admin email is stashed in `ctx.state.impersonatedBy` so the golden ImpersonationBanner can display it.

## Frontend ↔ backend URL collisions

Several admin URLs serve **both** an HTML page (Fresh) and a JSON endpoint (danet) — `/admin/users`, `/admin/dashboard`, `/admin/audits`, `/admin/weekly-builder`. The unified-server dispatcher in the root `main.ts` resolves the collision by **`Accept` header**:

- Browser navigation → `Accept: text/html…` → routes to Fresh (HTML page).
- `apiFetch` from a Fresh page handler → `Accept: application/json` → routes to danet (JSON).

This is what stops the Fresh page handler from infinitely recursing on its own URL. If you add a new colliding URL, make sure the page-side `apiFetch` doesn't call its own URL — or rely on the Accept-based dispatch (which only fires for paths in `FRONTEND_EXACT_PAGES`).

## HTMX Patterns

Pages SSR a full HTML document on first load. Interactive sections use HTMX attributes:
```html
<!-- Auto-refresh stats every 10s -->
<div hx-get="/api/admin/dashboard-stats" hx-trigger="load, every 10s" hx-target="#stats">
  Loading...
</div>

<!-- Form submission via HTMX -->
<form hx-post="/api/admin/pipeline-config" hx-target="#config-result" hx-swap="innerHTML">
  <input name="maxRetries" value="3" />
  <button type="submit">Save</button>
</form>
```

The `/api/*` routes return HTML fragments, not JSON.

### POST handlers: prefer in-place fragment swaps; use `HX-Redirect` only for cross-page navigation

For modal sub-routes (anything under `routes/api/admin/modal/**`) that update a panel within the same modal, **return the refreshed HTML directly** rather than a 3xx redirect:

```ts
// GOOD — re-renders the panel:
return renderTemplatesModal(ctx.req, { activeId: savedId });

// BAD — fragile 303 inside a modal:
return Response.redirect(new URL("/api/admin/modal/..."), 303);
```

**Pattern:** export the modal's GET renderer as a pure function (e.g. `renderTemplatesModal(req, opts)`), then call it from both the GET handler and any POST sub-routes.

`HX-Redirect` **is appropriate** when you legitimately want the browser to navigate to a different page after an action (e.g. "create config" → load the new detail page). The CsvImportWizard finishes with a `location.reload()` for similar reasons. Don't use it inside modals just to refresh the modal — use a re-render instead.

**Exceptions:** `routes/api/login.ts`, `register.ts`, `logout.ts` intentionally use 303 because they're hit by native form POST (no HTMX).

### Polling for long-running work

Run-test-audit and similar long jobs use `hx-trigger="load delay:2s"` self-replacing fragments instead of an island. The kick-off route returns:
```html
<div id="x-status" hx-get="/api/.../status?id=…" hx-trigger="load delay:2s" hx-swap="outerHTML">…</div>
```
The status route either re-emits the same polling fragment (still running) or swaps in a final state (done / error). See `routes/api/qlab/configs/test-status.tsx`.

## When to use a Preact island

Default to HTMX. Use an island only when the UI **physically can't** work without client JS:

- Multi-step modal with local state that you don't want to round-trip on every keystroke (CsvImportWizard, EmailReportEditor, WeeklyBuilderEditor, AppealModal)
- File handling done client-side (FileReader / multipart)
- Native browser audio (`<audio>` controls + canvas waveform — AudioPlayer)
- High-frequency interactive UX (HotkeyHandler, ChatInput, PipelineActivityChart)

If your "needs JS" UX is a spinner + a status update after a POST → use HTMX polling, not an island.

## Pages / Implementation Status
| Page | Route | Status |
|------|-------|--------|
| Login | `/login` | Done |
| Register | `/register` | Done |
| Root | `/` | Done (redirects by role) |
| Admin Dashboard | `/admin/dashboard` | Done — stats, pipeline, errors, queue mgmt, 13 admin modals |
| Admin Users | `/admin/users` | Done — list, add modal, delete |
| Admin Audits | `/admin/audits` | Done — table, record ID search, retry |
| Weekly Builder | `/admin/weekly-builder` | Done — full prod parity (two-pane stage + publish) |
| Review Queue | `/review` | Done — split panel, hotkeys, sounds |
| Review Dashboard | `/review/dashboard` | Done — stats |
| Judge Queue | `/judge` | Done — split panel, overturn reasons |
| Judge Dashboard | `/judge/dashboard` | Done — stats |
| Manager | `/manager` | Done — queue, agents, remediate |
| Agent Dashboard | `/agent` | Done — stats, trend, audit history |
| Chat | `/chat` | Done — conversations, thread, send |
| Question Lab list | `/question-lab` | Done — full-width table, prod parity |
| Question Lab config | `/question-lab/config/[id]` | Done — Settings + Run Test Audit (HTMX polling) + Questions inline-edit |
| Question Lab editor | `/question-lab/question/[id]` | Done — full editor + version history + simulator |
| Store | `/store` | Done — item grid, buy flow |
| Audit Report | `/audit/report` | Done — multi-recording REC tabs, File Appeal, Different Recording reaudit |
| Super Admin | `/super-admin` | Done (gated to `ai@monsterrg.com`) |
| Gamification | `/gamification` | Done |
| 404 | `*` | Done |
| 500 | error | Done |

## Islands (Client JS — keep this list short)
- `AppealModal.tsx` — multi-step appeal/different-recording flow on the audit-report page
- `AudioPlayer.tsx` — waveform `<audio>` player with REC 1 / REC 2 tabs for multi-recording audits
- `ChatInput.tsx` — message input with submit
- `CsvImportWizard.tsx` — 5-step QLab CSV import (upload → map → preview → run → done)
- `EmailReportEditor.tsx` — full Email Reports editor (rule builder + sections + preview iframe)
- `HotkeyHandler.tsx` — keyboard shortcuts for review/judge queue pages
- `ImpersonationBanner.tsx` — golden "ADMIN VIEW" bar; auto-shows for admin on non-admin pages
- `ModalController.tsx` — opens/closes admin modals on `data-modal` clicks; emits `modal-open` event for HTMX `hx-trigger="modal-open"`
- `PipelineActivityChart.tsx` — canvas chart on the admin dashboard
- `SoundEngine.tsx` — Web Audio API for gamification sounds
- `WeeklyBuilderEditor.tsx` — two-pane staging + publish for `/admin/weekly-builder`

## Deploy

**Unified deployment (production)**: single Deno Deploy project; root `main.ts` is the entry; both Fresh and danet share the same process.

**Standalone frontend deployment** (legacy / split mode): root `frontend/`, entry `main.ts`, env `API_URL=https://autobottom-api.thetechgoose.deno.net`. Used for local dev without spinning the backend.

## Shape-Checker
Shape-checker only scans `../src/` — it does NOT scan this directory. Fresh's route/island structure is incompatible with shape-checker's module conventions, so they must remain separate.

## Production Reference

Prod's UI (the original monolithic build) lives on the **`main` branch**. Read with:
```bash
git show main:<path>
```

Key reference files:
- `dashboard/page.ts` — admin dashboard (~5500 lines)
- `shared/queue-page.ts` — review/judge queue (~3500 lines)
- `auth/page.ts` — login/register
- `shared/icons.ts` — SVG icon definitions
- `review/page.ts`, `judge/page.ts`, `agent/page.ts`, `chat/page.ts`, `manager/page.ts`
- `question-lab/page.ts` — list / detail / editor (1087 lines, three exported renderers)
- `question-lab/handlers.ts` — backend route table
- `weekly-builder/page.ts` + `weekly-builder/handlers.ts` — staging UI + publish handlers

Dark theme CSS variables, layouts, and interactive patterns should match production exactly.
