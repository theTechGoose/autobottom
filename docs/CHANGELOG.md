# Changelog

Concise log of notable feature changes on `main`, newest first. Dates are commit
dates. This is a curated highlight reel, not every commit — see `git log` for the
full history and [README.md](../README.md) for how each subsystem works.

---

## 2026-06-23 — Audit report "Transcript Context" is a focused diarized excerpt (brick-wall fix)

- **Per-question Transcript Context no longer renders the raw grading snippet.**
  `step-ask-all` stores `answeredQuestion.snippet` = the *raw* context the bot
  graded against; for short calls (≤8000 chars) that's the **entire** raw
  transcript, and when AssemblyAI fails to separate speakers the raw transcript
  is a single un-segmented `[AGENT]:` line — the "giant brick wall" under each
  question on `/audit/report`. New helper
  [transcript-excerpt.ts](../frontend/lib/transcript-excerpt.ts)
  (`buildFocusedExcerpt`) rebuilds the context from `finding.diarizedTranscript`
  (Groq's speaker-split version — what the top Transcript already uses), narrowed
  to the turns matching the question's `defense` quote (document-frequency-weighted
  token overlap), with graceful fallbacks: a character window for a true
  single-line brick, and the full speaker-split transcript when nothing
  confidently matches. **Render-only** — the grading pipeline is unchanged, so
  every existing finding is fixed on next view.
  ([AuditReport.tsx](../frontend/components/AuditReport.tsx))
- **Review/judge queue TranscriptPanel** had the same brick risk (it prefers the
  raw transcript when utterance timestamps are present); it now falls back to the
  diarized transcript when raw is a single un-segmented line — the timestamps
  can't align to a one-line brick anyway.
  ([TranscriptPanel.tsx](../frontend/components/TranscriptPanel.tsx))
- The report's snippet **Copy** button reads a clean `data-copy` payload
  (speaker-labeled, newline-joined, no `⋯` gap markers) instead of scraping glued
  `textContent`.
- _Post-review polish (no behavior change):_ documented the source/output
  precedence atop `buildFocusedExcerpt`; split `STOPWORDS` into commented
  english/defense-prose groups; extracted a `renderSegments` helper in
  `AuditReport`; added regression tests pinning the snippet-only fallback source,
  the `data-copy` payload contract, and the smart-quote ReDoS bound.

## 2026-06-17 — Reports gated behind "Run now" + watchdog terminal-status guard

- **Reports modal is idle until "Run now"** — every tab (Question Failures, Email
  Engagement, Reviewer Throughput, Weekly Reports) now waits for an explicit **▶
  Run now** click instead of auto-firing on modal/tab open. A wide-range Email
  Engagement run had fanned out an unbounded `Promise.all` of per-finding reads,
  saturating the 10-slot foreground Firestore lane and 503'ing the whole app
  until a redeploy. Weekly Reports' configs/statuses fetch moved into an
  on-demand fragment ([reports/weekly.tsx](../frontend/routes/api/admin/modal/reports/weekly.tsx)).
- **Email Engagement cohort cap + throttle** — `getEmailEngagement` /
  `getEmailEngagementDetail` now read at most the most-recent `HYDRATE_CAP` (2000)
  audits via a bounded `mapWithConcurrency` (25-wide) instead of one `Promise.all`
  over the whole cohort, so a wide window can no longer wedge the foreground
  Firestore lane. The headline shows "most recent N of M audits" when capped.
  ([email-engagement/mod.ts](../src/reporting/domain/business/email-engagement/mod.ts))
- **Watchdog terminal-status guard** — the hourly watchdog now skips (and clears
  the stale `active-tracking` row for) any stuck finding that already reached
  `finished`/`terminated`, instead of blindly re-publishing it. Re-dispatching a
  completed/in-review finding was re-preparing it back to `asking-questions`,
  wiping the reviewer's in-progress decisions and tripping the review-finalize
  refusal guard (the recurring `finalize — findingStatus="asking-questions"`
  canary error). ([watchdog/mod.ts](../src/cron/domain/business/watchdog/mod.ts))

## 2026-06-11 — Judge queue stats + canary hardening

