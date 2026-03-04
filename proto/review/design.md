# Review Queue -- UX Design

Upgrade spec for the review queue. UX above all else. Engineering complexity and cost are
not constraints.

---

## Design Principles

1. **Zero-wait decisions.** The reviewer should never perceive a loading state between items.
   Every transition is optimistic, every payload prefetched, every animation instant.
2. **Peripheral awareness.** Progress, combo, connection, and queue state live at the edges
   of vision. The center of attention is always the decision.
3. **The 200th item is as easy as the 1st.** Cognitive load is actively managed through
   progressive disclosure, smart defaults, and anti-fatigue patterns.
4. **Earned, not gifted.** Gamification rewards feel like achievements. Level-ups interrupt.
   Badges have ceremony. Combos have physical weight.
5. **Trust through transparency.** The reviewer always knows: is my work saved? Is my
   connection alive? What happens if I undo?

---

## 1. Core Interaction Model

### 1.1 Card Stack Architecture

Render two cards in a z-stack. The current card sits on top; the peek card sits behind it,
scaled to 96% with a 4px blur, its header visible.

On decision:
- **Confirm:** current card flies right -- `translateX(110%) rotate(4deg)`, 220ms,
  `cubic-bezier(0.4, 0, 0.2, 1)`.
- **Flip:** current card flies left -- `translateX(-110%) rotate(-4deg)`, same curve.
- Peek card scales 96% -> 100%, de-blurs, advances to front. 240ms,
  `cubic-bezier(0.0, 0, 0.2, 1)`.
- A fresh peek fades in behind at 96%.

The rotation gives physical weight -- the card feels like paper being dealt, not a UI
element disappearing.

### 1.2 Ambient Direction Flash

On decision commit (before server round-trip), tint the entire viewport with a directional
gradient that dissipates in 350ms:
- Confirm: right-edge burst, `rgba(31, 111, 235, 0.18)`.
- Flip: left-edge burst, `rgba(139, 92, 246, 0.18)`.

Implemented as a fixed overlay with `pointer-events: none`. Fires synchronously on
keypress. Peripheral vision catches it even while eyes track the card animation.

### 1.3 Keyboard-First Speed

| Key       | Action                                                  |
|-----------|---------------------------------------------------------|
| `Y`       | Confirm (keep "No")                                     |
| `N`       | Flip (override to "Yes")                                |
| `B` / `U` | Undo last decision                                      |
| `D`       | Toggle AI reasoning trace                               |
| `E`       | Jump to primary evidence line in transcript              |
| `J` / `K` | Navigate transcript lines (vim-style)                   |
| `H` / `L` | Scroll transcript columns                               |
| `/`       | Search transcript                                       |
| `;`       | Next search match, `Shift+;` previous                  |
| `Tab`     | Hold to expand reasoning (release to collapse)          |
| `Space`   | Play/pause audio                                        |
| `\`       | Cycle density mode (Focused / Dense / Wide)             |
| `?`       | Toggle keyboard cheat sheet                             |

**Input queuing:** When a decision is in-flight (`busy`), queue the next keypress. When
`busy` clears, replay it. The combo counter pulses once to confirm registration. The UI
never blocks input.

**Keyboard hint fade:** Bottom bar hotkey hints pulse subtly (opacity 1.0 to 0.6) for the
first 3 decisions, then stop. Discoverable without being permanently noisy.

### 1.4 Gesture Support (Touch / Mobile)

- **Swipe left/right** on the verdict card. Card follows the finger with proportional
  `translateX` and rotation (max 8deg). Over 40% drag width: release with momentum. Under
  40%: elastic snap-back using `cubic-bezier(0.34, 1.56, 0.64, 1)`.
- Card border tints dynamically during drag: right = blue (confirm), left = purple (flip),
  proportional to distance.
- **Swipe up** for undo.
- **Long-press** on transcript line: floating tooltip with "Seek to this moment" and "Copy."
- **Haptic feedback** via Vibration API: 50ms pulse on confirm, double pulse (40ms + 20ms
  gap + 20ms) on flip.

### 1.5 Visible Decision Buttons

Two ghost buttons pinned at the bottom of the verdict panel (`position: sticky; bottom: 0`).
Always visible. Each shows its hotkey inline:

```
[Y] Confirm No          [N] Flip to Yes
```

Styled as translucent pill buttons with accent borders. Power users ignore them and use
keys. New users see what to do immediately. The hotkey label teaches the shortcut through
use.

---

## 2. Information Architecture

### 2.1 Left Panel Hierarchy

Restructure the verdict panel into three zones:

**Zone A -- Decision Anchor (top line, always visible)**
```
[Greeting]  [Bot: NO]  * High confidence
```
Header chip + verdict badge + confidence dot on the same line. One fixation to grasp what
was asked and what the bot decided. The confidence dot is color-coded:
- Green: high confidence -- defense is strong, likely just confirm.
- Amber: medium -- warrants a read.
- Red: low -- transcript check recommended.

Confidence is inferred client-side from defense language strength (certainty words vs hedging
words) and evidence snippet count. Labeled with a tooltip: "Estimated from language."

**Zone B -- The Question (primary reading target)**
Full populated question text. 15px, `#e6edf3`, weight 500. This is the most important
element -- it visually dominates the defense below it.

