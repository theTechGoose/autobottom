# Gap Analysis: Brain Dump Study vs Codebase Implementation

Analyst: reconciliation of `/study/` documents against `/autobottom/` repository.

---

## 1. Naming Alignment

The study defines the canonical terms for Autobottom 2. The v1 codebase uses different names for several of these. During development, all references adopt the study terms.

| Canonical Term | v1 Codebase Name | Migration Note |
|---|---|---|
| AuditInstance | AuditFinding | Rename entity; absorb AuditJob batch fields into AuditBatch |
| AuditResult[] (append-only) | ReviewDecision / JudgeDecision | Collapse separate KV namespaces into single results array |
| Team | OrgRecord | Replace flat org with nestable team tree |
| RoleDef | Role enum | Replace hardcoded string union with stored KV entity |
| Player | GameState | Rename; already aligned on totalXp + tokenBalance |
| CoachingRecord / CoachingAction | ManagerQueueItem / ManagerRemediation | Restructure from per-finding to per-agent |
| AppealStatus: `resolved` | AppealRecord.status: `"complete"` | Rename `complete` to `resolved` |
| InstanceStatus: `appeal-pending` | (not in v1) | New status, add during migration |

---

## 2. Partially Mapped / Inconsistently Described

### 2.1 Event Types Mismatch

**Study catalog events:** 60+ events across all domains (audit, appeal, coaching, team, role, user, session, dashboard, report, player, badge, store, message, broadcast, eventConfig, schedule, provider, providerConfig, serviceBinding, record, breakingChange).

**Code event types:** 5 SSE events (`audit-completed`, `review-decided`, `appeal-decided`, `remediation-submitted`, `message-received`).

**Gap:** The study's event catalog is aspirational -- it defines all events that SHOULD exist once the full system is built. The code implements a tiny subset.

---

## 3. Summary Matrix (unresolved only)

| Domain | Code Status | Study Status | Gap |
|---|---|---|---|
| Auth / Roles | Hardcoded enum | Dynamic RoleDef | Migration from enum to data-driven roles |
| Results model | Scattered KV namespaces | Unified append-only array + ReviewChecklist/AppealChecklist | Structural migration |
| Manager/Coaching | Per-finding | Per-agent | Structural migration |
| Badges | Function-based check() | Declarative filter/threshold (canonical) | Migration from code to data |
| Event catalog | 5 SSE types | 60+ events + EventConfig | Build full catalog and EventConfig system |
| Team hierarchy | Flat orgs | Nestable teams | Build tree structure |

---

## 4. Reconciliation Items for Autobottom 2

These are structural differences between the current
codebase and the study that will be resolved during
development:

1. **Role system migration** -- hardcoded enum to dynamic RoleDef
2. **Results model migration** -- scattered KV namespaces to unified append-only array with ReviewChecklist + AppealChecklist for per-question workflow
3. **Coaching model migration** -- per-finding to per-agent
4. **Naming alignment** -- AuditFinding -> AuditInstance, GameState -> Player, etc.
5. **Event catalog + EventConfig** -- 5 SSE events to full 60+ catalog with EventConfig notification system
6. **Provider abstraction** -- direct modules to configurable providers
7. **Team hierarchy** -- flat orgs to nestable teams
8. **Badge system migration** -- function-based check() to study's declarative filter/threshold model
