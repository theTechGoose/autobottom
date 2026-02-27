# Reviews & Appeals Spec

How audit results get challenged, reviewed, and
finalized. Covers the human-in-the-loop layer
between LLM output and resolved audits.

---

## 1. Context: Result Origins

AuditInstance.results[] is an append-only log.
Each entry has an origin:

- **llm** -- the initial automated audit. Pipeline
  produces this. Always the first result.
- **reviewer** -- a human reviewer's corrections.
  Only appended when the LLM result has "No" answers
  that need human judgment.
- **judge** -- a judge's ruling on an appeal. Only
  appended when an appeal is filed and decided.

The latest result in the array is the current truth.
Earlier results are history.

---

## 2. Review Flow

When the LLM result contains any "No" answers, the
audit does NOT auto-resolve. Instead:

1. AuditInstance status stays at a reviewable state.
2. A reviewer (human) inspects the flagged answers.
3. The reviewer can agree or override each answer,
   adding their own notes/reasoning.
4. `results.push(origin: reviewer)` -- a new
   AuditResult is appended with the reviewer's
   corrections.
5. AuditInstance moves to `resolved`.
6. If any questions were failed in the final result,
   a coaching item is queued for the agent's manager
   (see coaching flow below).

### ReviewChecklist (stored, per AuditInstance)

When the LLM result has "No" answers, a
ReviewChecklist is created for the AuditInstance.
It tracks per-question claiming and decisions as
a transient workflow object, separate from the
permanent results[] array.

```
ReviewChecklist
  auditId        the AuditInstance being reviewed
  items[]        one entry per question needing review
    questionId   which question
    claimedBy    email (null = unclaimed)
    lockedUntil  timestamp (30-min TTL)
    decision     confirm | flip | null
    decidedBy    email
    decidedAt    timestamp
```

### Concurrent Review (Claim Locks)

Multiple reviewers may be active simultaneously.
To prevent two reviewers from working the same
question:

1. Reviewer requests next item from queue.
2. System atomically claims an unclaimed checklist
   item (30-minute TTL, CAS operation on
   `claimedBy` + `lockedUntil`).
3. If claim acquired, item is served to reviewer.
4. If already claimed by another reviewer, item is
   skipped and next unclaimed item is served.
5. On decision submit, `decision`, `decidedBy`, and
   `decidedAt` are set. Lock is released.
6. On timeout (30 min), `claimedBy` and
   `lockedUntil` clear -- item returns to pool.

Reviewers can also "go back" to release their
current claim and return the item to the pool.

### Checklist Consolidation

When all items in the ReviewChecklist have a
non-null decision:

1. System consolidates the item decisions into a
   single AuditResult with `origin: reviewer`.
2. `results.push(origin: reviewer)` is appended to
   the AuditInstance.
3. The ReviewChecklist is archived (soft-deleted).
4. AuditInstance moves to `resolved`.

The checklist is a workflow artifact. The permanent
record is always the append-only results[] array.

### Who is a reviewer

Any user with the `audit-review` capability in their
role. Reviewers see audits scoped to their team
permissions. They cannot see peer reviewers' work
(visibility rule: see self + higher level numbers).

---

## 3. AppealRecord (stored)

Filed by the audited agent when they disagree with
the resolved audit result.

- **auditId** -- the AuditInstance being appealed.
- **findingId** -- the specific disputed finding
  (question ID where the agent disagrees with the
  answer).
- **filedByEmail** -- the agent who filed the appeal.
- **notes** -- the agent's reasoning for why the
  finding is wrong.
- **status** -- AppealStatus (see below).
- **judgeEmail** -- the judge assigned to or who
  resolved the appeal. Null until assigned.
- **auditorEmail** -- the original reviewer/auditor
  who produced the disputed result.

### Key

Standard KV entity with isActive soft-delete.

---

## 4. AppealType (enum)

- **redo** -- request a full re-audit of the same
  recording. Judge reviews all questions.
- **different-recording** -- agent claims wrong
  recording was used. A different recording is
  provided and a new audit runs against it.
- **additional-recording** -- agent provides
  supplemental recording evidence. New audit runs
  with the additional context.
- **upload-recording** -- agent uploads a recording
  file directly (not from the recordings service).

