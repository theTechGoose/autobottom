# Email Report Feature — Implementation Plan (Revised)

## Status

Phase 1 (original implementation) is complete. Phase 2 (revised architecture)
is complete. All must-have and medium-priority items are implemented and staged
on the `feature/email-reports` branch for end-to-end testing on Deno Deploy.

---

## What Changed and Why

The original engine queried `CompletedAuditStat` — a KV entry written at bot
finalization with a 24-hour TTL. This was wrong for two reasons:

1. **Wrong timestamp.** `CompletedAuditStat.ts` is when the bot finished, not
   when the audit was truly done. Human reviews and appeal verdicts happen
   after bot finalization and do not update `ts`. A report filtered to "last
   24 hours" captured "bot processed in last 24 hours," not "fully completed
   in last 24 hours."

2. **Expires too fast.** The 24h TTL means any audit bot-finalized more than
   a day ago is invisible to the engine, even if it was reviewed today. This
   makes payroll-period reporting impossible.

The fix is a **permanent secondary index** written at audit completion events,
keyed by `completedAt` (bot finalization time), carrying both `completedAt`
and `doneAt` (true completion time). The engine queries this index instead of
`CompletedAuditStat`.

---

## Mental Model

```
onlyCompleted (master toggle — default ON)
    Query index by doneAt in dateRange    → only fully done audits
    OFF:
    Query index by completedAt in dateRange → everything bot processed,
    "marked for review" label on score > 0% and < 100% with no doneAt

        ↓

topLevelFilters (CriteriaRule[])
    Apply to every finding that passed the master filter
    e.g. appealStatus not_equals "pending"

        ↓

sections (one per table in the email)
    Each section filters within what topLevelFilters passed
    ├── header
    ├── criteria (CriteriaRule[])
    └── columns
```

---

## "Done" Definition

An audit is considered done when it reaches one of these terminal states:

| Category            | Done when                          | doneAt source       |
|---------------------|------------------------------------|---------------------|
| Auto-pass (100%)    | Bot finalization                   | `completedAt`       |
| Invalid genie (0%)  | Bot finalization                   | `completedAt`       |
| Human reviewed      | Review counter hits zero           | `reviewedAt`        |
| Appeal complete     | Uses `reviewedAt` (see note below) | `reviewedAt`        |

**Appeal note:** Appeals must be completed within 48 hours. The drift between
`reviewedAt` (review completion) and appeal verdict is small enough for payroll
reporting. A dedicated appeal-completion timestamp is a future improvement.
For now: `appealStatus != pending` excludes in-progress appeals, and
`reviewedAt` is the timestamp used for appeal-complete findings.

**Not done:** Any audit with `findingStatus = "finished"` but no `reviewedAt`
and a score between 0% and 100% exclusive is still sitting in the human review
queue. These appear with a "marked for review" label when `onlyCompleted` is
off.

---

## Secondary Index

### Purpose

A permanent, queryable index of every audit that has passed through
`finalize.ts`, keyed by `completedAt` so date-range queries are efficient.
No TTL — entries persist indefinitely.

### KV Key Shape

```
orgKey(orgId, "audit-done-idx", paddedCompletedAt, findingId)
```

`paddedCompletedAt` is the timestamp as a zero-padded 16-character string so
lexicographic ordering matches chronological ordering. This enables Deno KV
range queries using `start` / `end` options.

### Entry Shape

```ts
interface AuditDoneIndexEntry {
  findingId: string
  completedAt: number   // bot finalization — this is reflected in the KV key
  doneAt?: number       // true completion time — set when completed flips true
  completed: boolean    // false = still in review queue
  reason?: "perfect_score" | "invalid_genie" | "reviewed"
  score: number
}
```

### Lifecycle

**Written at bot finalization (`finalize.ts`):**
- Auto-pass (score = 100): `completed: true`, `doneAt = completedAt`,
  `reason = "perfect_score"`
