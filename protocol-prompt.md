# UI Simulation Protocol — Reproduce Bugs from Prod on Staging

## Purpose

When a user reports a bug in the browser UI, this protocol:
1. Captures the full backend state from production
2. Imports it into a staging environment
3. Reverse-engineers the exact API call sequence the frontend makes
4. Replays those calls on staging to reproduce the bug

## Inputs

| Input | Required | Example |
|---|---|---|
| `PROD_URL` | yes | `https://autobottom.thetechgoose.deno.net` |
| `STAGING_URL` | yes | `https://autobottom-staging.thetechgoose.deno.net` |
| `ADMIN_CREDS` | yes | `{ email, password }` for an admin account on both environments |
| `USER_CREDS` | yes | Array of `{ email, password }` pairs (one per simulated user) |
| `ROLE` | yes | `reviewer` or `judge` |

---

## Phase 1: Capture Production State

### 1.1 Authenticate as admin on prod

```bash
PROD=<PROD_URL>

curl -s -c /tmp/admin-prod.cookies -X POST "$PROD/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"<ADMIN_EMAIL>","password":"<ADMIN_PASS>"}'
```

Verify: `{"ok":true,"role":"admin",...}`

### 1.2 Dump state

```bash
curl -s -b /tmp/admin-prod.cookies -X POST "$PROD/admin/dump-state" \
  -H "Content-Type: application/json" \
  > /tmp/prod-state.json
```

This returns all queue-related KV entries for the admin's org:
- `review-pending`, `review-active`, `review-decided`, `review-audit-pending`
- `judge-pending`, `judge-active`, `judge-decided`, `judge-audit-pending`
- `manager-queue`, `manager-remediation`
- `finding`, `transcript`, `appeal`
- `user` (so reviewer/judge accounts exist on staging)

### 1.3 Verify the dump

```bash
python3 -c "
import json
with open('/tmp/prod-state.json') as f:
    d = json.loads(f.read(), strict=False)
print(f'Org: {d[\"orgId\"]}')
print(f'Entries: {len(d[\"entries\"])}')
print(f'Exported at: {d[\"exportedAt\"]}')
# Count by prefix
from collections import Counter
prefixes = Counter()
for e in d['entries']:
    prefixes[e['key'][1]] += 1
for k, v in prefixes.most_common():
    print(f'  {k}: {v}')
"
```

---

## Phase 2: Import State to Staging

### 2.1 Authenticate as admin on staging

```bash
STAGING=<STAGING_URL>

curl -s -c /tmp/admin-staging.cookies -X POST "$STAGING/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"<ADMIN_EMAIL>","password":"<ADMIN_PASS>"}'
```

### 2.2 Import the dump

The import endpoint:
- Clears all existing queue state on the staging org (pending, active, decided, locks)
- Writes every entry from the dump
- Automatically remaps `orgId` if the staging org ID differs from prod

```bash
curl -s -b /tmp/admin-staging.cookies -X POST "$STAGING/admin/import-state" \
  -H "Content-Type: application/json" \
  -d @/tmp/prod-state.json
```

Verify: `{"ok":true,"cleared":N,"written":M}`

### 2.3 Verify staging state matches prod

```bash
curl -s -b /tmp/admin-staging.cookies -X POST "$STAGING/admin/dump-state" \
  -H "Content-Type: application/json" \
  > /tmp/staging-state.json

python3 -c "
import json
with open('/tmp/prod-state.json') as f:
    prod = json.loads(f.read(), strict=False)
with open('/tmp/staging-state.json') as f:
    staging = json.loads(f.read(), strict=False)
print(f'Prod entries:    {len(prod[\"entries\"])}')
print(f'Staging entries: {len(staging[\"entries\"])}')
"
```

---

## Phase 3: Discover the UI Flow from Source

Before making any API calls, read the frontend source to understand the **exact** sequence of requests a user session makes. Do NOT guess — the UI may prefetch, cache, or swap items in ways that differ from a naive "call /next, call /decide" loop.

### What to look for

1. **Page load initialization** — Find the IIFE or `DOMContentLoaded` handler. What endpoint does it call first? (`/review/api/next`, `/judge/api/next`, etc.)

2. **Response shape** — What fields does the init call return?
   - `current` — the item displayed on screen
   - `peek` — a prefetched next item (displayed instantly on user action, before the network round-trip)
   - `transcript` — associated data loaded alongside the item
   - `remaining`, `auditRemaining` — counters

3. **Decision flow** — When the user clicks Y/N:
   - Does the UI **optimistically swap** to `peek` before the fetch fires? (Look for `currentItem = peekItem` before the `fetch('/decide')` call)
   - What does the `/decide` response return? (`next.current`, `next.peek`)
   - How does the UI reconcile the optimistic swap with the server response?

4. **Error handling** — What happens on 409 (conflict)? Does it call `/next` again?

5. **Other implicit calls** — Does the page call `/stats`, `/me`, `/dashboard` that might affect server state?

### Key source files

| File | Contains |
|---|---|
| `shared/queue-page.ts` | Review + judge queue UI (decide, peek swap, init) |
| `review/handlers.ts` | Review API route handlers |
| `judge/handlers.ts` | Judge API route handlers |
| `review/kv.ts` | Review queue operations (claim, decide, undo) |
| `judge/kv.ts` | Judge queue operations |
| `main.ts` | Route table (grep for `/review/api/` or `/judge/api/`) |

### Route reference

**Review (reviewer role):**
| Method | Path | Purpose |
|---|---|---|
| GET | `/review/api/next` | Claim next item + peek, return with transcript |
| POST | `/review/api/decide` | Record decision, return next item + peek |
| POST | `/review/api/back` | Undo last decision |
| GET | `/review/api/stats` | Queue stats |
| GET | `/review/api/me` | Current user info |
| GET | `/review/api/dashboard` | Dashboard data |

