# Bugfix Report & QA Verification Guide

**Date:** 2026-03-11
**Source:** Email from Alexander Allard (alexandera@monsterrg.com) — "Bugs/Suggestions Autobottom"
**RCA Document:** issues.rca.md

---

## Summary

7 bugs were reported. All 7 have been fixed.

| #   | Bug                                   | Severity | Status                |
| --- | ------------------------------------- | -------- | --------------------- |
| 1   | Reviewers/judges get same question    | Critical | FIXED                 |
| 2   | Y/N buttons need double-click         | High     | FIXED                 |
| 3   | UI stuck after 409, must back out     | High     | FIXED (via FIX-2)     |
| 4   | Audio seek resets to 0 seconds        | Medium   | FIXED (lazy backfill) |
| 5   | "Final for Audit" badge hangs ~2s     | Low      | FIXED                 |
| 6   | Judge dashboard reviewer emails blank | Medium   | FIXED                 |
| 7   | Confusing stats (questions vs audits) | Low      | FIXED                 |

---

## FIX-1: Lock Race Condition (BUG-1)

### What was wrong

Two reviewers (or judges) calling `/next` at the same time could be assigned the **same question**. The atomic check-and-set (CAS) in `claimNextItem()` only verified the lock's versionstamp hadn't changed — it never checked if the lock was already held by someone else. Reviewer B could overwrite Reviewer A's lock.

Reproduced at 60% duplicate rate for reviewers (9/15 rounds) and 100% for judges (15/15 rounds).

Additionally, `judge/kv.ts` `recordDecision()` was missing `.check(pendingEntry)` on its atomic commit, allowing two judges to double-decide the same question. The judge handler also ran `recordDecision` and `claimNextItem` in `Promise.all`, meaning the next item could be claimed before the decision was committed.

### What was changed

**File: `review/kv.ts` — `claimNextItem()` (~line 121)**

Added a guard before the atomic CAS:

- If the lock is held by someone else → skip this item, try the next one
- If the lock is held by the current reviewer (page refresh) → reclaim it without CAS
- If the lock is null → proceed with atomic CAS as before

**File: `judge/kv.ts` — `claimNextItem()` (~line 128)**

Same guard applied as review/kv.ts above.

**File: `judge/kv.ts` — `recordDecision()` (~line 240)**

Added `.check(pendingEntry)` to the atomic commit to prevent two judges from double-deciding the same question. This matches the pattern already used in `review/kv.ts`.

**File: `judge/handlers.ts` (~line 87)**

Changed `Promise.all([recordDecision, claimNextItem])` to sequential execution. The decision now commits before the next item is claimed.

### QA Verification Steps

1. **Two reviewers, same time:** Open two browser sessions (or use incognito) logged in as `reviewer@monsterrg.com` and `reviewer2@monsterrg.com`. Click into the review queue at the same time. Both should get **different** questions.
2. **Two judges, same time:** Same test with two judge sessions. Both should get **different** questions.
3. **Page refresh reclaim:** Log in as a reviewer, get a question, refresh the page. The **same** question should reappear (not a new one).
4. **Double-decide prevention:** Have two judge sessions viewing the same question. One decides first. The second should get a 409 error and auto-advance to the next question (see FIX-2).

---

## FIX-2 + FIX-3: Silent Button Drops & Stuck UI (BUG-2 + BUG-3)

### What was wrong

When a reviewer clicks Y/N and the server returns a 409 (conflict — question already decided by someone else), nothing happened. No toast, no error message, no visual feedback. The click was silently swallowed. Buttons stayed fully clickable at full opacity.

Worse: the UI got **stuck** on the same question forever. Every subsequent click re-submitted the same already-decided item, getting 409 each time. The only escape was navigating back to the dashboard.

### What was changed

**File: `shared/queue-page.ts` — `executeDecision()` (~line 1736)**

Added visual disabled state on decide buttons when `busy = true`:

- All `.decide-btn` elements get `opacity: 0.5` and `pointerEvents: none`
- Re-enabled in both `.then()` and `.catch()` callbacks after `busy = false`

