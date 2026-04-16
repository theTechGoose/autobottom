# Autobottom Frontend — Fresh 2 + HTMX

## What This Is
A Deno Fresh 2 SSR frontend for the autobottom QA auditing platform. Almost no client-side logic — the server renders everything, the browser is a dumb terminal. HTMX handles partial page updates without writing JavaScript.

## Architecture

### Stack
- **Deno Fresh 2** (RC) — SSR framework, file-system routing, Preact components
- **HTMX** (2.0.4, CDN) — partial page updates via HTML fragment swaps
- **Preact Islands** — only for things that physically require client JS (hotkeys, audio, chat input)
- **Backend API** — separate danet project at `../autobottom/`, env var `API_URL` points to it

### Key Patterns
- **API Client** (`lib/api.ts`): `apiFetch(path, req)` forwards the session cookie to the backend
- **Auth Middleware** (`routes/_middleware.ts`): calls `/admin/api/me` to resolve user, injects into `ctx.state.user`, redirects to `/login` if unauthenticated
- **Shared Define** (`lib/define.ts`): `createDefine<State>()` gives typed `define.page`, `define.handlers`, `define.middleware`, `define.layout`
- **HTMX Fragment Routes** (`routes/api/*`): return HTML fragments (not full pages) for HTMX swaps — fetch JSON from backend, render Preact component, return `text/html`
- **Layout + Sidebar** (`components/Layout.tsx`, `components/Sidebar.tsx`): shared page shell with 280px sidebar, dark theme, role-aware nav

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
├── main.ts                # Entry point
├── lib/                   # Shared utilities
│   ├── api.ts             # API client with cookie forwarding
│   ├── auth.ts            # Types, role redirects, public paths
│   ├── define.ts          # createDefine<State>()
│   └── theme.ts           # Per-role accent colors
├── components/            # Server-rendered Preact components
├── islands/               # Client-side interactive components (minimal)
├── routes/                # File-system routes
│   ├── _app.tsx           # Root layout
│   ├── _middleware.ts     # Auth middleware
│   ├── api/               # HTMX fragment endpoints
│   └── <section>/         # Page routes
├── static/                # CSS, favicon, sounds
└── tests/                 # Test files
```

## Running Locally
```bash
# Start backend first
cd ../autobottom && deno task dev

# Then frontend (in a separate terminal)
cd frontend && deno task dev
# → http://localhost:8000
```

The frontend runs on port 8000, backend on port 3000. `API_URL` defaults to `http://localhost:3000`.

## Commands
```bash
deno task dev      # Development with watch
deno task start    # Production start
deno task check    # Type check
deno task test     # Run tests
```

## Auth Flow
1. User hits any protected route → middleware calls `GET {API_URL}/admin/api/me` with the session cookie
2. If authenticated → `ctx.state.user` is set, page renders
3. If not → redirect to `/login`
4. Login form posts to `/api/login` → proxies to backend `/login` → sets `Set-Cookie` from response → redirects to role-appropriate dashboard
5. Logout hits `/api/logout` → clears cookie → redirects to `/login`

## HTMX Pattern
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

### CRITICAL: HTMX POST handlers must return HTML directly — NEVER use HTTP redirects.

HTMX endpoints (anything under `routes/api/admin/modal/**/*.tsx` and similar HTMX-targeted routes) must return the updated HTML as the POST response body. Do NOT use `Response.redirect(...)` or `HX-Redirect` headers.

**Why:** HTMX follows 3xx redirects via browser XHR, but the follow-up GET loses HTMX context in subtle ways. The correct pattern is to directly render and return the updated view's HTML as the POST response body.

**Pattern:** Extract the modal's GET render into an exported function (e.g. `renderTemplatesModal(req, opts)`), then call it from both the GET handler and any POST save/delete sub-routes.

```ts
// GOOD:
return renderTemplatesModal(ctx.req, { activeId: savedId });

// BAD — fragile 303 redirect:
return Response.redirect(new URL("/api/admin/modal/...", ctx.req.url), 303);

// BAD — breaks out of modal with full page navigation:
return new Response(null, { headers: { "HX-Redirect": "/api/..." } });
```

**Exceptions:** `routes/api/login.ts`, `register.ts`, `logout.ts` intentionally use 303 because they're hit by native form POST (no HTMX).

## Pages / Implementation Status
| Page | Route | Status |
|------|-------|--------|
| Login | `/login` | Done |
| Register | `/register` | Done |
| Root | `/` | Done (redirects by role) |
| Admin Dashboard | `/admin/dashboard` | Done — stats, pipeline, errors, queue mgmt |
| Admin Users | `/admin/users` | Done — list, add modal, delete |
| Admin Audits | `/admin/audits` | Done — table, record ID search, retry |
| Weekly Builder | `/admin/weekly-builder` | Placeholder |
| Review Queue | `/review` | Done — split panel, hotkeys, sounds |
| Review Dashboard | `/review/dashboard` | Done — stats |
| Judge Queue | `/judge` | Done — split panel, overturn reasons |
| Judge Dashboard | `/judge/dashboard` | Done — stats |
| Manager | `/manager` | Done — queue, agents, remediate |
| Agent Dashboard | `/agent` | Done — stats, trend, audit history |
| Chat | `/chat` | Done — conversations, thread, send |
| Question Lab | `/question-lab` | Done — config list, editor shell |
| Store | `/store` | Done — item grid, buy flow |
| 404 | `*` | Done |
| 500 | error | Done |

## Islands (Client JS — minimal)
- `HotkeyHandler.tsx` — keyboard shortcuts for review/judge queue pages
- `SoundEngine.tsx` — Web Audio API for gamification sounds
- `ChatInput.tsx` — message input with submit

## Deploy
Separate Deno Deploy project, same repo:
- Root directory: `frontend/`
- Entry point: `main.ts`
- Env var: `API_URL=https://autobottom-api.thetechgoose.deno.net`

## Shape-Checker
Shape-checker only scans `../autobottom/` — it does NOT scan this directory. Fresh's route/island structure is incompatible with shape-checker's module conventions, so they must remain separate.

## Production Reference
The UI we're replicating lives on the `main` branch at `../autobottom/`. Key reference files (read with `git show main:<path>`):
- `dashboard/page.ts` — admin dashboard (~5500 lines)
- `shared/queue-page.ts` — review/judge queue (~3500 lines)
- `auth/page.ts` — login/register
- `shared/icons.ts` — SVG icon definitions
- `review/page.ts`, `judge/page.ts`, `agent/page.ts`, `chat/page.ts`, `manager/page.ts`

Dark theme CSS variables, layouts, and interactive patterns should match production exactly.