When appealType triggers a re-audit, the system
creates a new AuditInstance linked to the original
via `appealSourceFindingId`. The judge reviews the
complete re-audit result, not just the disputed
question.

---

## 5. AppealStatus (enum)

- **pending** -- appeal filed, awaiting judge review.
- **resolved** -- judge has made a decision.

---

## 6. AppealChecklist (stored, per AppealRecord)

When an appeal is filed, an AppealChecklist is
created for the judge to work through. Same pattern
as ReviewChecklist.

```
AppealChecklist
  appealId       the AppealRecord being judged
  auditId        the AuditInstance under appeal
  items[]        one entry per question under appeal
    questionId   which question
    claimedBy    email (null = unclaimed)
    lockedUntil  timestamp (30-min TTL)
    decision     uphold | overturn | null
    decidedBy    email
    decidedAt    timestamp
```

For single-finding appeals, items[] has one entry.
For `redo` appeal types (full re-audit), items[]
has one entry per question in the audit.

### Appeal Checklist Consolidation

When all items have a non-null decision:

1. System consolidates item decisions into a single
   AuditResult with `origin: judge`.
2. `results.push(origin: judge)` is appended to
   the AuditInstance.
3. The AppealChecklist is archived (soft-deleted).
4. AppealRecord status moves to `resolved`.
5. AuditInstance status moves back to `resolved`.

---

## 7. Appeal Flow

1. Agent views their resolved audit and disagrees
   with a specific finding.
2. Agent files an appeal: creates an AppealRecord
   with status `pending`. Emits `appeal.filed`.
3. AuditInstance status moves to `appeal-pending`.
4. An AppealChecklist is created for the appeal.
5. A judge is assigned. Emits `appeal.assigned`.
6. The judge works through the AppealChecklist,
   claiming and deciding items (same lock mechanics
   as ReviewChecklist).
7. When all checklist items are decided, the system
   consolidates into `results.push(origin: judge)`.
8. AppealRecord status moves to `resolved`.
   Emits `appeal.decided`.
9. AuditInstance status moves back to `resolved`.
10. If the final result still contains failed
   questions, coaching is queued.

### Who is a judge

Any user with the `appeals` capability in their role.
Judges must be at a higher authority level than the
reviewer whose result is being appealed. Judges
cannot appeal their own decisions.

---

## 8. Coaching Handoff

After an audit is resolved (whether through review
or appeal), if the final result has failed questions:

1. The audit ID is added to the agent's
   CoachingRecord.pending[] array.
   Emits `coaching.pending`.
2. The agent's manager sees the pending item in their
   coaching queue.
3. Manager reviews and addresses it, producing a
   CoachingAction with their notes.
   Emits `coaching.completed`.

This is a downstream effect, not part of the appeal
entity itself. See the Coaching domain for details.

---

## 9. Events

- **appeal.filed** -- agent submits an appeal.
  Payload: auditId, findingId, filedByEmail.
- **appeal.assigned** -- judge is assigned to the
  appeal. Payload: appealId, judgeEmail.
- **appeal.decided** -- judge resolves the appeal.
  Payload: appealId, auditId, outcome (upheld |
  overturned).

These integrate with EventConfig for notifications.
A common setup: `appeal.filed` triggers a webhook
or email to the judge pool.

---

## 10. Relationships

- **AppealRecord -> AuditInstance** (auditId) --
  the audit being challenged.
- **AppealRecord -> AuditQuestion** (findingId) --
  the specific question in dispute.
- **AppealRecord -> UserRecord** (filedByEmail,
  judgeEmail, auditorEmail) -- the participants.
- **AuditInstance.results[]** -- judge's decision
  is appended as a new AuditResult with
  origin: judge.
- **CoachingRecord** -- downstream effect when
  final result has failures.

---

## 11. Constraints

- An agent can only appeal a resolved audit. Cannot
  appeal while status is still in-flight.
- One appeal per finding per audit. Filing a second
  appeal on the same finding is rejected.
- Appeals do not cascade -- a judge's decision is
  final. There is no appeal-of-an-appeal.
- The judge's result replaces the reviewer's result
  as current truth (it's the latest in the
  append-only log).
