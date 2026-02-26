# Supervisor Capability Spec

Team-level user who reviews audit results, coaches
agents, and monitors team performance. Sits below
admin in the hierarchy.

---

## 1. Scope

- Operates at their assigned team and any
  descendant teams within their permissions[].
- Cannot see peers at the same level.
- Sees agents below them (higher level number =
  less access, more visible to those above).

---

## 2. Capabilities (sidebar tabs)

- Dashboard (team-level metrics, customizable)
- Audit Review (review LLM results, submit
  reviewer overrides via results.push with
  origin: reviewer)
- Coaching (view pending coaching queue, address
  failed audits, leave coaching notes)
- Reports (create/view within permission scope)
- Dashboards (create/customize within scope)

---

## 3. Data Visibility

- Sees their team + descendant teams per
  permissions[].
- Can see agents in their scope.
- Cannot see other supervisors, judges, or
  analysts at the same level.
- Logging label filter: scoped to their team.

---

## 4. Key Responsibilities

- Review audit results flagged with "No" answers
  from the LLM
- Submit reviewer results (origin: reviewer) to
  override or confirm LLM findings
- Resolve the audit instance to "resolved" status
- Coach agents on failed audits: review the
  coaching queue (CoachingRecord.pending[]),
  leave notes, mark coaching completed
- Monitor team performance through reports and
  dashboards

---

## 5. Audit Review Flow

1. LLM produces results (origin: llm)
2. If any answer is "No", audit lands in
   supervisor's review queue
3. Supervisor reviews transcript, LLM reasoning,
   and RAG docs
4. Submits reviewer result (confirms or overrides
   each finding)
5. Audit moves to "resolved"
6. If agent failed questions, a coaching item is
   created in CoachingRecord.pending[]
