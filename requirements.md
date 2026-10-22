# Requirements

Append-only. One entry per requirement, each with a stable id and links to the
tests that prove it.

---

## REQ-001 — The window label must name the window I actually asked for

> "I set the date to 9/26 - 9/26, so I'm just looking at the 26th by itself
> yeah? Well it still says '24 hours' in the corner."

On the admin Audit History page, the label in the page heading
(`Audit History (…)`) and on the Total stat card (`Total (…)`) must describe the
window that was actually queried:

- a preset button (1h / 4h / 12h / 24h / 3d / 7d) keeps its preset name;
- a typed date range names the dates instead — `Sep 26` for a single day,
  `Sep 22 – Sep 26` for a span, rendered in Eastern time;
- no date filter at all still reads `all`.

A one-day custom range spans ~24h, so the old span-bucketing logic labelled it
`24h` — which reads as "the last 24 hours" and is a different window entirely.

The typed range must also RESOLVE in Eastern. The Go button built its bounds
with `new Date(d+'T00:00:00')`, which reads the viewer's own zone: a UTC machine
asked for Sep 26 actually queried Sep 25 8PM – Sep 26 8PM Eastern, and then
honestly labelled that "Sep 25 – Sep 26". Found by driving the page in a
browser, not by the unit tests.

Tests: `frontend/tests/routes/api/admin-audit-history.test.tsx`
— "REQ-001 …" (unit). Integration/e2e: covered by the REQ-002 e2e drive of the
same page (one page, one render path).

---

## REQ-002 — FINISHED must be a real Eastern timestamp, and must not mean two things

> "the 'finished' column does not tell me when it was finished. it just says 1
> day ago. I want to know when it was actually 'finished' (so reviwed by a
> reviewer, right?) - with a timestamp in Eastern time."

The FINISHED column was ambiguous by construction: it renders the audit-done-idx
row's `completedAt`, and `writeSoleAuditDoneIndex` overwrites that field with the
review time on any reviewed row (`canonicalTs = reviewedAt ?? completedAt`). So
one column meant "reviewer finished" on some rows and "bot finished" on others,
with nothing on screen to say which.

The admin Audit History table must therefore:

- split that column in two — **Bot Done** (when the pipeline finished grading)
  and **Reviewed** (when a human finished reviewing);
- show `—` in Reviewed when nobody has reviewed the audit, and keep the existing
  `✓ Auto` pill for audits that never needed a review (`perfect_score`,
  `invalid_genie`);
- render Started, Bot Done and Reviewed as Eastern-time clock values
  (`9/26 2:41 PM`) rather than relative "1d ago" text, with the full
  date/time/zone on hover.

Scope is the admin page only — the CSV export and the manager Audit History page
are deliberately unchanged (asked and confirmed 2026-09-28).

Tests: `frontend/tests/routes/api/admin-audit-history.test.tsx`
— "REQ-002 …" (unit); e2e: driven in a browser against the Firestore emulator.

---

## REQ-003 — An audit that should be reviewed can't be appealed before it is

> "make it to where reports that aren't reviewed yet, that should be reviewed,
> do not have the ability to 'file appeal'."

Filing an appeal on an audit still in the review queue put the same failed
questions in front of a reviewer AND a judge at once, each deciding blind to the
other (prod finding `1O_T1qMvLZKQlUUJ1vgKi`, 2026-10-01). "Should be reviewed"
means the review queue picked the audit up (`review-audit-pending` exists);
"reviewed" means its review was finalized (`review-done` exists).

- The File Appeal button on the audit report and the manager remediation page
  renders as a disabled **Awaiting Review** pill while the audit waits.
- The server refuses every appeal path — judge appeal, different/additional
  recording, uploaded recording — with an "awaiting review" error, so the lock
  can't be bypassed by calling the endpoint.
- An audit the review queue never took (Invalid Genie, bypassed office) has
  nothing to wait for and stays appealable.

Tests: `src/audit/domain/business/file-appeal/test.ts`,
`src/audit/domain/business/reaudit/test.ts`,
`src/audit/domain/business/upload-reaudit/test.ts`,
`src/audit/entrypoints/audit/e2e.test.ts`,
`frontend/tests/islands/appeal-trigger-variant.test.tsx`,
`frontend/tests/components/audit-report.test.tsx` — every "REQ-003 …" test.

## REQ-004 — The appeal opens only once ALL failed questions are reviewed