**Zone C -- AI Justification (collapsible, below fold)**
- **Defense** ("AI JUDGMENT"): visible by default, truncated to 2 lines with inline
  "...more" expansion. Within the defense, quoted transcript references are wrapped as
  clickable links that jump the transcript to that line.
- **Thinking** ("REASONING TRACE"): collapsed by default. When expanded, renders in
  monospace with a subtle diagonal line pattern background. Toggle via `D` key or a
  pill-style "TRACE" button with an LED dot (dim when closed, amber when open).
- On low-confidence items (1-2), auto-expand thinking on load.

### 2.2 Flip Delta Preview

When the reviewer hovers the Flip button (or holds `N` for 300ms), a compact overlay shows:

```
BEFORE: Bot answered NO
AFTER:  Overridden to YES
Effect: This question will be marked PASS in the corrected audit.
Audit items remaining: 3 of 6
```

Appears with 150ms debounce, dismisses on mouseout or key release.

### 2.3 Audit Progress Rail

Above the question header, a horizontal rail of small 12x12px square tiles -- one per
question in the finding:
- Dim filled: answered "Yes" (not in review queue)
- Blue filled: confirmed fail (decided)
- Green filled: flipped to pass (decided)
- Pulsing outline: current item
- Empty outline: pending

Hover on a tile shows the question `header`. Requires adding `auditTotal` to the
`claimNextItem` response.

### 2.4 Meta Row Consolidation

Replace the current 3 chips with one compound chip:

```
Q3 of 6 -- 47 left
```

One chip instead of three. Less scanning, same information.

### 2.5 Previous Decision Indicator (on Undo)

When an item is restored via undo, show a dim callout bar:

```
PREVIOUSLY: Confirmed Fail  (12s ago)
```

Between the verdict badge and the question text. The reviewer knows what they originally
decided.

---

## 3. Transcript Viewer

### 3.1 Jump-to-Context on Load