**Judge (judge role):**
| Method | Path | Purpose |
|---|---|---|
| GET | `/judge/api/next` | Claim next item + peek, return with transcript |
| POST | `/judge/api/decide` | Record decision, return next item + peek |
| POST | `/judge/api/back` | Undo last decision |
| GET | `/judge/api/stats` | Queue stats |
| GET | `/judge/api/me` | Current user info |

**Admin:**
| Method | Path | Purpose |
|---|---|---|
| POST | `/admin/dump-state` | Export all queue/finding/user KV entries as JSON |
| POST | `/admin/import-state` | Clear queue state and import entries (with orgId remap) |
| POST | `/admin/clear-review-queue` | Clear only the review queue |

**Auth:**
| Method | Path | Body |
|---|---|---|
| POST | `/login` | `{"email":"...","password":"..."}` (JSON) |

---

## Phase 4: Simulate the UI on Staging

### 4.1 Authenticate simulated users on staging

```bash
curl -s -c /tmp/user1.cookies -X POST "$STAGING/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"<EMAIL_1>","password":"<PASS_1>"}'

curl -s -c /tmp/user2.cookies -X POST "$STAGING/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"<EMAIL_2>","password":"<PASS_2>"}'
```

### 4.2 Run the flow — sequentially, not concurrently

The goal is to mimic **two humans on two computers**. Run calls **sequentially** in the order a real user would experience them.

```
USER1 opens page    → GET /review/api/next     → receives {current: A, peek: B}
USER2 opens page    → GET /review/api/next     → receives {current: C, peek: D}

CHECK: A, B, C, D must all be unique items.

USER1 clicks Y on A → POST /review/api/decide  → UI swaps to B, response has {next: {current: B, peek: E}}
USER2 clicks Y on C → POST /review/api/decide  → UI swaps to D, response has {next: {current: D, peek: F}}

CHECK: B, D, E, F must all be unique items.
       B and D (what the users SEE on screen) must be different.

USER1 clicks Y on B → POST /review/api/decide  → UI swaps to E, response has {next: {current: E, peek: G}}
USER2 clicks Y on D → POST /review/api/decide  → UI swaps to F, response has {next: {current: F, peek: H}}

CHECK: E, F, G, H must all be unique.
       E and F (what the users SEE) must be different.

... repeat for N rounds ...
```

### 4.3 What to track at each step

For every API response, extract and log:
- `findingId` + `questionIndex` for both `current` and `peek`
- The `header` field (human-readable question name)

### 4.4 Duplicate detection

At every step, collect ALL items currently held by ALL users (current + peek per user). Every item must be unique. A duplicate means both users will see the same question on screen.

The **critical comparison**: does USER1's peek (which the UI shows instantly on Y click) match USER2's current or peek?

---

## Phase 5: Analyze Results

### If duplicates found

1. Identify which item is duplicated and at which step
2. Trace back to the server code — is the duplicated item being **claimed** (atomically removed from the shared pool) or just **read** (still in the pool for others)?
3. Common root causes:
   - **Peek not claimed**: Prefetched item is read but not atomically dequeued. Another user can claim it.
   - **Race between claim and display**: Item is claimed but the claim can be overwritten.
   - **Cache/stale data**: UI shows a cached item already decided by someone else.

### If no duplicates after N rounds

The specific flow is clean. Also test:
- Both users opening the page at the exact same time (parallel `/next` calls)
- One user refreshing the page mid-session
- One user going back (undo) while the other advances
- Edge case: last item in queue

---

## Phase 6: Save Results

Write a JSON trace file:

```json
{
  "timestamp": "2026-03-12T14:00:00Z",
  "prod_url": "https://...",
  "staging_url": "https://...",
  "users": ["user1@...", "user2@..."],
  "prod_state": {
    "orgId": "...",
    "entry_count": 150,
    "review_pending": 40,
    "review_decided": 20
  },
  "rounds": [
    {
      "step": "user1_open_page",
      "endpoint": "GET /review/api/next",
      "current": {"findingId": "...", "questionIndex": 0, "header": "..."},
      "peek": {"findingId": "...", "questionIndex": 1, "header": "..."}
    },
    {
      "step": "user2_open_page",
      "endpoint": "GET /review/api/next",
      "current": {"findingId": "...", "questionIndex": 2, "header": "..."},
      "peek": {"findingId": "...", "questionIndex": 3, "header": "..."}
    },
    {
      "step": "user1_decide_confirm",
      "endpoint": "POST /review/api/decide",
      "decided": {"findingId": "...", "questionIndex": 0},
      "ui_showing": {"findingId": "...", "questionIndex": 1, "header": "..."},
      "new_peek": {"findingId": "...", "questionIndex": 4, "header": "..."}
    }
  ],
  "duplicates_found": false,
  "duplicate_details": []
}
```

---

## Notes

- Always use **JSON** content type for POST requests (not form-encoded).
- Parse responses with `strict=False` in Python's `json.loads()` — transcript text may contain control characters.
- The `/decide` endpoint returns the next item inline (`data.next.current` and `data.next.peek`), so you don't need a separate `/next` call after deciding.
- The decide body requires: `{"findingId": "...", "questionIndex": N, "decision": "confirm"}` (or `"flip"`).
- Cookie files (`-c` and `-b` flags) maintain session state between requests.
- The dump can be large (transcripts contain full text). For faster iteration, you can filter to queue entries only when importing.
- The import endpoint remaps `orgId` automatically — prod and staging can have different org IDs.
