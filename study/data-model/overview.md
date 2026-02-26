# Auto-Bot Data Model

Unified data model for the Auto-Bot audit application.

---

## Legend

- **Stored** -- KV entity (persisted in Deno KV)
- **Embedded** -- sub-object (nested inside a stored entity)
- **Computed** -- derived at read time (not persisted)
- **Enum / Interface** -- type definition

All stored entities have an `isActive` field (default true, false = soft-deleted).

---

## Domain Map

```
                      Root Team
                          |
     +--------+--------+--------+--------+--------+--------+--------+--------+
     |        |        |        |        |        |        |        |        |
   Teams    Users    Audit    Review  Coaching Reports  Gamify  Events  Providers
     |        |     /     \              |                 |        |
  (nest)   RoleDef Template Execution  CoachingRecord   Player  EventConfig
                    |        |                                  /    |    \
              AuditConfig  AuditInstance                   webhook email chat
                    |        |
             AuditQuestion  AuditResult[]
                    |        (append-only)
              QuestionTest
```

## Section Index

| File | Domain | Key Entities |
| ---- | ------ | ------------ |
| [teams-roles-auth.md](./teams-roles-auth.md) | Teams, Roles & Auth | Team, RoleDef, UserRecord, Session, Visibility Rule |
| [dashboards-navigation.md](./dashboards-navigation.md) | Dashboards & Navigation | Sidebar, DashboardPage, WidgetSlot, WidgetType |
| [audit-template.md](./audit-template.md) | Audit Template | AuditConfig, AuditQuestion, QuestionType, QuestionTest, FieldDef, SkipRule, RagRetrieveParams, PipelineConfig |
| [audit-execution.md](./audit-execution.md) | Audit Execution | AuditInstance, AuditResult, AnswerEntry, SkippedEntry, TranscriptData, AstResults, RagDoc |
| [review-appeals.md](./review-appeals.md) | Review & Appeals | AppealRecord, AppealStatus |
| [coaching.md](./coaching.md) | Coaching | CoachingRecord, CoachingAction |
| [reports.md](./reports.md) | Reports | Report, ReportQuery, ReportOptions, ReportProperties, ReportFolder |
| [gamification.md](./gamification.md) | Gamification | Player, Avatar, Inventory, Effect, StoreItem, ThemeDef, ComboPack, BadgeDef, GamificationSettings |
| [events.md](./events.md) | Events | AppEvent, BroadcastEvent, Message, EventConfig, CommunicationProvider |
| [providers-services.md](./providers-services.md) | Providers & Services | Provider, ProviderConfig, ServiceBinding, IdempotencyRecord |
| [logging.md](./logging.md) | Logging | Log Entry (Grafana Cloud) |
| [event-catalog.md](./event-catalog.md) | Event Catalog | All emit() calls grouped by domain |
| [audit-lifecycle.md](./audit-lifecycle.md) | Audit Lifecycle | Pipeline flow, status transitions, post-audit branching |

## Entity Relationships

```
Team (root, parentId: null) ---- (*) Team (children, nestable)
    |                                      |
    |                                  leaderId + memberEmails[]
    |
    +---- (*) RoleDef { level, capabilities[], permissions[] }
    |
    +---- (*) UserRecord ---- (1) RoleDef (via roleId)
    |              |
    |              +---- (*) DashboardPage (owned or shared, per role)
    |
    +---- (*) AuditConfig (1) ---- (*) AuditQuestion (1) ---- (*) QuestionTest
    |              |                         |
    |              |                    QuestionType (stored)
    |              |
    |              +---- (*) AuditInstance (via configId)
    |                           |
    |                           +---- AuditResult[] (append-only: llm | reviewer | judge)
    |                           |
    |                           +---- (0..1) AppealRecord
    |                           |
    |                           +---- (0..1) CoachingRecord
    |
    +---- (*) Report ---- (1) ReportFolder
    |
    +---- (*) Player (per user)
    |              |
    |              +---- BadgeProgress[], EarnedBadge[]
    |              +---- Avatar, Inventory, EventBinding[]
    |
    +---- (*) Effect, StoreItem, ThemeDef, ComboPack, BadgeDef
    +---- (*) EventConfig ---- CommunicationProvider (webhook | email | chat)
    +---- (*) Provider ---- (*) ProviderConfig ---- (*) ServiceBinding
    +---- (*) Message (per conversation pair)
    +---- (*) AppEvent (per user, TTL 24h)
    +---- (*) BroadcastEvent (org-wide, TTL 24h)
    +---- (1) GamificationSettings (+ per-team overrides)
