# Events Spec

Three kinds of events flow through the system:
AppEvent (personal), BroadcastEvent (org-wide),
and Message (direct). EventConfig reacts to any
event in the catalog and delivers via a unified
CommunicationProvider interface.

---

## 1. AppEvent (stored, TTL 24h, per user)

Ephemeral personal event. Delivered to the user
who triggered or is affected by the action.
Expires after 24 hours.

- type -- any event from the event catalog
- payload -- Record<string, unknown>

Use case: real-time UI updates, toast
notifications, badge progress ticks, combo
triggers.

### Client Transport: Server-Sent Events (SSE)

AppEvents and BroadcastEvents are delivered to
connected clients via SSE. The client opens a
persistent connection to the events endpoint.
New events are pushed as they occur.

- Endpoint: `GET /api/events` (SSE stream)
- Reconnection handled by browser EventSource API
- Events delivered as JSON payloads with type field
- Events consumed (deleted) after delivery

---

## 2. BroadcastEvent (stored, TTL 24h, org-wide)

Org-wide announcement visible to everyone in the
organization. Expires after 24 hours.

- type -- any event from the event catalog
- triggerEmail -- who triggered the event
- displayName -- shown name
- message -- display text
- animationId -- animation to play

Use case: sale completed banners, perfect score
celebrations, level-up announcements. These drive
the gamification feed -- visible on dashboards and
in the activity stream.

### Prefab Event Definitions

System ships with pre-defined broadcast event
types. Each PrefabEventDef provides:

- type -- event identifier
- label -- display name
- description -- what triggers it
- icon -- display icon
- defaultMessage -- template function for the
  broadcast message

### Prefab Subscriptions

Supervisors/managers subscribe to prefab events
for their team. Subscription is a per-user
Record<eventType, boolean> toggle. When a prefab
event fires and the user is subscribed, a
BroadcastEvent is created for them.

---

## 3. Message (stored)

Direct message between two users. Persistent
(no TTL).

- from -- sender email
- to -- recipient email
- body -- message content
- ts -- sent timestamp
- read -- read flag

---

## 4. EventConfig (stored)

Reactive automation. When an event fires and
conditions are met, deliver a notification via
the configured communication type.

- name -- display name
- active -- on/off toggle
- trigger -- any event from the catalog (dot-scoped
  pattern string, supports wildcards like
  `audit.instance.*`)
- fieldFilter[] -- field keys that must change
  (empty = any change fires)
- conditions -- FilterGroup (reuses the
  Reports filter model: FilterGroup >
  FilterCondition with conjunction AND/OR)
- communicationType -- webhook | email | chat | sse
- receivers[] -- URLs, emails, or channel IDs
  depending on communicationType
- payloadTemplate -- expression-interpolated
  template that renders into the provider's
  payload shape (see expressions.md)
- owner -- user who configured this

### Flow

```
event emitted via emit()
  -> match against EventConfig.trigger
  -> check fieldFilter (if non-empty, only fire
     if one of the listed fields changed)
  -> evaluate conditions (FilterGroup)
  -> render payloadTemplate with expression engine
  -> dispatch via CommunicationProvider.send()
```

Dispatch happens in waitUntil() -- non-blocking,
does not delay the response.

---

## 5. CommunicationProvider (interface, runtime)

Not stored. Runtime abstraction that sends the
rendered payload to receivers.

- type -- webhook | email | chat | sse
- send(receivers, payload) -- Promise<void>

EventConfig.communicationType selects which
provider implementation handles delivery.

### WebhookCommunicationProvider

- receivers -- URLs
- payload -- { url, method, headers, body }
  (RequestInit shape, passed directly to fetch)

### EmailCommunicationProvider

- receivers -- email addresses
- payload -- { subject, body, from }
- Resolves credentials from the email
  ProviderConfig via ServiceBinding (see
  services.md). Walk up the team tree to find
  the email provider for the owner's team.

### ChatCommunicationProvider

- receivers -- channel IDs
- payload -- { message, threadId? }
- Resolves bot tokens from the chat ProviderConfig
  via ServiceBinding.

### SseCommunicationProvider

- receivers -- user emails (connected SSE clients)
- payload -- the rendered payloadTemplate, delivered
  as a JSON event on the user's SSE stream
- If receivers is empty, the event is broadcast to
  all connected clients in the team scope.
- Uses the same `GET /api/events` SSE connection
  that AppEvent/BroadcastEvent use. EventConfig-
  triggered SSE events appear alongside system
  events on the same stream.

---

## 6. Event Catalog

All emit() calls in the app. These are the valid
values for AppEvent.type, BroadcastEvent.type,
and EventConfig.trigger. Dispatched via
waitUntil(), matched by EventConfig.

### AuditConfig

- audit.config.created
- audit.config.modified
- audit.config.deleted
- audit.config.versionPublished

### AuditQuestion

- audit.question.created
- audit.question.modified
- audit.question.deleted
- audit.question.testPassed
- audit.question.testFailed

### AuditInstance

- audit.instance.created
- audit.instance.transcribing
- audit.instance.transcribed
- audit.instance.transcriptionFailed
- audit.instance.asking
- audit.instance.completed
- audit.instance.failed
- audit.instance.retrying
- audit.instance.resolved

### AuditResult

- audit.result.appended.llm
- audit.result.appended.reviewer
- audit.result.appended.judge

### Appeal

- appeal.filed
- appeal.assigned
- appeal.decided

### Coaching

- coaching.pending
- coaching.completed

### Team

- team.created
- team.modified
- team.deleted
- team.memberAdded
- team.memberRemoved
- team.leaderChanged

### RoleDef

- role.created
- role.modified
- role.deleted

### User

- user.created
- user.modified
- user.deactivated
- user.reactivated
- user.passwordChanged
- user.login
- user.loginFailed

### Session

- session.created
- session.expired

### Dashboard

- dashboard.created
- dashboard.modified
- dashboard.shared
- dashboard.deleted

### Report

- report.created
- report.modified
- report.deleted

### Player

- player.xpEarned
- player.xpSpent
- player.levelUp
- player.streakIncremented
- player.streakBroken

### Badge

- badge.earned
- badge.progressUpdated

### Store

- store.itemPurchased
- store.themeEquipped
- store.comboPackEquipped

### Message

- message.sent
- message.read

### Broadcast

- broadcast.saleCompleted
- broadcast.perfectScore
- broadcast.levelUp

### EventConfig

- eventConfig.created
- eventConfig.modified
- eventConfig.deleted
- eventConfig.triggered
- eventConfig.deliveryFailed

### Schedule

- schedule.report

### Provider

- provider.created
- provider.modified
- provider.deleted

### ProviderConfig

- providerConfig.created
- providerConfig.modified
- providerConfig.deactivated
- providerConfig.reactivated

### ServiceBinding

- serviceBinding.created
- serviceBinding.modified
- serviceBinding.deleted
- serviceBinding.fallbackTriggered
- serviceBinding.circuitBreakerOpened
- serviceBinding.circuitBreakerClosed
- serviceBinding.referenceOrphaned

### Generic CRUD

- record.created
- record.modified
- record.deleted

### Unscoped

- breakingChange