> "Only until that report has been reviewed, and a reviewer finsihed reviewing
> ALL the failed questions on the report, can a user hit the 'file appeal'
> button"

A partly reviewed audit is still awaiting review. The lock lifts when the
review is finalized — which happens only after every failed question has a
decision — and not before.

Tests: `src/audit/domain/business/file-appeal/test.ts`,
`src/audit/entrypoints/audit/e2e.test.ts` — every "REQ-004 …" test.

## REQ-005 — The repo declares the merge gate's four tasks

> "A" — chosen from: "Add the four commands to `deno.json` on this branch.
> `test:unit` and `test:int` split the existing suite, and `serve` points at the
> emulator app."

`/wt:merge` refused every branch here — even with `--anyway` — because
`deno.json` lacked `test:unit`, `test:int` and `serve`. Now:

- `test:unit` — the frontend tests (pure renders, no services).
- `test:int` — the `src/` tests on the Firestore emulator, smoke tests left out
  (they move to `test:smoke`; `deno task test` still runs all three).
- `test:e2e` — `shots run` over the stories in `e2e/`, against `serve`.
- `serve` — the unified app on the emulator stack, on `$PORT`.

The gate runs the three lanes at once and they share one emulator stack (its
ports are fixed), so `tools/emulators/with-emulators.ts` now registers each run
that uses the stack: the first run starts it, the last run still using it stops
it, no run waits on another (a long-lived `serve` holds nothing up), a signal
stops the wrapped command instead of orphaning it, and
`EMULATOR_PROJECT` gives each run its own Firestore project. The older
`tests/e2e/` suites, which boot their own server, keep running as
`test:e2e:standalone`.

No tests — repo/gate wiring; proven by the gate's own run (`wt-gate` GREEN).

## REQ-006 — The login / register links are a hittable size

> "fix it"