- **Judge queue header** — the queue now shows the dashboard's `N / M
  questions / audits` split (global pending) where it used to read "N
  remaining", refreshed after every decide/undo/dismiss. Stats are fetched via a
  shared `fetchJudgeStats` helper ([lib/api.ts](../frontend/lib/api.ts)) that
  never rejects, so a `/judge/api/stats` outage degrades to the honest per-audit
  "N remaining" instead of blanking the queue or showing a fake "0 / 0".
- **Canary error tracking hardened** — `trackError` now also fires from the
  caught-and-degraded paths the step dispatcher can't see (Pinecone, AssemblyAI
  pre-upload, genie per-role download, review `finalize`), tagging each error
  `recovered` vs `unrecovered` so the daily monitor pages only on genuinely
  stuck findings. Error strings are redacted (URL query strings, userinfo,
  bearer/JWT tokens) before landing in the persisted store, and dedup is now
  identity-based (`findingId|step|ts`) so same-millisecond bursts no longer drop
  rows. See [README.md](../README.md) → Canary errors endpoint.

## 2026-06-03 — UI fixes

- **Audit report** — reviewer handle-time badges (the per-question `⏱ Xs` and the
  score-block total) are now admin-only on the public report. It is a render-time
  gate on existing data, so it applies retroactively to every finding.
- **Pipeline Activity chart** — reserve a top band for the legend so the series
  line can never overwrite the Retries / Errors legend at peak values (the line's
  highest point now sits below the legend by construction).

## 2026-06-03 — QA Audit Analytics

- **Failed Audits dashboard** (`/admin/failed-audits`, admin) — failures-only
  analytics. New `failureSource` attribution (`autobot` / `vo_app` /
  `team_member` / `unknown`), auto-seeded from review/judge signals and
  admin-overridable per question on the audit report. Four views: exact failed
  findings, appealed-and-still-failed, failure-by-question, and a department ×
  question matrix, plus a "#1 fail for [TM] in [dept] for [week]" drill-down with
  graceful scope degradation. ISO-week + TM/dept/shift/question/source filters.
  Backed by a new idempotent `failed-finding-idx` (rebuilt at finalize / review
  flip / judge / re-audit) with backfill + reset in Data Maintenance.
- **Reviewer Performance** — per-reviewer overturn rate (time-ranged + lifetime,
  denominator = appealed-and-judged questions) with a per-question-header
  breakdown, surfaced on the Reviewer Throughput report. New
  `src/review/domain/business/reviewer-quality`.
- **Reviewer Throughput "Avg / question" fix** — the top-row card and per-reviewer
  column now show the true per-question mean (from hydrated samples) instead of
  whole-audit handle time spread over question count (which rounded to ~0s).
- **Test gate hardening** — fixed pre-existing test-file drift (a missing
  `auditsData` arg; over-strict content-type assertions) and added a `check:tests`
  task wired into `deno task verify` so `src/**/*.test.ts` type/arity drift is
  caught by the gate.

## 2026-06-03 — Reviewer Throughput (handle time)

- Server-measured per-audit (cadence-based) and per-question (decision-gap) handle
  time, populated across all history; full-page pop-out + by-reviewer/by-question
  pivots. Durations are never trusted from the client (only an idle flag is).

## 2026-06-02 — Reports & error observability

- **Reports pop-out pages** — full-page versions of the Question Failures + Weekly
  Reports modal tabs (range bar, drill-down, filters).
- **Email Engagement** — open tracking (Apple-Mail-prefetch filtered) + click
  tracking + appeal correlation; default-to-Today modal + full-page drill-down.
- **Canary errors endpoint** — secure `POST /canary/errors` returning the previous
  day's persisted step errors (bearer-auth via `CANARY_SECRET`).

## 2026-05-28 — Pipeline reliability + dashboard

- Fixed `diarize-async` clobbering finalized findings via a stale `getFinding`
  cache; parallelized compound-question grading and dropped the dead ask-batch
  path; Recently Completed table now shows genie number(s).

## 2026-05-26 / 27 — Transcript race hardening + Admin Audits + impersonation

- **Transcript payload-carry** extended through every pipeline hop
  (init→transcribe→poll→cb→prepare→diarize→ask-all→ask-batch) to survive
  cross-isolate Firestore replication gaps, with a `🔍 [TRANSCRIPT-RACE]`
  diagnostic tag. Resolved a class of Invalid-Genie / lost-transcript incidents.
- **Admin Audits** (`/admin/audits`) — Genie column, "likely no-transcript" Score
  State filter (read-only), per-row Retry, page-clamp + self-healing index.
- **Audit Counts** — background multi-tick deep scan with email + CSV attachment.
- **Manager impersonation** — `?as=` forwarded through `/manager` redirects + nav.

## 2026-05-25 — Gamification + real-time + judge analytics

- **Gamification lane** — XP, badges, day streaks, sound packs, store, and
  cosmetic surfaces across every role dashboard; Gamification Admin modal; Reset
  XP maintenance tool; judge XP wiring.
- **Real-time SSE** — global event toaster, chat stream, and a cross-page bell
  badge over an in-process pub/sub bus (polling fallback).
- **Judge analytics** — `getMyJudgeStats` moved to an indexed-range
  `judge-decided` query (no more full-collection scans).

## 2026-05-22 — Reporting foundation

- **Reports modal** — Question Failures rollup + Weekly Reports preview.
- **Scheduled email reports** — cron-driven report sends + QStash parallelism
  cleanup.
- Routed `/admin/impersonate-go` through Fresh (not Danet).
