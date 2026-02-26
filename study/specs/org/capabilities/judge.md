# Judge Capability Spec

Team-level user who resolves appeals. Acts as an
independent arbiter when an agent disputes an
audit finding.

---

## 1. Scope

- Operates at their assigned team and descendant
  teams within their permissions[].
- Cannot see peers at the same level.
- Independent from supervisors -- judges review
  appeals, not regular audit results.

---

## 2. Capabilities (sidebar tabs)

- Dashboard (appeal metrics, customizable)
- Appeals (view pending appeals, review disputed
  findings, submit judge decisions)
- Reports (create/view within permission scope)
- Dashboards (create/customize within scope)

---

## 3. Data Visibility

- Sees their team + descendant teams per
  permissions[].
- Can see agents and appeal records in their scope.
- Cannot see other judges, supervisors, or
  analysts at the same level.

---

## 4. Key Responsibilities

- Review appeals filed by agents
  (AppealRecord.status: pending)
- Examine the original audit, LLM results,
  reviewer results, transcript, and the agent's
  appeal notes
- Submit judge result (origin: judge) to confirm
  or overturn the disputed finding
- Resolve the appeal (AppealRecord.status:
  resolved)
- Audit re-resolves after judge decision; coaching
  item created if agent still has failed questions

---

## 5. Appeal Flow

1. Agent files appeal on a specific finding
   (AppealRecord created, audit moves to
   appeal-pending)
2. Appeal assigned to judge (appeal.assigned event)
3. Judge reviews all evidence
4. Judge submits result (results.push with
   origin: judge)
5. Appeal marked resolved
6. Audit moves back to resolved
