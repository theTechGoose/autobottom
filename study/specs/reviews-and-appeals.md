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

### Who is a reviewer

Any user with the `reviewer` capability in their
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

## 4. AppealStatus (enum)

- **pending** -- appeal filed, awaiting judge review.
- **resolved** -- judge has made a decision.

---

## 5. Appeal Flow

1. Agent views their resolved audit and disagrees
   with a specific finding.
2. Agent files an appeal: creates an AppealRecord
   with status `pending`. Emits `appeal.filed`.
3. AuditInstance status moves to `appeal-pending`.
4. A judge is assigned. Emits `appeal.assigned`.
5. The judge reviews the original transcript, the
   LLM result, the reviewer result, and the agent's
   appeal notes.
6. The judge decides:
   - **Upheld** -- original finding stands. Judge
     appends `results.push(origin: judge)` confirming
     the existing answer.
   - **Overturned** -- finding reversed. Judge appends
     `results.push(origin: judge)` with the corrected
     answer.
7. AppealRecord status moves to `resolved`.
   Emits `appeal.decided`.
8. AuditInstance status moves back to `resolved`.
9. If the final result still contains failed
   questions, coaching is queued.

### Who is a judge

Any user with the `judge` capability in their role.
Judges must be at a higher authority level than the
reviewer whose result is being appealed. Judges
cannot appeal their own decisions.

---

## 6. Coaching Handoff

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

## 7. Events

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

## 8. Relationships

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

## 9. Constraints

- An agent can only appeal a resolved audit. Cannot
  appeal while status is still in-flight.
- One appeal per finding per audit. Filing a second
  appeal on the same finding is rejected.
- Appeals do not cascade -- a judge's decision is
  final. There is no appeal-of-an-appeal.
- The judge's result replaces the reviewer's result
  as current truth (it's the latest in the
  append-only log).
