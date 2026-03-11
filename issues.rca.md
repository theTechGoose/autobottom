# Issues & Root Cause Analysis

Source: Email from Alexander Allard (alexandera@monsterrg.com) — 2026-03-11
Subject: "Bugs/Suggestions Autobottom"

---

## BUG-1: Reviewers grading the same question at the same time

**Reported:** "Reviewers are grading the same question at the same time, might not be an issue for judge but that should be covered too"

**Status:** REPRODUCED

**Reproduction result (review queue):** Fired concurrent `GET /review/api/next` for two reviewers (`reviewer@monsterrg.com`, `reviewer2@monsterrg.com`) using `aiohttp` + `asyncio.gather`. Result: **9/15 rounds both reviewers got the identical findingId + questionIndex (60% hit rate)**.

```
Round 1: BUG! Both got: alaEAQcvxvXFG7PA18Oco q3 (MCC Recurring Charges Disclosed?)
Round 2: BUG! Both got: alaEAQcvxvXFG7PA18Oco q9 (Income)
Round 3: BUG! Both got: alaEAQcvxvXFG7PA18Oco q13 (Single Qualifier Question)
...
RESULT: 9/15 rounds had duplicate assignments
BUG CONFIRMED: Lock system allows duplicate claims!
```

**Reproduction result (judge queue):** Same test against `GET /judge/api/next` with two judges. Result: **15/15 rounds both judges got the identical findingId + questionIndex (100% hit rate)**. Judge queue is even worse because `recordDecision()` also lacks `.check(pendingEntry)` (see Additional section below).

**Root Cause:** `review/kv.ts` `claimNextItem()` (line ~121) — The atomic CAS (check-and-set) only prevents two simultaneous writers racing on a **null** lock. It does NOT prevent a reviewer from overwriting an **existing** lock owned by another reviewer.

```
const lockEntry = await db.get(lockKey);
const res = await db.atomic()
  .check(lockEntry)          // only checks versionstamp hasn't changed
  .set(lockKey, { claimedBy: reviewer, claimedAt: now }, { expireIn: LOCK_TTL })
  .commit();
```

**What happens:**
1. Reviewer A claims item X — lock set to A (CAS succeeds, lock was null)
2. Reviewer B calls `claimNextItem`, reads item X's lock — sees A's lock with versionstamp V1
3. B's atomic: `check(V1)` passes (nobody changed it since B's read), `set(lock, B)` succeeds
4. B **overwrites** A's lock — both now have the same question

**Missing:** An explicit `if (lockEntry.value !== null)` guard before attempting the CAS. The CAS should only run when the lock is genuinely unclaimed (null).

**Also affects judge queue:** `judge/kv.ts` `claimNextItem()` (line ~128) has the exact same pattern — no `lockEntry.value` check before the atomic CAS.

**Fix:** Before the atomic CAS, check:
- `lockEntry.value !== null && claimedBy !== currentUser` → skip (locked by someone else)
- `lockEntry.value !== null && claimedBy === currentUser` → reclaim (page refresh)
- `lockEntry.value === null` → proceed with atomic CAS race

---

## BUG-2: Y/N buttons sometimes need to be hit twice before registering

**Reported:** "Sometimes they have to hit the Y/N buttons twice sometimes before it registers - I noticed this on the judge queue with the buttons there too."

**Status:** REPRODUCED

**Reproduction:** Used Playwright route interception to return a 409 response from `/decide`. After the 409:
- The same question stays on screen (not advanced)
- Buttons remain fully clickable with full opacity — no `disabled` attribute, no opacity change, no cursor change
- Zero error toasts shown to the user
- The click is silently swallowed with no feedback

**Root Cause:** `shared/queue-page.ts` — The `decide()` function (line 1721) gates on `busy` flag:
```js
function decide(decision, reason) {
  if (!currentItem || busy) return;  // silently drops click if busy
  ...
}
```

The `busy` flag is set to `true` in `executeDecision()` (line 1736) and only reset to `false` when the fetch response resolves. On 409 conflict response (line 1775): `busy = false; return;` — **no toast, no UI update, no error feedback**. The click is silently swallowed. The user sees nothing happen and clicks again.