**File: `shared/queue-page.ts` — 409 handler (~line 1775)**

Replaced silent `busy = false; return;` with:

1. Toast message: "Already decided — loading next item"
2. Auto-fetch of `/next` to get the next undecided question
3. If next item exists → render it. If queue is empty → show empty state.

This also fully resolves BUG-3 (stuck UI) since the 409 handler now advances the queue.

### QA Verification Steps

1. **Button disabled state:** Click a Y/N button and watch — buttons should visually dim (reduced opacity) during the network request, then re-enable after the response.
2. **Rapid double-click:** Quickly double-click a Y/N button. The second click should be visually blocked (button appears disabled), not silently ignored.
3. **409 recovery:** Reproduce BUG-1 scenario (two reviewers on same question — now harder with FIX-1, but can be tested by manually expiring a lock in KV). When one reviewer decides and the other clicks Y/N:
   - A toast should appear: "Already decided — loading next item"
   - The UI should automatically advance to the next question
   - The reviewer should NOT need to back out to the dashboard
4. **Empty queue after 409:** If the 409 occurs on the last item in the queue, the empty state should render ("No items remaining" or equivalent).

---

## FIX-4: Audio Seek Resets to 0 Seconds (BUG-4)

### What was wrong

Using `/` search and pressing Enter or `;` to jump through transcript matches always reset the audio to 0 seconds instead of seeking to the matched line's position.

### Root Cause

Existing transcripts in KV were processed before the `utteranceTimes` feature was added to the pipeline. The pipeline code (`poll-transcript.ts` → `transcribe-cb.ts` → `saveTranscript()`) correctly extracts and persists `utteranceTimes` from AssemblyAI for new transcriptions, but old transcripts simply didn't have this data.

### What was changed

**File: `lib/kv.ts` — new `backfillUtteranceTimes()` function (after line 391)**

Added a lazy backfill function that:

1. Checks if a transcript is missing `utteranceTimes`
2. Looks up the finding's `assemblyAiTranscriptId`
3. Re-fetches the completed transcript from AssemblyAI
4. Extracts utterance start times via `processTranscriptResult()`
5. Persists them to KV so subsequent loads are instant

**File: `review/kv.ts` — `claimNextItem()` and `restoreItem()`**

After fetching a transcript, calls `backfillUtteranceTimes()` if `utteranceTimes` is missing. This means old transcripts get backfilled on-demand as reviewers work through the queue.

**File: `judge/kv.ts` — `claimNextItem()` and `restoreItem()`**

Same backfill call added for the judge queue.

### QA Verification Steps

1. Open the review queue, navigate to any question. Open browser DevTools Network tab.
2. The `/next` API response should include `transcript.utteranceTimes` as an array of numbers (milliseconds).
3. Use `/` search in the transcript, press Enter to jump to a match. Audio should seek to the correct position (not 0).
4. Reload the page — the second load should be instant (utteranceTimes now persisted in KV).
5. If a transcript's AssemblyAI data has expired (unlikely but possible), the proportional fallback still works.

---

## FIX-5: "Final for Audit" Badge Hangs After Submit (BUG-5)

### What was wrong

When clicking YES on the last question of an audit, the "Final for Audit" badge stayed visible for ~2 seconds until the `/decide` API response returned. The variable `currentAuditRemaining` only updated inside the `.then()` callback after the network round-trip.

### What was changed

**File: `shared/queue-page.ts` — `executeDecision()`**

Added an optimistic hide immediately after `busy = true`, before the fetch call:

```js
var mLastOpt = document.getElementById("m-last");
if (mLastOpt) mLastOpt.style.display = "none";
```

The badge hides instantly on click. When the API response arrives, `renderCurrent()` sets the badge correctly for the next item (re-shows it if the next item is also the last in its audit).

### QA Verification Steps