- Invalid genie: `completed: true`, `doneAt = completedAt`,
  `reason = "invalid_genie"`
- Goes to review queue (0 < score < 100): `completed: false`, no `doneAt`,
  no `reason` yet

**Updated when human review completes (`review/kv.ts` `postCorrectedAudit`):**
- `completed: true`, `doneAt = reviewedAt`, `reason = "reviewed"`
- Key does not change — same `completedAt` key, value updated in place

### Query Strategy

- **`onlyCompleted = true`**: fetch all index entries in the `completedAt`
  range, then filter in code to `entry.completed === true` and
  `entry.doneAt` within the `dateRange`. Slightly wider scan but correct
  results. Acceptable at current volumes.

- **`onlyCompleted = false`**: fetch all index entries where `completedAt`
  falls within the `dateRange`. Return all. Label entries with
  `completed: false` and `score > 0` as "marked for review."

---

## Data Model Changes

### `EmailReportConfig` — needs update

```ts
interface EmailReportConfig {
  id: string
  name: string
  createdAt: number
  updatedAt: number

  // Master filter
  onlyCompleted: boolean          // default true — filter by doneAt
                                  // false — filter by completedAt, show all

  // Date range (replaces implicit rolling 24h window)
  dateRange: DateRangeConfig

  // Schedule
  schedule?: ScheduleConfig

  // Recipients
  recipients: string[]
  cc?: string[]
  bcc?: string[]

  // Report definition
  templateId?: string
  topLevelFilters?: CriteriaRule[]
  reportSections?: ReportSectionDef[]
  disabled?: boolean
}
```

### `DateRangeConfig` — new

```ts
type DateRangeConfig =
  | { mode: "rolling"; hours: number }
    // last N hours from now — e.g. { mode: "rolling", hours: 24 }
    // covers daily reports, last 7 days (168h), etc.
  | { mode: "fixed"; from: number; to: number }
    // explicit UTC timestamps — covers payroll periods,
    // e.g. { mode: "fixed", from: 1743465600000, to: 1744070400000 }
```

**Note on payroll use case:** Payroll reports use `mode: "fixed"` with the
first and last day of the pay period. The UI will need date pickers for these.
`mode: "rolling"` with `hours: 168` covers "last 7 days" from whenever the
report runs.

### `ScheduleConfig` — no change

Existing simple/cron schedule modes remain as-is.

### `CriteriaRule` — no change

Existing field/operator/value structure remains as-is. All rules are AND logic
within a section. OR logic is a future enhancement.

### `ReportSectionDef` — no change

### `ReportColumnKey` — no change

---

## What Is Already Built and Still Valid

These do not need to change:

- `lib/report-renderer.ts` — HTML rendering, QB links, score colors,
  EST timestamps, `{{sections}}` template injection. Fully valid.
- `lib/kv.ts` — `EmailReportConfig` CRUD, `EmailTemplate` CRUD, preview
  cache. Needs schema update for `onlyCompleted` and `dateRange` only.
- `providers/postmark.ts` — `sendEmail()` unchanged.
- `main.ts` — schedule runner (Deno.cron every minute), send-now endpoint,
  preview endpoint, save handler. Logic unchanged; schema fields update
  automatically once config is updated.
- `dashboard/page.ts` — most of the modal UI. Schedule builder, recipients,
  top-level filters, section builder, save/send-now/preview buttons all valid.
  Needs: `onlyCompleted` toggle, date range widget, removal of old 24h
  assumption from any UI copy.

---

## What Needs to Be Built

### 1. Secondary index writer — `lib/kv.ts`

New functions:
- `writeAuditDoneIndex(orgId, entry: AuditDoneIndexEntry): Promise<void>`
  Writes or updates the index entry. Key derived from `completedAt`.
- `queryAuditDoneIndex(orgId, from: number, to: number): Promise<AuditDoneIndexEntry[]>`
  Range scan using padded timestamp keys. Returns all entries where
  `completedAt` is between `from` and `to`.