The pre-merge hit-target audit flagged the login page's "Create organization"
link at 119×15 px, under the 24×24 minimum. The `.auth-link a` links (that one
and register's "Sign in") are now at least 24px tall, and so are links in the
audit report's metadata grid (the Record ID link to the CRM was 43×13 px).

Tests: `frontend/tests/routes/auth-link-target.test.ts` — "REQ-006 …" (unit).

## REQ-007 — An appeal's recording list starts with every recording the audit used

> "trace why it swapped instead of added" / "fix it"

A multi-recording audit (e.g. a pitch split across two genies) opened its
"Different Recording" appeal form with only the FIRST genie filled in. An agent
adding a callback typed it into a second row, submitted two IDs, and the
re-audit ran without the dropped recording (finding `Wb8LoMjcSjPAPmWY06uC4`
lost its main sales call and fell from 95 to 32). The form — on the audit
report and on the manager remediation page — now opens with every one of the
audit's `genieIds` filled in, so adding a recording appends to them.

Tests: `frontend/tests/lib/appeal-genie-ids.test.ts` — "REQ-007 …" (unit);
`e2e/appeal-genies/appeal-genies.e2e.test.ts` — "REQ-007 …" (e2e).

## REQ-008 — A re-audit that drops an original recording is never labelled "additional"

> "fix it"

`startReauditWithGenies` called a re-audit `additional-recording` whenever the
first genie was kept, even when another of the audit's recordings was missing
from the new list. It is `additional-recording` only when every original
recording is kept; otherwise `different-recording`.

Tests: `src/audit/domain/business/reaudit/test.ts` — "REQ-008 …" (int).

## REQ-009 — Genie Retry's "Find & re-run invalid genies" actually re-runs the audits

> "I'm trying to re-run the calls that fell through because the service is on now, why the fuck isn't this button working?"

In prod the run found 96 audits and never queued one. Each tick resets 5
audits through `resetFindingDerivedState`, which deleted the audit's
`audit-done-idx` rows by scanning the WHOLE index (110k rows, ~35s per scan
from a laptop), 5 scans per tick — past Deno Deploy's request budget, so no
tick ever finished and nothing was requeued. The reset now deletes those rows
by key (`deleteDoneIdxRowsForFinding`: the finding's completedAt/reviewedAt
plus the key pointer), so a tick costs a few point reads regardless of index
size.

Tests: `src/review/domain/business/review-queue/test.ts` — "REQ-009 …" (int);
`e2e/genie-retry/genie-retry.e2e.test.ts` — "REQ-009 …" (e2e).

## REQ-010 — A judged appeal closes no matter how many decisions the org has

> "okay so we can go even cheaper and actually load the fucking correct data? is that what you're saying?" / "okay worktree the fix man"

`postJudgedAudit` found an audit's judge decisions by scanning the org's whole
`judge-decided` set, capped at 1000 rows. Prod passed 1321, so an appeal whose
decisions fell past the cap read as "0 decisions" and the step quit: the
appeal stayed "pending", the overturned answer stayed "No", no result email
(x6StebJgPkhggCpqwdFQ5, judged 2026-10-12). It now reads the audit's decisions
by key, one point read per question — exact, and the same cost at any size.

Tests: `src/judge/domain/data/judge-repository/int.test.ts` — "REQ-010 …" (int).

## REQ-011 — Backfill the last 7 days of judged-but-stuck appeals, no emails

> "alright can we do a backfill script for just the last 7 days?" / "don't send"

REQ-010's bug left appeals fully judged but still "pending", answers
uncorrected. `tools/backfill-stuck-appeals.ts --days=7 [--commit]` finds every
appeal filed in the window that is still "pending" while every appealed
question has a judge decision, and re-runs `postJudgedAudit` on it with
`notify: false` — the appeal-result email is not sent. Dry run by default.
Prod dry run on 2026-10-14 found 16.

Tests: `src/judge/domain/business/appeal-close-backfill/int.test.ts` — "REQ-011 …" (int).

## REQ-012 — A Groq "output_parse_failed" falls back to the next model, never "Bot Error"

> "why did the matching IDs response error out?" / "Fix both in a worktree"

rrJvbO40W1Vk49iGFt7XC q[17] "Matching IDs" stored `answer: "Error"` with Groq's
raw 400 `output_parse_failed` (`failed_generation: ""`) as its reasoning, so the
report showed "Bot Error — Could Not Grade". `isModelDeadError` already treated
`json_validate_failed` as a reason to try the next model; `output_parse_failed`
(Groq's newer code for the same failure) was missing, so the 400 was rethrown
with no retry or fallback. It now falls back like `json_validate_failed`.

Tests: `src/audit/domain/data/groq/int.test.ts` — "REQ-012 …" (int).

## REQ-013 — The pre-review "perfect score" email fires only on a real 100%

> "so the report says 100% in the email, but it says there is a missed question, but if you click on the actual report, it says its a 96" / "Fix both in a worktree"

`stepFinalize` sent the terminate email with a hard-coded `score: 100` whenever
no answer was literally "No". An "Error" answer is neither Yes nor No, so
rrJvbO40W1Vk49iGFt7XC (24 Yes + 1 Error = 96%) mailed the rep "100%" while
listing the errored question as missed. The email now fires on the computed
`score === 100` — every answer Yes — the same score the report and the
audit-done index use; anything less waits for review.

Tests: `src/audit/domain/business/step-finalize/int.test.ts` — "REQ-013 …" (int).
## REQ-014 — The scrub page plays every recording of a multi-recording audit

> "it says on the report, there are two recordings, and they load, but the srub page does not have two recordings. Why" / "yes build it"

`/audit/scrub` hard-coded the audio bar to recording 1 (`idx=0`), so the second
recording of Pxsca8VF5NlibMlX7xP8Q could not be played from it. The bar now has
a REC tab per recording (`QueueAudioPlayer recordingCount`), and the record
details list every recording ID.

Tests: `frontend/tests/islands/queue-audio-controls.test.tsx` — "REQ-014 …" (unit);
`e2e/scrub-recordings/scrub-recordings.e2e.test.ts` — "REQ-014 …" (e2e).

## REQ-015 — Clicking a line on a multi-recording audit plays its own recording at its time

> "We have two different recordings? So why wouldn't switching to the second recording allow us to click on 00:00 of recording 2? and there is a new transcript?" / "yes build it"

The multi-recording pipeline dropped AssemblyAI's per-line times because each
recording restarts at 0:00. It now stores `recordingLineTimes` (each line's
start on its own recording) and `recordingLineIdx` (which recording) next to the
joined text, on the finding and the transcript store; step-transcribe records
which recording each transcript is so a skipped one doesn't shift the rest. The
scrub view labels where each recording starts, and a clicked line — or a
question's evidence line — switches the bar to that recording and seeks. The
grader still reads the joined text, and `utteranceTimes` stays empty for these
audits so the review/judge players (recording 1 only) never mis-seek.

Tests: `src/audit/domain/business/step-poll-transcript/test.ts`,
`src/audit/domain/business/step-transcribe/test.ts`,
`src/audit/domain/business/step-transcribe-cb/test.ts`,
`src/audit/domain/business/read-finding/int.test.ts` — "REQ-015 …" (int);
`frontend/tests/components/transcript-panel.test.tsx`,
`frontend/tests/routes/audit-scrub.test.tsx` — "REQ-015 …" (unit);
`e2e/scrub-recordings/scrub-recordings.e2e.test.ts` — "REQ-015 …" (e2e).

## REQ-016 — Backfill the line times for multi-recording audits already transcribed

> "Audits already processed would need their transcripts re-fetched from AssemblyAI to get the times back. The transcript IDs are saved on each audit, so that's doable." / "yes build it"

`tools/backfill-recording-lines.ts --id=<findingId>[,…] | --days=N [--commit]`
re-reads each audit's own AssemblyAI transcripts and stores the times only when
the rebuilt text equals the stored transcript. Dry run by default. Prod dry run
on 2026-10-19 (`--days=2`): 9 would update; Pxsca8VF5NlibMlX7xP8Q is skipped —
it has no AssemblyAI transcript ids stored.

Tests: `src/audit/domain/business/recording-lines-backfill/int.test.ts` — "REQ-016 …" (int).

## REQ-017 — Three appeal buttons instead of one "File Appeal"

> "Instead of having it hidden behind the single button, we need three buttons up top. An 'Appeal Decision' button An 'Add Genie' button An 'Direct Upload' button" / "where it is now, centered under the score. yes give the remediation queue three buttons up top with the same labelling. sure add the otehr ones first."

Agents filed judge appeals to say the audio cut out or the second genie was in
the notes, because the one "File Appeal" button led to a choice card whose
"Appeal Decision" side read like what they had just clicked. The single
button, the choice card and the recording/upload tabs are gone: the audit
report (centred under the score) and the manager remediation topbar both show
**Add Genie**, **Direct Upload** and **Appeal Decision**, in that order, each
opening its own modal.

Tests: `frontend/tests/islands/appeal-trigger-variant.test.tsx`,
`frontend/tests/components/audit-report.test.tsx` — "REQ-017 …" (unit);
`e2e/appeal-actions/appeal-actions.e2e.test.ts` — "REQ-017 …" (e2e).

## REQ-018 — Every appeal modal explains what its path does

> "behaves the way it does today, but this modal and all modals will explain more in-depth, so it'll explain that the original genie can be overwritten, and you can add more."

Add Genie still starts with every genie the audit used and can add, replace or
remove them (REQ-007/008). Each modal now says when to use it and what
submitting does: Add Genie explains that added genies are joined and audited as
one call and that overwriting the original audits a different recording;
Direct Upload explains it is for audio that isn't in Genie; Appeal Decision
explains a judge re-hears only this audit's recording.

Tests: `e2e/appeal-actions/appeal-actions.e2e.test.ts` — "REQ-018 …" (e2e).

## REQ-019 — Appeal Decision points missing-audio cases at the other modals

> "Yes add that line. AGain, these modals need to explain a bit more. If the person hits appeal decision, and sees it, there should be a button that just switches to the other modal it selected"

The Appeal Decision modal says a judge can't hear audio that isn't there, with a
button that switches straight to Add Genie (and one to Direct Upload).

Tests: `e2e/appeal-actions/appeal-actions.e2e.test.ts` — "REQ-019 …" (e2e).

## REQ-020 — One path used locks all three

> "all three lock. So with the add and upload ones, the new report gets made. if those are used and submitted, the 'view new report' button replaces all three. if they appeal decision, all 3 are replaced with 'appeal filed' etc etc"

After a submitted Add Genie or Direct Upload the three buttons become one
**View New Report** link to the new audit (a re-audit with no new id on record
stays a "Re-Audited" pill); after an Appeal Decision they become **Appeal
Filed**; while the audit waits for review they are **Awaiting Review**
(REQ-003). Same right after submitting, without a refresh.

Tests: `frontend/tests/islands/appeal-trigger-variant.test.tsx` — "REQ-020 …"
(unit); `e2e/appeal-actions/appeal-actions.e2e.test.ts` — "REQ-020 …" (e2e).
