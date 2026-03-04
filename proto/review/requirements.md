# Review Queue Feature -- Requirements

Exact 1:1 copy of the existing review feature in `../../review/`.

---

## Overview

A human-review queue where reviewers triage AI audit findings that were answered "No." Each
"No" answer becomes a review item. Reviewers either **confirm** the "No" (agree with the AI)
or **flip** it to "Yes" (override the AI). Once every item in an audit is decided, the
corrected audit fires a webhook and escalates to the manager queue.

---

## Data Model

### ReviewItem
Represents a single question from a finding that needs human review.

| Field           | Type     | Description                                       |
|-----------------|----------|---------------------------------------------------|
| `findingId`     | `string` | Parent finding/audit ID                           |
| `questionIndex` | `number` | Index of the question within the finding          |
| `header`        | `string` | Short label for the question (e.g. "Greeting")    |
| `populated`     | `string` | Full question text (populated template)           |
| `thinking`      | `string` | AI's reasoning for the "No" answer                |
| `defense`       | `string` | AI's defense/justification for its answer         |
| `answer`        | `string` | Original answer (always `"No"` for review items)  |

### ReviewDecision (extends ReviewItem)
Created when a reviewer decides on an item.

| Field       | Type                    | Description                          |
|-------------|------------------------|--------------------------------------|
| `decision`  | `"confirm" \| "flip"`  | Reviewer's decision                  |
| `reviewer`  | `string`               | Reviewer's email                     |
| `decidedAt` | `number`               | Unix timestamp (ms) of the decision  |

---

## KV Key Schema (all org-scoped)

| Key Pattern                                        | Value             | Purpose                              |
|----------------------------------------------------|-------------------|--------------------------------------|
| `[orgId, "review-pending", findingId, qIdx]`       | `ReviewItem`      | Pending review items                 |
| `[orgId, "review-decided", findingId, qIdx]`       | `ReviewDecision`  | Completed decisions                  |
| `[orgId, "review-lock", findingId, qIdx]`          | `{claimedBy, claimedAt}` | Optimistic lock (30 min TTL) |
| `[orgId, "review-audit-pending", findingId]`       | `number`          | Count of remaining items per audit   |

---

## Queue Population

### `populateReviewQueue(orgId, findingId, answeredQuestions)`
- Filter `answeredQuestions` to only those with `answer === "No"`
- Write each as a `ReviewItem` under `review-pending`
- Set `review-audit-pending` counter to the count of "No" answers
- Called by the audit pipeline when a finding finishes

### `backfillFromFinished(orgId)`
- Scan all `audit-finding` keys for findings with `findingStatus === "finished"`
- Skip findings that already have `review-audit-pending` or `review-decided` entries
- Populate review queue for any missing findings
- Returns `{ queued: number }`

---

## Claim / Lock Semantics

### `claimNextItem(orgId, reviewer)`
- Iterate all `review-pending` items
- For the first unclaimed item, attempt an atomic compare-and-swap to acquire a lock
  - Lock key: `review-lock` with 30-minute TTL
  - Lock value: `{ claimedBy: reviewer, claimedAt: now }`