### 2. Index write at bot finalization — `finalize.ts`

At line ~116 after `trackCompleted`:
- Auto-pass: write index entry `completed: true`, `doneAt = completedAt`,
  `reason = "perfect_score"`
- Invalid genie: write index entry `completed: true`, `doneAt = completedAt`,
  `reason = "invalid_genie"`
- Goes to review: write index entry `completed: false`, no `doneAt`

### 3. Index update at review completion — `review/kv.ts`

In `postCorrectedAudit`, after `saveFinding` and setting `reviewedAt`:
- Update the existing index entry: `completed: true`,
  `doneAt = Date.now()`, `reason = "reviewed"`
- Must look up the entry by `findingId` to get its `completedAt` key.
  Requires either storing `completedAt` on the finding (already there) or
  a reverse lookup. `finding.completedAt` is already set by `finalize.ts`
  so use that.

### 4. Rebuild report query engine — `lib/report-engine.ts`

Replace `queryReportData` entirely:
- Resolve date window from `config.dateRange`
- Call `queryAuditDoneIndex(orgId, from, to)`
- If `onlyCompleted`: filter entries to `completed === true` and
  `doneAt` within range
- If not `onlyCompleted`: use all entries in range, tag incomplete ones
- For each entry: `getFinding`, resolve appeal status, apply
  `topLevelFilters`, then per-section criteria — same as today
- Remove all references to `getAllCompleted` and `CompletedAuditStat`

### 5. Schema update — `lib/kv.ts`

- Add `onlyCompleted: boolean` to `EmailReportConfig`
- Add `dateRange: DateRangeConfig` to `EmailReportConfig`
- Remove/ignore old `cadence`, `cadenceDay` fields in save handler
- Update `saveEmailReportConfig` to persist new fields

### 6. Frontend — `dashboard/page.ts`

- Add `onlyCompleted` master toggle (default checked) above top-level filters
- Replace any "24-hour window" copy with date range widget
- Date range widget: mode selector (rolling / fixed) + inputs
  - Rolling: number input + unit (hours / days)
  - Fixed: two date pickers (from / to)
- Wire `onlyCompleted` and `dateRange` into save payload

### 7. Template selector — `dashboard/page.ts` (Task 14b, unchanged)

Dropdown populated from `GET /admin/email-templates`. Wire `templateId`.
Not yet implemented.

### 8. `{{sections}}` hint in template builder (Task 14c, unchanged)

Add placeholder to the documented variables bar. Not yet implemented.

---

## Backfill Plan

This is a test/playground environment. The approach is:

1. Wipe relevant KV entries (findings, stats, review queue)
2. Seed fresh audits — hand-pick findings that include "MCC Not Egregious?"
   marked as No, to validate section criteria directly
3. Run those audits through the full pipeline so the secondary index is
   populated correctly from the start
4. No migration of historical data needed

---

## Open Items

### Must-have before first real report run
- [x] Secondary index (write + query) — `lib/kv.ts`
- [x] Index write at finalization — `finalize.ts`
- [x] Index update at review completion — `review/kv.ts`
- [x] Report engine rewrite — `lib/report-engine.ts`
- [x] Schema update (`onlyCompleted`, `dateRange`) — `lib/kv.ts`
- [x] Frontend: `onlyCompleted` toggle + date range widget — `dashboard/page.ts`

### Medium priority
- [x] Template selector dropdown (Task 14b)
- [ ] `{{sections}}` hint in template builder (Task 14c)
- [x] Preview for unsaved configs (inline preview endpoint — `POST /admin/email-reports/preview-inline`)
- [x] "Marked for review" column in rendered email rows when `onlyCompleted = false`

### Pending UI improvements (next session)
- [x] Label: "Finding ID" → "Audit Report" (renders as hyperlink to audit report)
- [x] Label: "Finalized At" → "Timestamp"
- [x] Operator dropdown fixed width — all three columns (field/operator/value) always align
- [x] `Question Answer` filter → dropdown: `Yes`, `No`
- [x] Rename `Reason` field label → `Condition`; dropdown: `Perfect Score`, `Invalid Genie`,
      `Reviewed` (values sent as `perfect_score`, `invalid_genie`, `reviewed`)