When a `ReviewItem` loads, parse the `thinking` and `defense` fields for quoted strings.
Fuzzy-match against transcript lines. Auto-scroll to the first match (the "primary evidence
anchor"), centered vertically, after a 200ms delay.

A fixed "Jump to evidence" pill appears in the top-right of the transcript panel when the
reviewer scrolls away. Disappears when already at the anchor.

### 3.2 Evidence Summary Strip

A thin horizontal strip above the transcript body showing extracted evidence quotes as
clickable chips:

```
"Did not greet by name"    "Said goodbye first"
```

Each chip jumps the transcript to its matching line. Reviewers can verify a single chip
without reading the full transcript.

### 3.3 Linked Claim Annotations

In the defense text, wrap matched transcript quotes as `<a class="transcript-ref">` links.
Click scrolls to that line with a pulse animation. Hover shows a 5-line context preview
(2 lines before, target, 2 lines after).

Eliminates the left-right eye movement between defense and transcript. Verification without
panel switching.

### 3.4 Speaker-Colored Minimap

Replace the scrollbar with an 8px-wide custom minimap on the right edge. Each segment
represents a line: agent lines blue, customer lines purple, evidence lines amber. Click
jumps to position. Gives spatial awareness of call structure and evidence distribution.

### 3.5 Same-Audit Transcript Reuse

When the next item shares the same `findingId`, skip the full transcript re-render. Instead,
update evidence highlights in the existing DOM and scroll to the new evidence anchor. This
eliminates redundant transcript processing and preserves the reviewer's spatial memory of the
call.

### 3.6 Column Count Control

A subtle icon row in the transcript header (1-bar, 2-bar, 3-bar) toggles column count.
Single column scrolls vertically (familiar), multi-column scrolls horizontally (power user).
Default: single for new users, persisted preference via `localStorage`.

### 3.7 Line Navigation

`J`/`K` navigate line-by-line within the transcript. The focused line gets a 2px accent
outline. `Enter` while focused copies the line text to clipboard. Focus resets to the
evidence anchor on each new item.

---

## 4. Gamification

### 4.1 The Combo Orb

Replace the text combo counter with a floating orb widget, positioned fixed in the
upper-right quadrant (not the bottom bar). Three visual layers:

- **Core:** Circular number display. Invisible at 0. Quiet gray at 1-4. Glowing at 5+.
- **Ring:** SVG ring tracing progress toward the next milestone combo. At combo 4, the ring
  is 80% filled toward the 5x mark. On hitting 5, ring flashes full and resets to trace
  toward 10.
- **Outer corona:** Particle spikes radiating outward, intensity growing with tier. 3 spikes
  at 5x, 6 at 10x, continuous at 20x+.

**Milestone moments:**

| Combo | Name           | Visual                                                          | Audio                        |
|-------|----------------|-----------------------------------------------------------------|------------------------------|
| 5x    | Ultra          | Orb pulses 1.3x scale, screen-edge vignette flicker            | `ultra` + pre-click          |
| 10x   | Rampage        | Orb shakes 3x, 8-particle burst, single-frame white flash      | `rampage`                    |
| 20x   | Godlike        | Screen vignette darkens 300ms, orb 2x explode/collapse, "GODLIKE" banner 2.5s | `godlike`      |
| 50x   | Beyond Godlike | Full-width light sweep, orb crown morph, reviewer name in gold, chromatic aberration text | `godlike` + `levelup` at +800ms |

**Combo drop:** Orb implodes `scale(1.0) -> scale(0)` over 200ms. `shutdown` sound after
50ms of silence. The silence is the loudest sound.

**Combo entrance:** First tick stamps in `scale(1.6) -> scale(1.0)` over 180ms using
`cubic-bezier(0.34, 1.56, 0.64, 1)`. Subsequent ticks: `scale(1.2) -> scale(1.0)` over
120ms.

**Combo heat aura:** At 5+ combo, the verdict panel border pulses with a colored glow that
intensifies with tier. At `godlike`: `box-shadow: 0 0 60px rgba(168,85,247,0.25)` with a
slow 3s keyframe pulse. The transcript panel mirrors it.

### 4.2 XP Bar

Full width of the bottom bar center section, 6px tall (up from 3px).

- **Overshoot animation:** Bar fills to target + 8% in 150ms, settles back in 300ms.
  Spring-like.
- **Breathing glow:** When combo multiplier is active, slow `box-shadow` pulse in accent
  color (1.5s period).
- **Near-level anxiety:** Above 80% fill, a gold shimmer runs across the bar every 3s. XP
  display changes from `0 XP` to `8 to go` when within 20 XP of leveling.
- **XP float text:** Appears anchored to the decision button position (not the level badge).
  Creates visual causality -- you pressed the button, XP came out.
- **Multiplier badge:** When combo multiplier > 1x, a small `x1.5` / `x2` / `x3` badge
  attaches to the bar. Pulses on tier change.

### 4.3 Level-Up Sequence

Level-ups are not notifications. They are rewards.

1. **0ms:** Full-screen overlay animates to `rgba(0,0,0,0.7)` in 200ms. Next item loads
   behind the scenes.
2. **200ms:** Level-up card animates in from bottom center. 320x200px, glass morphism style
   (`backdrop-filter: blur(20px)`). Gold border traces the perimeter via `stroke-dashoffset`
   over 600ms.
3. **Card contents:**
   - Previous level (small, faded) -> arrow -> New level (64px, gold gradient)
   - Level title in caps, letter-spacing 4px
   - Flavor text per level: "You have found your rhythm." / "The queue fears you." / "No
     item escapes your eye."
4. **XP bar:** Hits 100%, holds 400ms, ripple wave animation, resets to 0% and fills to
   overflow XP position.
5. **Audio:** `levelup` at 200ms. Quiet `ping` at 800ms as continue button appears.
6. **Dismisses** at 2.5s or on click/keypress.

### 4.4 Streak Shield

Replace the plain `3d` text with a circular shield widget in the bottom bar:

- **Outer ring:** Traces progress toward next streak badge (day 4/7 toward Week Warrior =
  57% filled).
- **Middle ring:** Lights up in segments for today's activity (every 5 decisions, up to 3
  segments).