On the happy path, `busy` is set **before** the network round-trip. If the network is momentarily delayed, rapid clicks get silently dropped during the `busy` window. There is no visual disabled state on the buttons, so users have no idea their click was ignored.

**Affects:** Both review and judge queues (shared `queue-page.ts`).

---

## BUG-3: Y/N buttons — nothing moves, must back out to dashboard

**Reported:** "Sometimes they hit the Y/N multiple times, nothing moves then they back out the dashboard, go back in and only then does it move on to the next question."

**Status:** REPRODUCED (cascading from BUG-1 + BUG-2)

**Reproduction:** When two reviewers get the same question via BUG-1 and one decides first, the other's subsequent decide call returns 409. Observed behavior:
- Line 1775 resets `busy = false` and returns early, but `currentItem` is NOT updated
- UI stays on the same question showing the already-decided item
- Every subsequent click succeeds in calling `executeDecision` (busy is false), but the server returns 409 again each time (pending entry already deleted by the first reviewer)
- Infinite loop of silent 409s — user is stuck
- Only way out: navigate back to dashboard and re-enter the queue (which calls `claimNextItem` fresh)

**Root Cause:** Three failure paths all lead to stuck UI:

1. **409 path (most common, caused by BUG-1):** `busy` resets but `currentItem` is NOT cleared or advanced. The UI stays on the decided item. Every click re-submits the same already-decided item, getting 409 forever.

2. **Network failure on decide:** The `.catch` block resets `busy` and shows a toast, but `currentItem` still references the item that was already decided server-side. UI stuck on stale item.

3. **Direct race with BUG-1:** Reviewer A decides on a question, but Reviewer B already overwrote A's lock. Server returns 409 for A. A's UI stays stuck with no recovery path.

**Affects:** Both review and judge queues.

---

## BUG-4: / search + Enter/; resets audio to 0 seconds

**Reported:** "/ search and enter doesn't jump to audio anymore, every time you hit enter or ; to scroll through audio, it just jumps to 0 seconds."

**Status:** REPRODUCED

**Reproduction:** Loaded the review queue in Playwright and inspected the DOM. Found **0 out of 67 transcript lines have a `data-time` attribute**. All transcript `<div>` elements have `data-time` equal to `null`. The transcript API (`/review/api/next` response) returns `{ raw, diarized }` with no `utteranceTimes` array.

Verified in code: `renderTranscript()` (line 1641 of `shared/queue-page.ts`) only sets `data-time` attributes when `currentTranscript.utteranceTimes` exists (line 1663). Since the transcript data has no `utteranceTimes` field, `data-time` is never set on any line.

