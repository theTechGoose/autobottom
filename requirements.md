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
