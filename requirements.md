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