**What happens in `seekToTranscriptLine()` (line 1982):**
1. `el.getAttribute('data-time')` returns `null` (attribute doesn't exist)
2. `parseFloat(null)` returns `NaN`
3. Falls to proportional fallback: `recAudio.currentTime = (idx / Math.max(1, lines.length - 1)) * dur`
4. But `idx` is the index of the matched line in the search — if the search match is the first line, `idx = 0` → `currentTime = 0`
5. Even for non-zero `idx`, the proportional estimate is wrong because it assumes lines are evenly distributed in time

**Root Cause:** Transcript data no longer includes `utteranceTimes`. Without this array, no `data-time` attributes are set, and every audio seek either goes to 0 or to an incorrect proportional estimate.

---

## BUG-5: "Final for Audit" card hangs ~2 seconds after submit

**Reported:** "'Final for Audit' card pops up for the last question -> YES to submit -> 'Final for Audit' card still sits there for maybe 2 more seconds on the brand new audit with multiple fails, needs to wipe as soon as it's submitted."

**Status:** REPRODUCED

**Reproduction:** Traced the code execution path through `shared/queue-page.ts`:

1. `renderCurrent()` (line 1560) sets `#m-last` badge visibility: `display = currentAuditRemaining === 1 ? '' : 'none'`
2. When user clicks YES on final question, `hideConfirmModal()` runs then `executeDecision()` (line 1867-1880)
3. In `executeDecision()` (line 1747), if `peekItem` exists: `currentItem = peekItem` then `animateTransition(function() { renderCurrent(); })` — this `renderCurrent()` call uses the **OLD** `currentAuditRemaining` value (still `1`)
4. `currentAuditRemaining` is only updated at line 1795: `currentAuditRemaining = data.next.auditRemaining || 0` — this runs inside the `.then()` callback of the fetch to `/decide`
5. After `currentAuditRemaining` updates, line 1800 finally hides the badge: `mLastSwap.style.display = currentAuditRemaining === 1 ? '' : 'none'`

**Result:** The "Final for Audit" badge stays visible from the moment the user clicks submit until the `/decide` API response returns from the server. Locally measured at ~25ms, but on production with network latency this is 1-2+ seconds. The badge is not optimistically hidden — it waits for the full network round-trip.

**Confirmed:** The API response field `data.next.auditRemaining` is the only place `currentAuditRemaining` gets updated. Verified by checking `/review/api/next` response which returned `"auditRemaining": 10` — this value only arrives after the server processes the decision and returns the next item.

---

## BUG-6: Judge dashboard — emails not showing for "My Reviewers"

**Reported:** "On judge dashboard, these emails aren't showing for 'My Reviewers'" (with screenshot)

**Status:** REPRODUCED

**Reproduction:** Logged into judge dashboard as `judge@monsterrg.com` via Playwright. The "My Reviewers" table shows:
- Count badge: "2" (correct)
- Row 1: Email column is **BLANK**, date "Mar 11, 2026", Remove button
- Row 2: Email column is **BLANK**, date "Mar 11, 2026", Remove button

Verified the API returns the correct data:
```json
GET /judge/api/reviewers →
[
  { "email": "reviewer2@monsterrg.com", "role": "reviewer", "supervisor": "judge@monsterrg.com", "createdAt": 1773257533064 },
  { "email": "reviewer@monsterrg.com", "role": "reviewer", "supervisor": "judge@monsterrg.com", "createdAt": 1773257533064 }
]
```

**Root Cause:** `judge/dashboard.ts` line 515 renders `r.username` but the API returns `r.email`:
```js
tr.innerHTML = '<td><strong>' + esc(r.username) + '</strong></td>...';
//                                    ^^^^^^^^ should be r.email
```

`r.username` is `undefined`. `esc(undefined)` → `esc(s)` where `s` is undefined → `d.textContent = s || ''` → empty string. The `<strong>` tag renders with no text content.

The Remove button also uses `r.username` for `data-email`, so clicking Remove would send `email: undefined` to the DELETE endpoint — removals are also broken.

**Fix:** Change `r.username` to `r.email` on line 515 of `judge/dashboard.ts`.

---

## BUG-7: Confusing stats display ("8" pending, "5" in queue)

**Reported:** "These stats are a little confusing, what does the '8' mean? 8 audits, 8 questions? It says there are 8 pending, 5 in queue, a little confusing" (with screenshot)

**Status:** REPRODUCED

**Reproduction:** Loaded the review dashboard as `reviewer@monsterrg.com` via Playwright. The stat cards show:
- "Queue Pending: **40**" with sub-label "awaiting review"
- "Queue Decided: **74**" with sub-label "total decisions"

The judge dashboard shows:
- "Pending: **2**" with sub-label "49 questions in queue"
- "Queue Pending: **49**" with sub-label "questions awaiting judge"

Verified via API: `GET /review/api/stats` returns `{ pending: 40, decided: 74 }`. These are counts of individual **questions** (each `review-pending` KV entry is one question from one audit). One audit can have multiple failed questions.

**Root Cause:** `getReviewStats()` in `review/kv.ts` (line 443) iterates `review-pending` entries and counts each one — these are individual questions, not audits. The dashboard labels ("Queue Pending", "awaiting review") don't clarify whether the number means audits or questions. When a user sees "40 pending", they might think 40 audits are waiting, when it's actually (for example) 10 audits with 40 total failed questions across them.

The judge dashboard is slightly better — it says "49 questions in queue" (line 421 of `judge/dashboard.ts`) — but the review dashboard has no such clarification.

**This is a UX/labeling issue.** The numbers are correct but the labels need clarification (e.g., "40 questions pending across N audits").

---

## Additional: Judge queue double-decide vulnerability (BUG-1 variant)

**Status:** CONFIRMED via code inspection (structurally identical to reproduced BUG-1)

`judge/kv.ts` `recordDecision()` (line 229-240) — The atomic commit does NOT include `.check(pendingEntry)` for optimistic concurrency, unlike the review queue which does (review/kv.ts line 201). This means two judges could double-decide the same question if both read the pending entry before either commits.

```
// judge/kv.ts — MISSING .check(pendingEntry)
const atomic = db.atomic()
  .delete(lockKey)
  .delete(pendingKey)
  .set(orgKey(orgId, "judge-decided", findingId, questionIndex), decided);
```

Compare with review/kv.ts which correctly includes:
```
const atomic = db.atomic()
  .check(pendingEntry)   // <-- prevents double-decide
  .delete(lockKey)
  .delete(pendingKey)
  .set(orgKey(orgId, "review-decided", findingId, questionIndex), decided);
```

Additionally, `judge/handlers.ts` line 87-93 runs `recordDecision` and `claimNextItem` in `Promise.all` — both execute concurrently, which could further exacerbate race conditions.

The judge lock race test (15/15 = 100% duplicate rate) confirms this is materially worse than the review queue (9/15 = 60%).

---

# Proposed Fixes

---

## FIX-1: Lock race condition (BUG-1 + Judge variant)

**Bug verified:** Review queue: 9/15 concurrent rounds (60%) produced duplicate assignments. Judge queue: 15/15 (100%).

**Proposed fix:**

In both `review/kv.ts` `claimNextItem()` (~line 121) and `judge/kv.ts` `claimNextItem()` (~line 128), add an explicit null check on the lock value before attempting the CAS:

```ts
const lockEntry = await db.get(lockKey);

// Already locked by someone else — skip this item
if (lockEntry.value !== null && lockEntry.value.claimedBy !== reviewer) continue;

// Already locked by us (page refresh / reconnect) — reclaim without CAS race
if (lockEntry.value !== null && lockEntry.value.claimedBy === reviewer) {
  current = item;
  continue;
}

// Lock is null — proceed with atomic CAS
const res = await db.atomic()
  .check(lockEntry)
  .set(lockKey, { claimedBy: reviewer, claimedAt: now }, { expireIn: LOCK_TTL })
  .commit();
if (res.ok) {
  current = item;
  continue;
}
```

For the judge `recordDecision()` double-decide vulnerability, add `.check(pendingEntry)` to the atomic commit (matching the review queue pattern):

```ts
const atomic = db.atomic()
  .check(pendingEntry)   // <-- add this
  .delete(lockKey)
  .delete(pendingKey)
  .set(orgKey(orgId, "judge-decided", findingId, questionIndex), decided);
```

Also consider changing `judge/handlers.ts` line 87-93 to run `recordDecision` and `claimNextItem` sequentially instead of in `Promise.all`, so the decision is committed before the next item is claimed.

**Validation:**

1. Run the race test script (`/tmp/race-test.py`) with 15+ rounds against the review queue — expect **0/15 duplicate assignments** (was 9/15)
2. Run the judge race test script (`/tmp/race-test-judge.py`) with 15+ rounds — expect **0/15 duplicate assignments** (was 15/15)
3. Verify page refresh still works: log in as reviewer, get a question, refresh the page — same question should reappear (reclaim path)
4. Verify two different reviewers get **different** questions when both call `/next` simultaneously
5. For the judge double-decide fix: have two judge sessions decide on the same question simultaneously — only one should succeed, the other should get a 409

---

## FIX-2: Silent button drops / no feedback on 409 (BUG-2)

**Bug verified:** After a 409 response, buttons remain fully clickable with full opacity, zero error toasts shown, click is silently swallowed.

**Proposed fix:**

In `shared/queue-page.ts`, update the 409 handler (line 1775) to show a toast and advance the queue:

```js
if (res.status === 409) {
  busy = false;
  toast('Already decided — loading next item', 'info');
  // Fetch the next item to unstick the UI
  fetch(API + '/next').then(function(r) { return r.json(); }).then(function(d) {
    if (d.current) {
      currentItem = d.current;
      peekItem = d.peek || null;
      currentTranscript = d.transcript || null;
      currentAuditRemaining = d.auditRemaining || 0;
      renderCurrent();
    } else {
      currentItem = null;
      renderEmpty();
    }
  });
  return;
}
```

Additionally, add a visual disabled state to buttons during the `busy` window:

```js
// In executeDecision(), after busy = true:
var btns = document.querySelectorAll('.decide-btn');
btns.forEach(function(b) { b.style.opacity = '0.5'; b.style.pointerEvents = 'none'; });

// In the .then() and .catch() callbacks, after busy = false:
btns.forEach(function(b) { b.style.opacity = ''; b.style.pointerEvents = ''; });
```

**Validation:**

1. Use Playwright route interception to return a 409 from `/decide` — verify a toast message appears saying "Already decided" (was: no toast)
2. After the 409, verify the UI advances to the next question automatically (was: stuck on same question)
3. Verify buttons show a visual disabled state (reduced opacity, no pointer events) during the network round-trip
4. Rapidly click a Y/N button — verify the second click is visually blocked (button appears disabled), not silently ignored
5. After the API returns, verify buttons re-enable and accept the next click normally

---

## FIX-3: UI stuck after repeated 409s (BUG-3)

**Bug verified:** After BUG-1 race causes 409, `currentItem` is never updated. UI loops on the same decided item with no escape except navigating to dashboard.

**Proposed fix:**

This is fully addressed by FIX-2 — the 409 handler now fetches `/next` to get a fresh item and calls `renderCurrent()` or `renderEmpty()`. The infinite 409 loop is broken because `currentItem` gets replaced with the next undecided question (or null if the queue is empty).

**Validation:**

1. Reproduce BUG-1 (two reviewers get same question), have reviewer A decide first
2. Reviewer B clicks Y/N — should see a toast and automatically advance to the next question (was: stuck, had to back out to dashboard)
3. Verify reviewer B does NOT need to navigate to the dashboard and back
4. If the queue is empty after the 409, verify the empty state renders ("No items remaining" or equivalent)

---

## FIX-4: Audio seek resets to 0 seconds (BUG-4)

**Bug verified:** 0/67 transcript lines have `data-time` attributes. Transcript API returns `{ raw, diarized }` with no `utteranceTimes`. `parseFloat(null)` = NaN, proportional fallback yields 0 for first match.

**Proposed fix:**

Two options (choose based on whether `utteranceTimes` data is available in the pipeline):

**Option A — Generate `utteranceTimes` from diarized transcript:** Parse the diarized transcript (which contains speaker/timestamp markers) to extract per-line timestamps. Populate `utteranceTimes` in the transcript response so `renderTranscript()` can set `data-time` attributes.

**Option B — Compute proportional times from audio duration:** If `utteranceTimes` is genuinely unavailable, fix the proportional fallback in `seekToTranscriptLine()` so it uses the correct line index relative to all lines (not the search match index):

```js
function seekToTranscriptLine(el) {
  var dur = recAudio.duration;
  if (!dur || isNaN(dur)) return;
  var timeAttr = parseFloat(el.getAttribute('data-time'));
  if (!isNaN(timeAttr)) {
    recAudio.currentTime = Math.min(timeAttr, dur);
  } else {
    // Use the line's position in the full transcript for proportional estimate
    var allLines = document.querySelectorAll('.transcript-line');
    var lineIdx = Array.prototype.indexOf.call(allLines, el);
    if (lineIdx >= 0) {
      recAudio.currentTime = (lineIdx / Math.max(1, allLines.length - 1)) * dur;
    }
  }
}
```

Option A is the correct long-term fix. Option B is a stopgap if the upstream data isn't available yet.

**Validation:**

1. Load a review item with a transcript and audio
2. Open `/` search, type a word, press Enter to jump to the match
3. Verify `recAudio.currentTime` is set to a non-zero value that corresponds to the matched line's position (was: always 0)
4. Press `;` to advance through matches — verify audio seeks forward (not back to 0 each time)
5. If Option A: inspect DOM and verify `data-time` attributes are set on transcript lines with real timestamps (was: 0/67 lines had `data-time`)
6. If Option B: verify proportional seek puts audio at roughly the correct position (e.g., a line 50% through the transcript seeks to ~50% of audio duration)

---

## FIX-5: "Final for Audit" badge hangs after submit (BUG-5)

**Bug verified:** `currentAuditRemaining` only updates at line 1795 in the `.then()` callback after the `/decide` fetch. The `#m-last` badge stays visible during the entire network round-trip.

**Proposed fix:**

In `executeDecision()`, immediately after setting `busy = true` and before the fetch call, optimistically hide the badge:

```js
// Optimistically hide "Final for Audit" badge
var mLastOpt = document.getElementById('m-last');
if (mLastOpt) mLastOpt.style.display = 'none';
```

This hides the badge instantly on submit. When the fetch response arrives (line 1795-1800), `currentAuditRemaining` updates and `m-last` is set to the correct state for the next item. If the next item is also the last in its audit, the badge will re-appear correctly via `renderCurrent()` (line 1560).

**Validation:**

1. Navigate the review queue to the final question of an audit (badge shows "Final for Audit")
2. Click YES to submit — verify the "Final for Audit" badge disappears **immediately** (was: persisted for ~2 seconds until API response)
3. The next question should load normally — if it's also the last in its audit, the badge should reappear; if not, it should stay hidden
4. Measure timing: badge should hide within one animation frame of the click (~16ms), not after the network round-trip

---

## FIX-6: Judge dashboard "My Reviewers" emails blank (BUG-6)

**Bug verified:** Playwright shows both reviewer rows with blank Email cells. API returns `r.email` but dashboard JS reads `r.username` (undefined).

**Proposed fix:**

In `judge/dashboard.ts` line 515, change `r.username` to `r.email`:

```js
// Before (broken):
tr.innerHTML = '<td><strong>' + esc(r.username) + '</strong></td><td>' + dateStr + '</td><td><button class="sf-btn danger" data-email="' + esc(r.username) + '">Remove</button></td>';

// After (fixed):
tr.innerHTML = '<td><strong>' + esc(r.email) + '</strong></td><td>' + dateStr + '</td><td><button class="sf-btn danger" data-email="' + esc(r.email) + '">Remove</button></td>';
```

**Validation:**

1. Log in as `judge@monsterrg.com`, navigate to `/judge/dashboard`
2. Scroll to "My Reviewers" section — verify both rows show their email addresses (was: blank)
3. Verify the count badge still says "2"
4. Click "Remove" on a reviewer — verify the confirmation dialog shows the correct email (was: `undefined`)
5. Cancel the removal, then use "+ Add" to create a new reviewer — verify the new reviewer's email appears in the table after creation

---

## FIX-7: Confusing stats labels (BUG-7)

**Bug verified:** Review dashboard shows "Queue Pending: 40 / awaiting review" — no distinction between questions and audits. Users can't tell if 40 means 40 audits or 40 individual questions.

**Proposed fix:**

Update the stats endpoint and dashboard labels to show both question count and audit count:

1. In `review/kv.ts` `getReviewStats()`, track unique `findingId`s while counting:

```ts
const pendingAudits = new Set<string>();
for await (const entry of db.list<ReviewItem>({ prefix: orgKey(orgId, "review-pending") })) {
  pending++;
  pendingAudits.add(entry.value?.findingId);
  // ... existing type counting
}
// Return pendingAuditCount: pendingAudits.size alongside pending
```

2. In `review/dashboard.ts`, update the sub-label (line 194) from `"awaiting review"` to show both:

```js
document.getElementById('s-q-pending-sub').textContent =
  data.queue.pending + ' questions across ' + data.queue.pendingAuditCount + ' audits';
```

**Validation:**

1. Load the review dashboard — verify the "Queue Pending" card shows "40 questions across N audits" (was: "40 / awaiting review")
2. Verify the numbers add up: the question count should match the total `review-pending` entries, and the audit count should match the number of unique `findingId`s
3. Decide on one question, reload dashboard — verify the question count decreases by 1, and the audit count only decreases if that was the last question for that audit

---

# Execution Plan

## Phase 1: Lock Race Condition (BUG-1 + Judge variant) — CRITICAL

### Reproduce
- [ ] Start server with `QB_REALM=test SELF_URL=http://localhost:8000 deno run --allow-net --allow-env --allow-read --allow-write --unstable-kv --unstable-cron main.ts`
- [ ] Run review race test: `python3 /tmp/race-test.py 15` — confirm duplicate rate >50%
- [ ] Run judge race test: `python3 /tmp/race-test-judge.py <session1> <session2>` — confirm duplicate rate ~100%

### Fix
- [ ] `review/kv.ts` ~line 121: Add `lockEntry.value !== null` guard before atomic CAS in `claimNextItem()`
- [ ] `review/kv.ts` ~line 121: Add reclaim path for `lockEntry.value.claimedBy === reviewer` (page refresh)
- [ ] `judge/kv.ts` ~line 128: Apply same `lockEntry.value !== null` guard in `claimNextItem()`
- [ ] `judge/kv.ts` ~line 128: Apply same reclaim path for same-judge page refresh
- [ ] `judge/kv.ts` ~line 229: Add `.check(pendingEntry)` to `recordDecision()` atomic commit
- [ ] `judge/handlers.ts` ~line 87: Change `Promise.all([recordDecision, claimNextItem])` to sequential execution

### Validate
- [ ] Run review race test again — confirm **0/15** duplicate assignments
- [ ] Run judge race test again — confirm **0/15** duplicate assignments
- [ ] Log in as reviewer, get a question, refresh the page — same question reappears (reclaim works)
- [ ] Two reviewers call `/next` simultaneously — each gets a **different** question
- [ ] Two judges decide on the same question simultaneously — only one succeeds, other gets 409

---

## Phase 2: Button Feedback & Stuck UI (BUG-2 + BUG-3)

### Reproduce
- [ ] Use Playwright route interception to return 409 from `/review/api/decide`
- [ ] Confirm: no toast shown after 409
- [ ] Confirm: buttons remain at full opacity, no disabled state
- [ ] Confirm: same question stays on screen, UI is stuck
- [ ] Confirm: repeated clicks produce repeated silent 409s with no recovery

### Fix
- [ ] `shared/queue-page.ts` ~line 1775: Replace silent `busy = false; return;` with toast + fetch `/next` to advance the queue
- [ ] `shared/queue-page.ts` ~line 1736: Add visual disabled state (opacity 0.5, pointerEvents none) to decide buttons when `busy = true`
- [ ] `shared/queue-page.ts`: Re-enable buttons (opacity 1, pointerEvents auto) in `.then()` and `.catch()` callbacks after `busy = false`

### Validate
- [ ] Playwright route intercept returns 409 — verify toast appears ("Already decided — loading next item")
- [ ] After 409 toast, verify UI advances to the next question automatically
- [ ] If queue is empty after 409, verify empty state renders
- [ ] Verify buttons show disabled state (reduced opacity) during network round-trip
- [ ] Rapidly click Y/N — second click is visually blocked, not silently swallowed
- [ ] After API returns, buttons re-enable and accept next click
- [ ] Reproduce BUG-1 scenario (two reviewers, same question, one decides first) — second reviewer sees toast and advances, does NOT need to back out to dashboard

---

## Phase 3: Audio Seek (BUG-4)

### Reproduce
- [ ] Load a review item in Playwright, inspect transcript DOM
- [ ] Confirm: 0 out of N transcript lines have `data-time` attributes
- [ ] Confirm: transcript API response has no `utteranceTimes` field
- [ ] Use `/` search, press Enter — confirm `recAudio.currentTime` goes to 0

### Fix (choose one)
- [ ] **Option A:** Generate `utteranceTimes` from diarized transcript data upstream — populate in transcript API response so `renderTranscript()` sets `data-time` on each line
- [ ] **Option B (stopgap):** Fix proportional fallback in `seekToTranscriptLine()` to use the line's actual DOM index among all transcript lines, not the search match index

### Validate
- [ ] Open `/` search, type a word, press Enter — audio seeks to a non-zero position matching the line's location
- [ ] Press `;` to advance through matches — audio moves forward, not back to 0
- [ ] If Option A: inspect DOM, verify `data-time` attributes are set with real timestamps on transcript lines
- [ ] If Option B: line at ~50% of transcript seeks audio to ~50% of duration

---

## Phase 4: "Final for Audit" Badge Timing (BUG-5)

### Reproduce
- [ ] Navigate review queue to the final question of an audit (badge shows "Final for Audit")
- [ ] Click YES to submit
- [ ] Confirm: badge stays visible for ~1-2 seconds until API response returns

### Fix
- [ ] `shared/queue-page.ts` in `executeDecision()`: Add `document.getElementById('m-last').style.display = 'none'` immediately after `busy = true`, before the fetch call

### Validate
- [ ] Submit the final audit question — badge disappears **immediately** on click (within one animation frame)
- [ ] Next question loads normally
- [ ] If next question is also the last in its audit, badge reappears correctly
- [ ] If next question is NOT the last, badge stays hidden

---

## Phase 5: Judge Dashboard Reviewer Emails (BUG-6)

### Reproduce
- [ ] Log in as `judge@monsterrg.com`, navigate to `/judge/dashboard`
- [ ] Confirm: "My Reviewers" table shows 2 rows with **blank** Email column
- [ ] Confirm: API `GET /judge/api/reviewers` returns objects with `email` field (not `username`)

### Fix
- [ ] `judge/dashboard.ts` line 515: Change `r.username` to `r.email` (both in the `<strong>` text and in `data-email` attribute)

### Validate
- [ ] Reload judge dashboard — both reviewer rows show email addresses (was: blank)
- [ ] Count badge still shows "2"
- [ ] Click "Remove" on a reviewer — confirmation dialog shows the correct email (was: `undefined`)
- [ ] Cancel removal, use "+ Add" to create a new reviewer — new email appears in the table

---

## Phase 6: Confusing Stats Labels (BUG-7)

### Reproduce
- [ ] Load review dashboard as `reviewer@monsterrg.com`
- [ ] Confirm: "Queue Pending" shows a number with sub-label "awaiting review" — no distinction between questions and audits

### Fix
- [ ] `review/kv.ts` `getReviewStats()`: Track unique `findingId`s in a `Set` while counting pending entries, return `pendingAuditCount` alongside `pending`
- [ ] `review/dashboard.ts` line 194: Update sub-label to show "N questions across M audits"

### Validate
- [ ] Reload review dashboard — "Queue Pending" card shows "N questions across M audits" (was: just "awaiting review")
- [ ] Verify question count matches total `review-pending` KV entries
- [ ] Verify audit count matches number of unique `findingId`s
- [ ] Decide on one question, reload — question count drops by 1, audit count only drops if it was the last question for that audit

---

## Phase 7: Final Regression Pass

- [ ] Full review queue walkthrough: log in, get question, decide, advance — works normally end to end
- [ ] Full judge queue walkthrough: log in, get appeal question, uphold/overturn, advance — works normally end to end
- [ ] Two concurrent reviewers: each gets different questions, both can decide without interference
- [ ] Two concurrent judges: each gets different questions, both can decide without interference
- [ ] Page refresh mid-review: same question reappears (reclaim path works)
- [ ] Judge dashboard: reviewer emails visible, badge counts correct, stats accurate
- [ ] Review dashboard: stats show question and audit counts, labels are clear
- [ ] Audio search: `/` search + Enter jumps to correct audio position, `;` advances forward

---

## Suggestions (from same email, not bugs)

1. Manual switch or auto-load for partner vs internal flows — reviewers want to stay in one "flow"
2. "Sleep" button to temporarily remove an appeal from queue (awaiting new audio, tech issue, etc.)
3. Ctrl+K speed up audio 0.5x (up to 3x), Ctrl+J slow down (down to 0.5x)
4. Improve readability of the "Bot reasoning" section
5. Make "Audit" section a clickable link to the audit, "Record" link to CRM, label "internal" vs "partner" above it
6. Make UI bigger — brighter boxes, text color, larger font size
7. "Test audit by RID" field pop-out boxes sometimes unreadable on admin dashboard
8. Searchable bar for team members/department/partner store on admin dashboard homepage
9. Show reviewer name on judge dashboard decided items
10. Reviewer stats on admin dashboard — decisions in last 24h, 48h, week, etc.