- [x] `Appeal Status` filter → dropdown: `None`, `Pending`, `Complete`
      (values sent as `none`, `pending`, `complete`)
- [x] `Audit Type` filter → dropdown: `Internal`, `Partner`
      (values sent as `internal`, `partner`)
- [x] Remove `Reviewed` field from the field selector entirely — superseded by `Condition`

### Future / post-launch
- [ ] `Destination` column — add `DestinationDisplay` from finding record (e.g. `WYN - New York`), confirm field exists in QB before implementing
- [ ] Hardcode question list for internal + partner audits — searchable dropdown for Question Header filter (see plan.md for full spec)
- [ ] Hardcode department codes + office codes — searchable dropdown for Department filter
- [ ] Dedicated appeal-completion timestamp — currently `reviewedAt` is used
      for appeal-complete audits. A proper `judgedAt` field written by
      `postJudgedAudit` in `judge/kv.ts` is the correct long-term solution.
- [ ] OR logic in criteria rules — needed for "reviewed=true OR
      reason=perfect_score OR reason=invalid_genie" type filters.
- [ ] Backfill script for production — when this is promoted to the live
      system, a one-time script will need to walk all existing findings and
      populate the secondary index from `completedAt` and `reviewedAt`.
- [ ] `lib/storage/dtos/email.ts` — stale DTO, update or remove.

---

## First Use Case — Daily MCC Report

Once implementation is complete, configure and verify:

**Report name:** Daily MCC / Invalid Genie Report
**onlyCompleted:** true
**dateRange:** `{ mode: "rolling", hours: 24 }`
**Schedule:** Simple / Daily / 7:00 AM EST / Every day

**Top-level filters:**
- `appealStatus not_equals "pending"`

**Section 1 — MCC Non-Compliance (Valid Genie)**
- Criteria:
  - `questionHeader equals "MCC Not Egregious?"`
  - `questionAnswer equals "No"`
  - `reason not_equals "invalid_genie"`
- Columns: Record ID, Finding ID, Guest Name, VO Name

**Section 2 — MCC Non-Compliance (Invalid Genie)**
- Criteria:
  - `questionHeader equals "MCC Not Egregious?"`
  - `questionAnswer equals "No"`
  - `reason equals "invalid_genie"`
- Columns: Record ID, Finding ID, Guest Name, VO Name, Appeal Status

---

## Notes and Decisions

- **`onlyCompleted` default:** true. 95% of reports only care about truly done
  audits. The checkbox exists for edge cases, not the common case.
- **Date range on scheduled reports:** `rolling` mode. The cron fires at the
  scheduled time and resolves the window from `Date.now()`. Fixed-range reports
  are one-time sends via Send Now or Preview.
- **`completedAt` as index key:** Chosen because it is always set at
  finalization for every audit. `doneAt` is stored in the value and filtered
  in code. This means querying by `doneAt` requires a slightly wider key scan
  but is correct and acceptable at current volumes.
- **Appeal timestamp:** `reviewedAt` used for appeal-complete audits. The
  48-hour appeal window makes the drift acceptable for payroll reporting.
  `judgedAt` is the proper fix and is tracked as a future item.
- **`CompletedAuditStat` not removed:** Still used by the admin dashboard
  pipeline stats view. Only the email report engine stops using it. The stat
  entries continue to be written by `finalize.ts` as before.
- **EST / DST:** `Intl.DateTimeFormat` with `"America/New_York"` everywhere.
- **Preview cache:** Still invalidated on every config save. Unchanged.
- **Old configs:** Existing `EmailReportConfig` entries without `onlyCompleted`
  or `dateRange` will default to `onlyCompleted: true` and a 24h rolling window
  in the engine until re-saved with the new schema.