- **Center:** Streak number in flame-colored font.

Visual states:
- 0-1 days: dim gray, cracked appearance.
- 2-6 days: orange-gold glow.
- 7+ days: animated flame particles.
- 30+ days: purple with crown glyph.

**Streak anxiety trigger on login:** If streak > 3 and today's activity is 0, show a
floating callout: "Your X-day streak is at risk today." Pulses 3 times, then settles.
Disappears after first decision.

### 4.5 Badge Ceremony

Tiered unlock animations by rarity:

| Tier      | Treatment                                                                                |
|-----------|------------------------------------------------------------------------------------------|
| Common    | 2s slide-in toast from right. Icon, name, tier. No overlay.                              |
| Uncommon  | Same + 8-particle burst from icon on arrival. 3s display.                                |
| Rare      | Brief screen darkening (0.3s). Badge card centers with tier-color glow. Screen shake. Card shrinks and flies to streak corner ("collected"). 3s. |
| Epic      | Same as rare + animated hue-shift gradient background. Icon spins 360. `godlike` audio. 4s. |
| Legendary | Screen dark 400ms. Golden light sweep top-to-bottom. Chromatic aberration glow. Name appears letter-by-letter (40ms/char). Gold particle rain 3s. `godlike` + `levelup`. 5s, click to dismiss. |

**Badge sounds:** Common/uncommon use `triple`-tier sound. Rare+ use full `godlike`. Current
badge toasts are silent -- this is a significant miss.

### 4.6 Sound Design Philosophy

The sounds should form a continuous escalation, not discrete events.

| Slot       | Character                                                       |
|------------|-----------------------------------------------------------------|
| `ping`     | Clean, short transient. A click, not a reward.                  |
| `double`   | Same click + subtle harmony underneath. Momentum starting.      |
| `triple`   | Third note of a rising arpeggio. Brain expects a fourth.        |
| `mega`     | Bass drop enters. Feel it in your chest.                        |
| `ultra`    | Orchestral hit, multiple layers. The first "moment."            |
| `rampage`  | Slightly distorted, dangerous. Sawtooth wave enters.            |
| `godlike`  | Cathedral. Full chord, long tail, reverb. Sacred.               |
| `shutdown` | Deflation. 50ms silence before tone plays. Silence is loudest.  |
| `levelup`  | Bright ascending fanfare. Distinct from combo sounds.           |