- Also find the next unlocked item as `peek` (preview of what's next)
- Count total `remaining` pending items
- Load the `transcript` (raw + diarized) for the claimed finding
- Load `auditRemaining` (how many items left in this specific audit)
- Returns `{ current, transcript, peek, remaining, auditRemaining }`

---

## Decision Recording

### `recordDecision(orgId, findingId, questionIndex, decision, reviewer, combo?, level?, speedMs?)`
1. Verify the lock is owned by this reviewer (or expired). Reject if owned by another.
2. Load the pending item. Reject if missing.
3. Atomic commit:
   - Check pending entry versionstamp (prevent double-decide)
   - Delete lock key
   - Delete pending key
   - Write `ReviewDecision` to `review-decided`
   - Decrement `review-audit-pending` counter (delete key if reaches 0)
4. If audit is now complete (counter hit 0):
   - Fire `postCorrectedAudit` in background (webhook)
   - Call `populateManagerQueue` in background (escalation)
5. Update badge stats, check for new badges, award XP (10 per decision + badge bonus)
6. Returns `{ success, auditComplete, newBadges }`

### Corrected Audit Webhook (`postCorrectedAudit`)
- Load original finding + all answers
- Load all `review-decided` entries for the finding
- Apply flips: change `answer` from `"No"` to `"Yes"` on flipped items
- Add `reviewedBy` and `reviewAction` metadata to each reviewed answer
- Fire the `"terminate"` webhook with the corrected payload

---

## Undo (Go Back)

### `undoDecision(orgId, reviewer)`
1. Release any current lock held by this reviewer
2. Find the most recent `review-decided` entry by this reviewer (by `decidedAt`)
3. Atomic commit:
   - Delete the decided entry
   - Restore it as a `review-pending` item
   - Increment `review-audit-pending` counter
   - Re-acquire lock on the restored item (30-min TTL)
4. Load transcript and peek for the restored item
5. Returns `{ restored, transcript, peek, remaining, auditRemaining }`

---

## HTTP API

All endpoints require auth via `resolveEffectiveAuth(req)`. Returns 401 if unauthenticated.

| Method | Path                      | Handler                   | Description                              |
|--------|---------------------------|---------------------------|------------------------------------------|
| GET    | `/review`                 | `handleReviewPage`        | Serve review queue UI (HTML)             |
| POST   | `/review/api/next`        | `handleNext`              | Claim next pending item                  |
| POST   | `/review/api/decide`      | `handleDecide`            | Record a decision (confirm/flip)         |
| POST   | `/review/api/back`        | `handleBack`              | Undo last decision                       |
| GET    | `/review/api/settings`    | `handleGetSettings`       | Get webhook config for "terminate"       |
| POST   | `/review/api/settings`    | `handleSaveSettings`      | Save webhook config for "terminate"      |
| GET    | `/review/api/stats`       | `handleStats`             | Queue stats (pending + decided counts)   |
| POST   | `/review/api/backfill`    | `handleBackfill`          | Backfill queue from finished findings    |
| GET    | `/review/dashboard`       | `handleReviewDashboardPage` | Dashboard UI (HTML)                   |
| GET    | `/review/api/dashboard`   | `handleReviewDashboardData` | Dashboard data (JSON)                 |
| GET    | `/review/api/me`          | `handleReviewMe`          | Current user info `{ username, role }`   |

### POST `/review/api/decide` -- Request Body

```json
{
  "findingId": "string",
  "questionIndex": 0,
  "decision": "confirm | flip",
  "combo": 5,
  "level": 2,
  "speedMs": 3200
}
```

`combo`, `level`, `speedMs` are optional gamification fields from the client.

### POST `/review/api/decide` -- Response

```json
{
  "decided": { "findingId": "...", "questionIndex": 0, "decision": "confirm" },
  "auditComplete": false,
  "next": { "current": {...}, "transcript": {...}, "peek": {...}, "remaining": 12, "auditRemaining": 3 },
  "newBadges": [{ "id": "rev_first_blood", "name": "First Blood", "tier": "common", ... }]
}
```

The decide endpoint auto-claims the next item so the client doesn't need a separate `/next` call.

---

## Dashboard

### Data Endpoint (`handleReviewDashboardData`)
Returns `ReviewerDashboardData`:

```typescript
{
  queue: { pending: number; decided: number };
  personal: {
    totalDecisions: number;
    confirmCount: number;
    flipCount: number;
    avgDecisionSpeedMs: number;  // avg gap between consecutive decisions
  };
  byReviewer: Array<{
    reviewer: string;
    decisions: number;
    confirms: number;
    flips: number;
    flipRate: string;  // e.g. "12.5%"
  }>;
  recentDecisions: ReviewDecision[];  // last 50, most recent first
}
```

### Dashboard UI
- Dark theme, sidebar layout with nav links (Review Queue, Dashboard, Chat, Store)
- Sidebar footer shows current user email + avatar initial + logout button
- Top stat cards: Queue Pending, Queue Decided, My Decisions, Confirm Rate, Flip Rate, Avg Speed
- Reviewer Performance table: leaderboard sorted by total decisions (current user row highlighted)
- Recent Decisions table: date, finding ID (truncated), question index, decision pill, header
- Badge Showcase grid: shows all reviewer badges as earned/locked
- Auto-refreshes every 15 seconds

---

## Review Queue UI (Page)

- Generated by the shared `generateQueuePage("review", gamificationJson)` function
- Gamification config is resolved server-side and embedded as JSON for the client
- Includes sound pack registry (per-org sound packs with slot URLs)

---

## Gamification Integration

- Each decision awards **10 XP** base + any badge bonus XP
- Badge stats tracked per reviewer: `totalDecisions`, `bestCombo`, `level`, `avgSpeedMs`,
  `decisionsForAvg`, `dayStreak`, `lastActiveDate`
- Day streak increments if `lastActiveDate` was yesterday; resets to 1 otherwise
- New badges are checked after every decision and returned in the response
- Client sends `combo`, `level`, `speedMs` with each decision for stat tracking
- `emitEvent(orgId, email, "review-decided", ...)` fires when an audit's review is fully complete

### Reviewer Badges

| ID               | Name           | Tier      | Condition                          |
|------------------|----------------|-----------|------------------------------------|
| `rev_first_blood`| First Blood    | common    | 1 review completed                 |
| `rev_centurion`  | Centurion      | uncommon  | 100 reviews                        |
| `rev_grinder`    | The Grinder    | rare      | 1,000 reviews                      |
| `rev_speed_demon`| Speed Demon    | uncommon  | Avg under 8s per decision (50+ done)|
| `rev_streak_7`   | Week Warrior   | uncommon  | 7-day streak                       |
| `rev_streak_30`  | Iron Will      | rare      | 30-day streak                      |
| `rev_combo_10`   | Combo Breaker  | uncommon  | 10x combo                          |
| `rev_combo_20`   | Unstoppable    | rare      | 20x combo                          |
| `rev_combo_50`   | Beyond Godlike | epic      | 50x combo                          |
| `rev_level_10`   | Max Level      | legendary | Reach level 10                     |

---

## External Dependencies

| Module                  | What's used                                                        |
|-------------------------|--------------------------------------------------------------------|
| `../lib/org.ts`         | `orgKey()`, `OrgId` type                                           |
| `../lib/kv.ts`          | Webhook CRUD, gamification settings, sound packs, badge stats/XP, finding data, transcript, event emitter |
| `../auth/kv.ts`         | `resolveEffectiveAuth()`, `getUser()`, `AuthContext`               |
| `../manager/kv.ts`      | `populateManagerQueue()` -- escalation on audit completion         |
| `../shared/badges.ts`   | `checkBadges()`, `BADGE_CATALOG`, `BadgeDef`                      |
| `../shared/queue-page.ts` | `generateQueuePage("review", gamificationJson)`                  |
| `../shared/icons.ts`    | SVG icon constants for dashboard sidebar                           |

---

## Seed / Test Data (`seed-test.ts`)

- Creates 2 fake findings with 10 questions each (mix of Yes/No answers)
- Uses a realistic multi-turn call center transcript
- Populates `review-pending` with all "No" items (6 per finding = 12 total)
- Sets `review-audit-pending` counters
- Demonstrates the full data shape expected by the review queue
