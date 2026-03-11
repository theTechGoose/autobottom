# Expression Builder Redesign — Pickup Context

## What this app is
A "question builder" for call center QA. You define conditions that evaluate agent call transcripts. The app has:
- **Header**: question name, version pill, status pill
- **Composer**: text input where you type conditions in plain English, parsed in real-time
- **Conditions list**: cards showing each condition (AI-evaluated or instant/expression-based), with OR groups
- **Bottom panels**: Coverage (category bars), Tests (run test cases against conditions), Cost (per-eval + monthly estimate)

## Files
- `index.html` — single-file frontend (HTML + CSS + JS). All render functions target DOM IDs: `pageHeader`, `composer`, `conditions`, `panels`
- `backend.ts` — Deno backend with Deno KV. Endpoints: `/seed`, `/api/questions`, `/api/parse`, `/api/questions/:id/conditions`, `/api/questions/:id/test`, etc.

## What the user wants
1. **Everything above the fold** — the current layout is a single 720px column that pushes the panels (coverage/tests/cost) below the fold. User hates scrolling to see important info.
2. **Two-column or multi-panel layout** — conditions and panels should be visible side-by-side simultaneously. Use horizontal space.
3. **Better UI/UX overall** — the user explicitly said "i hate the layout" and wants genuinely better design, not a reskin.
4. **No generic AI aesthetics** — avoid Inter, purple gradients, cookie-cutter layouts.

## What was attempted
A full rewrite of `index.html` was done with:
- Two-column grid layout (`grid-template-columns: 1fr 380px`)
- `100vh` app container with flex column + grid
- Left col: composer + scrollable conditions list
- Right col: panels (coverage/tests/cost)
- Compact header as a top bar instead of centered hero
- DM Sans + Instrument Serif fonts, warm earthy palette (#f5f4f0 bg)
- Tighter spacing throughout

**The problem**: The rewritten file exists on disk but the demoer served the cached/old version. The two-column layout never actually rendered in the browser. The user saw the exact same single-column layout twice and is (rightfully) pissed.

## How to verify the fix works
- Kill any leftover processes on port 8000 (`lsof -ti :8000 | xargs kill -9`)
- Restart the demoer fresh, or just run `deno run --allow-all --unstable-kv backend.ts` and open `index.html` directly
- The HTML structure should have `<div class="main-grid">` wrapping a `.left-col` and `.right-col`
- Confirm the two-column layout renders and everything fits in viewport

## Key constraints
- All JS render functions (`renderHeader`, `renderComposer`, `renderConditions`, `renderPanels`, etc.) target specific DOM IDs — the HTML structure must keep those IDs
- The `panels` div must have a click listener delegate for tab switching (attached at bottom of script)
- Backend doesn't need changes — only the frontend HTML/CSS/layout