**Confirm vs flip distinction:** Two sound variants for the base decision: confirm is
ascending, flip is descending/neutral. Reinforces direction without reading the toast.

**Volume escalation:** `ping` at 0.4 volume, linear ramp to `godlike` at 1.0.

**Tempo sync:** Track rolling average decision speed. Under 3s avg, speed up playback rate
to `min(1.3, 1 + (3000 - avgMs) / 5000)`. The session soundtrack accelerates with the
reviewer's cadence.

**Time bank urgency:** At 30% remaining, a low heartbeat pulse every 2s. At 10%, every 1s.

### 4.7 Zone / Flow State Detection

Zone = combo >= 10 AND last-5-decision avg speed below personal average.

**Zone entry:**
- Background gets a subtle 8-second pulsing vignette (barely perceptible).
- "ZONE" indicator appears on the combo orb, blue-white glow.
- Audio plays at 1.1x gain.
- Reviewer name in bottom bar switches to accent color.

**Zone maintenance:** Vignette intensifies every 5 decisions (three levels max).

**Zone exit:** Vignette fades over 1s. Shutdown sound. "ZONE LOST -- X decisions" banner.
Captured for session summary.

### 4.8 Rival Widget

Collapsed panel in the bottom bar showing:
- Current rank: `#3 of 12`
- Person above: `jsmith: 847` vs `you: 812` -- `35 behind`
- Person below: `mlopez: 789` -- `23 ahead`

On overtaking someone: "You passed jsmith!" toast with ascending 3-note audio. On being
overtaken: widget flashes red, `shutdown` at lower volume. Polls on each `/decide` response.

### 4.9 Multiplayer Presence

Up to 4 avatar dots in the bottom bar, one per active reviewer (decision in last 3 min).
Each dot gets a ring pulse when that reviewer makes a decision. Hover shows name, decisions
today, level.

Optional: thin collapsed activity feed (20px) on the right edge. "jsmith confirmed a fail,"
"mlopez flipped to pass (11x combo)." Entries fade in and auto-dismiss after 8s.

Piggybacked on the existing `/decide` response -- add an `activity` field with the last 3
events since the client's last poll timestamp.

### 4.10 Session Summary

When the queue empties, full-page centered card (max 480px):

```
SESSION COMPLETE

          [Giant counter: 42]
          Reviews this session

  Best Combo    Avg Speed     XP Earned
     7x           4.2s        +140 XP

  Today's Streak
  [Progress bar] 42 / 5 minimum for streak
  "Streak locked in!"

  Accuracy
  28 confirmed / 14 flipped (33% flip rate)

  [Badges earned this session]

  Personal Best?
  "New best combo: 7x (previous: 5x)"

  [Share]  [Dashboard]
```

Stats counter-animate from 0 to final value (600ms). Full-viewport confetti burst (80-120
particles, double wave). "Best zone: 18 decisions in flow" if applicable.

**Share button** copies Wordle-style text to clipboard:

```
Review Queue | 2026-03-04
42 reviews | 7x best combo | 4.2s avg
Lvl 3 -> Lvl 4 | +140 XP
```

---

## 5. Resilience and Trust

### 5.1 Optimistic Decision Submission

The moment the user presses Y or N, the card transitions away. The POST fires in parallel.
A pulsing dot in the bottom bar indicates in-flight.

- On `success: true`: dot clears, next item already visible.
- On 409: card re-appears with reverse animation, inline error on the card (not a modal).
- On network failure: decision queued offline (see 5.4).

Client keeps a `pendingDecision` snapshot for rollback.

### 5.2 Prefetching Next Items + Transcripts

When the client receives `peek` in a response, immediately fire a background fetch for the
peek item's transcript. Store in `prefetchCache` keyed by `findingId`. When peek becomes
current, pull from cache instead of waiting.

