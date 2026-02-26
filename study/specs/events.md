# Events & Notification Channels Spec

## 1. Events (base primitive)

Events are the foundation. Something happened in
the app, conditions were met.

- Dot-scoped naming: `audit.resolved`,
  `audit.error.retrying`, `appeal.pending`, etc.
- Wildcard subscription: `audit.*`,
  `audit.error.*`
- Implementation: eventemitter2
- Every status transition in the app is an event

### Scopes

- `audit.pending`, `audit.transcribing`,
  `audit.questions.populating`,
  `audit.questions.asking`
- `audit.resolved`, `audit.appeal.pending`,
  `audit.error.retrying`, `audit.error.failed`
- `appeal.pending`, `appeal.resolved`
- `coaching.pending`, `coaching.completed`
- `result.llm`, `result.reviewer`, `result.judge`

### EventConfig

- name
- active
- trigger (dot-scoped pattern string, supports
  wildcards)
- fieldFilter[] (field keys that must change,
  empty = any)
- conditions (FilterGroup -- reuses Reports model)
- subject (event title with expression
  interpolation)
- owner

---

## 2. Notification Channels

Webhooks, emails, and chat are delivery channels
built on top of events. An event can have zero,
one, or many channels attached.

### WebhookChannel

- eventConfigId
- url
- method (POST | GET | PUT | PATCH | DELETE)
- format (JSON | XML | RAW)
- headers (key-value pairs)
- bodyTemplate (payload with expression
  interpolation)

### EmailChannel

- eventConfigId
- recipients[] (static, conditional per-user,
  or dynamic from field)
- body (rich HTML with expression interpolation
  + llm())
- fromAddress
- format (HTML | plain text)

### ChatChannel

- eventConfigId
- to (recipient email or dynamic from field)

Subject comes from the event -- email uses it as
subject line, chat uses it as message title,
webhooks can reference it via interpolation in
bodyTemplate.
