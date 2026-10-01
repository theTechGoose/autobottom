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