Use `requestIdleCallback` so prefetch doesn't compete with the keypress animation frame.
LRU eviction at 20 transcripts.

### 5.3 Session Persistence Across Refresh

On every successful claim, write to `sessionStorage`:

```js
{ findingId, questionIndex, claimedAt, reviewer }
```

On page load, if `claimedAt + 30min > now`, skip the splash -- go directly to re-claiming
the current item via `/next`. The server correctly handles a reviewer re-claiming their own
locked item. Clear the key on undo and on queue empty.

### 5.4 Offline Decision Queue

When a decision POST fails due to network error, store in `IndexedDB` with status `pending`.
Bottom bar shows amber dot: "1 decision queued -- reconnecting."

On `online` event, drain the queue:
- Success: delete from store.
- 409 (lock expired): surface to reviewer as "This item needs a new decision."
- Server error: increment retry counter, keep in queue.

Sync indicator disappears when queue is empty.

### 5.5 Lock Expiry Communication

At 25 minutes (5 min before lock expiry), a subtle yellow timer appears in the bottom bar:
"Lock expires in 4:52." At 2 minutes: amber. At 30 seconds: pulses. At 0: auto-fire `/next`
to re-claim.

Visually unobtrusive -- same size as the speed tracker. Not a warning modal.

### 5.6 Conflict Resolution

Extend the server's 409 response to include `reason: "lock_expired" | "lock_owned_by_other"`.

- `lock_expired`: "Your session timed out. Re-claiming..." and auto-fire `/next`.
- `lock_owned_by_other`: "Another reviewer is working on this. Skipping to next."

### 5.7 Connection Status Dot

A 6px dot in the bottom-left corner of the bottom bar:
- Green: connected (last heartbeat < 15s).
- Amber pulsing: degraded (15-60s).
- Red pulsing: offline (> 60s or `offline` event).

Hover tooltip: "Connected" / "Reconnecting..." / "Offline -- decisions queued locally."

Heartbeat: reuse the existing `/review/api/stats` ping every 10s. Also refreshes the
remaining count.

### 5.8 Saved Confirmation

After each successful decision POST, a small "Confirmed -- saved" or "Flipped -- saved"
text flashes for 1.5s in the bottom bar right side. Ambient, not disruptive.

### 5.9 Undo Confidence

Undo has no confirmation dialog. It is instant and trustworthy like Ctrl+Z.

On successful undo:
- Green left-border flash on the verdict panel (1.2s animation).
- "Restored" micro-banner at the top of the card (200ms fade-in, 1.2s hold, fade-out).
- Previous decision shown in meta: "Was: Confirmed 3s ago."
- 500ms debounce prevents accidental double-undo.
- Audio seek position restored to where the reviewer left off for this `findingId`.

### 5.10 Retry Strategy

Failed POSTs retry with exponential backoff: 500ms, 1s, 2s, 4s. After 4 retries, move to
offline queue. Retries are invisible to the reviewer. 409s are never retried -- they indicate
real conflicts.

### 5.11 Multi-Device Continuity

On page load, hit `GET /review/api/my-lock` to check for an existing lock held by this
reviewer. If found: "You have an active session on another device. Continue here?" with
"Continue here" (re-claim same item) and "Start fresh" (release lock, claim next).

---

## 6. Layout and Responsiveness

### 6.1 Density Modes

