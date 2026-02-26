# Coaching Spec

Post-audit follow-up. When an agent fails questions
on an audit, a coaching item lands in their
supervisor's queue. The supervisor reviews the
failure, leaves notes, and marks it addressed.

Coaching is downstream of audit resolution. Both
the reviewer path (has "No" answers) and the appeal
path (judge decision) can produce coaching items.

---

## 1. CoachingRecord (stored, per agent)

One record per agent. Accumulates over time.

- agentEmail -- the agent being coached. This is
  the KV key (one record per agent).
- pending[] -- string array of audit IDs awaiting
  coaching. Append-only until addressed.
- completed[] -- CoachingAction (embedded) array.
  Resolved coaching items with full context.

### Lifecycle

```
audit resolved with failed questions
  -> audit ID appended to agent's pending[]
  -> supervisor sees it in coaching queue
  -> supervisor reviews, leaves notes
  -> CoachingAction created in completed[]
  -> audit ID removed from pending[]
```

The record is never deleted. completed[] is a
permanent history of all coaching interactions for
an agent. pending[] is a work queue that drains as
supervisors address items.

---

## 2. CoachingAction (embedded in CoachingRecord)

A single resolved coaching interaction.

- auditId -- the audit instance that was addressed.
  References AuditInstance.
- failedQuestionIds[] -- string array of question
  IDs the agent failed. References AuditQuestion.
  Captured at coaching creation time so the record
  is self-contained even if the audit config changes
  later.
- managerEmail -- supervisor who addressed it.
- managerNotes -- the coaching feedback. Free text.
  What the supervisor told the agent about the
  failure.
- addressedAt -- timestamp when coaching was
  completed.

---

## 3. Trigger: When coaching items are created

A coaching item is created when an audit resolves
with failed questions. Two paths lead here:

### Reviewer path

1. LLM produces results with "No" answers.
2. Supervisor reviews and submits reviewer result
   (origin: reviewer).
3. Audit moves to resolved.
4. System checks final results for failed questions.
5. If failures exist, audit ID appended to
   CoachingRecord.pending[] for the agent.

### Appeal path

1. Agent files appeal on a finding.
2. Judge reviews and submits judge result
   (origin: judge).
3. Audit re-resolves.
4. System checks final results for failed questions.
5. If failures remain after the judge's decision,
   audit ID appended to CoachingRecord.pending[].

In both cases, "failed questions" means the final
result (latest in AuditResult[]) has answers where
the agent's performance did not meet the expected
answer from the AuditQuestion.

---

## 4. Who interacts with coaching

### Supervisor (writes)

- Sees coaching queue: all pending[] items for
  agents in their scope (team + descendants per
  permissions[]).
- Reviews the audit instance, transcript, LLM
  reasoning, and reviewer/judge results.
- Leaves coaching notes and marks addressed.

### Agent (reads)

- Sees their own coaching records.
- Receives notification when coaching is completed
  (coaching.completed event).
- Read-only -- agents cannot modify coaching records.

### Analyst (reads)

- Can query coaching records within their scope
  for reporting and trend analysis.

---

## 5. Events

- coaching.pending -- fired when audit ID is
  appended to an agent's pending[].
- coaching.completed -- fired when a supervisor
  marks a coaching item addressed.

These feed into the EventConfig system. Typical
use: email the agent when coaching is completed,
alert the supervisor when new coaching items arrive.
