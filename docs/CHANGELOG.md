# Changelog

Concise log of notable feature changes on `main`, newest first. Dates are commit
dates. This is a curated highlight reel, not every commit — see `git log` for the
full history and [README.md](../README.md) for how each subsystem works.

---

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