Three modes, cycled via `\` key or bottom bar toggle. Persisted in `localStorage`.

| Mode    | Left Panel | Transcript Font | Visible Elements                        |
|---------|------------|------------------|-----------------------------------------|
| Focused | 380px      | 13.5px           | Full question, defense, meta chips      |
| Dense   | 320px      | 12px             | Question + verdict only, compact padding |
| Wide    | 480px      | 13.5px           | Full detail, narrow transcript           |

### 6.2 Draggable Divider

8px drag handle between panels (invisible by default, 1px line on hover). Min 280px, max
600px. Persisted in `localStorage`.

### 6.3 Responsive Breakpoints

- **> 1200px:** Side-by-side (default).
- **900-1200px:** Left panel collapses to 320px.
- **< 900px:** Stacked layout. Verdict panel top (max 45vh), transcript below. Transcript
  forces single-column vertical scroll.

### 6.4 Transcript Zoom

`Alt+Z` expands the transcript to 80% viewport, collapsing the left panel to a 60px strip
showing only the header as rotated text and Y/N as icon-only buttons. `Alt+Z` again or any
decision key reverts.

---

## 7. Anti-Fatigue Patterns

### 7.1 Micro-Rest Cues

After every 25 decisions, a non-blocking toast: "25 done -- take a breath." The review can
continue immediately.

### 7.2 Pacing the Auto-Scroll

At session start, evidence auto-scroll is instant. After item 50, add a 100ms delay. Micro-
accommodation for fatigued eyes.

### 7.3 Decision Rhythm Indicator

A color-coded dot next to the speed display: green when at personal best pace, amber when
slower than average. Performance feedback that keeps reviewers engaged without pressure.

### 7.4 Drift Detection

Track the reviewer's personal flip rate. If significantly higher than team average (> 2x),
surface a subtle per-session note: "You're flipping more than usual -- was there a policy
change?" A meta-cognitive prompt to catch systematic drift.

---

## 8. Micro-Interactions

### 8.1 Progress Bar

- **Overshoot spring:** `cubic-bezier(0.34, 1.56, 0.64, 1)`. Bar briefly overshoots by
  ~0.5%, then settles.
- **Trail particle:** A 4px bright dot runs along the bar to the new position (300ms), then
  the fill catches up (400ms). Stripe's payment animation trick.
- **Milestone flashes:** At 25%, 50%, 75%: bar flashes white for 80ms. At 100%: confetti
  burst across full viewport.
- **Audit segment markers:** Tick marks at audit boundaries. When an audit completes, ticks
  absorb with a ripple animation.

### 8.2 Loading States

- **Shimmer on submit:** The moment `busy = true`, a shimmer animation sweeps the verdict
  panel. Content stays visible. Linear's loading pattern.
- **Skeleton on first load:** Gray animated shimmer bars where content will appear. Prevents
  layout shift. Notion/GitHub pattern.
- **Stale-while-revalidate for transcripts:** Aggressive caching keyed by `findingId`, LRU
  at 20 entries.

### 8.3 Defense Card Expand on Hover

`max-height: 4.5em` by default with `overflow: hidden`. On hover (desktop) or tap (mobile),
expands to full text over 200ms. Compresses the card for speed reviewers while preserving
access.

### 8.4 Thinking Section Content-Aware Expand

Calculate actual `scrollHeight` and animate to that value instead of a fixed `max-height:
500px`. No abrupt snap when content is short.

### 8.5 Transcript Evidence Line Entrance

On transcript render, evidence lines animate in with 50ms staggered `background-color:
transparent -> amber` transitions, ordered by DOM position. Draws the eye naturally.

### 8.6 Empty State Confetti

Full-viewport canvas burst: 80-120 particles in waves (first burst, second at +400ms). Vary
size (4-12px), shape (circle/rectangle), rotation speed. 2-3s with deceleration curve.

---

## 9. New Server Endpoints / Changes

| Change | Description |
|--------|-------------|
| `GET /review/api/transcript?findingId=X` | Lightweight transcript-only fetch for prefetching |
| `GET /review/api/my-lock` | Returns the reviewer's current lock (if any) for multi-device |
| `claimNextItem` returns `auditTotal` | Total questions in the audit (not just remaining) |
| `recordDecision` 409 includes `reason` | `"lock_expired"` or `"lock_owned_by_other"` |
| `/decide` response includes `activity` | Last 3 events from other reviewers (for presence) |
| `/decide` response includes `leaderboard` | Rank + nearest neighbors (for rival widget) |