1. Navigate the review queue to the **final question** of an audit (badge shows "Final for Audit").
2. Click YES to submit.
3. The badge should disappear **immediately** on click — not after a 1-2 second delay.
4. If the next question is also the last in its audit, the badge should reappear after the API responds.
5. If the next question is NOT the last, the badge should stay hidden.

---

## FIX-6: Judge Dashboard Reviewer Emails Blank (BUG-6)

### What was wrong

On the judge dashboard, the "My Reviewers" table showed 2 rows but the Email column was **blank** for both. The Remove button also sent `email: undefined` to the server.

The API returned `r.email` but the dashboard JS read `r.username`, which was `undefined`.

### What was changed

**File: `judge/dashboard.ts` (line 515)**

Changed `r.username` to `r.email` in both places:

- The `<strong>` display text
- The `data-email` attribute on the Remove button

### QA Verification Steps

1. Log in as `judge@monsterrg.com`, navigate to `/judge/dashboard`.
2. Scroll down to the "My Reviewers" section.
3. Both rows should show email addresses: `reviewer@monsterrg.com` and `reviewer2@monsterrg.com`.
4. The count badge should still say "2".
5. Click "Remove" on a reviewer — the confirmation should show the **correct email** (not "undefined"). Cancel the removal.
6. Click "+ Add", create a new reviewer — the new email should appear in the table.

---

## FIX-7: Confusing Stats Labels (BUG-7)

### What was wrong

The review dashboard showed "Queue Pending: 40" with sub-label "awaiting review". Users couldn't tell if 40 meant 40 audits or 40 individual questions. It was 40 questions spread across 7 audits.

### What was changed

**File: `review/kv.ts` — `getReviewStats()` and `getReviewerDashboardData()`**

Both functions now track unique `findingId`s in a `Set` while counting pending entries, and return `pendingAuditCount` alongside `pending`.

**File: `review/dashboard.ts` (line 194 and 312)**

- Added `id="s-q-pending-sub"` to the sub-label element
- Updated render function to show: `"40 questions across 7 audits"` instead of `"awaiting review"`

### QA Verification Steps

1. Log in as `reviewer@monsterrg.com`, navigate to `/review/dashboard`.
2. The "Queue Pending" card should show the number with sub-label: **"N questions across M audits"** (not "awaiting review").
3. Verify the numbers make sense: question count should be >= audit count (each audit can have multiple failed questions).
4. Decide on one question, reload the dashboard. Question count should drop by 1. Audit count should only drop if that was the last question for that audit.

---

## Files Changed

| File                   | Fixes                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `lib/kv.ts`            | FIX-4 (backfillUtteranceTimes function)                                             |
| `review/kv.ts`         | FIX-1 (lock guard), FIX-4 (utteranceTimes backfill), FIX-7 (audit count in stats)   |
| `judge/kv.ts`          | FIX-1 (lock guard + `.check(pendingEntry)`), FIX-4 (utteranceTimes backfill)        |
| `judge/handlers.ts`    | FIX-1 (sequential instead of Promise.all)                                           |
| `shared/queue-page.ts` | FIX-2/3 (409 toast + auto-advance + button disabled), FIX-5 (badge optimistic hide) |
| `judge/dashboard.ts`   | FIX-6 (r.username → r.email)                                                        |
| `review/dashboard.ts`  | FIX-7 (sub-label with audit count)                                                  |

---

## Not Addressed (Suggestions from Same Email)

These were feature suggestions, not bugs:

1. Manual switch or auto-load for partner vs internal flows
2. "Sleep" button to temporarily remove an appeal from queue
3. Ctrl+K/J audio speed controls (0.5x–3x)
4. Improve readability of "Bot reasoning" section
5. Clickable "Audit" and "Record" links, "internal" vs "partner" label
6. Bigger UI — brighter boxes, text color, larger font
7. "Test audit by RID" pop-out readability on admin dashboard
8. Searchable bar for team/department/partner on admin dashboard
9. Show reviewer name on judge dashboard decided items
10. Reviewer stats on admin dashboard (decisions in last 24h, 48h, week)
