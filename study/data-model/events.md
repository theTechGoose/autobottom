# Events

> emit(), react, notify

---

## AppEvent `stored` (TTL 24h, per user)

| Field | Description |
| ----- | ----------- |
| `type` | any event from the event catalog |
| `payload` | `Record<string, unknown>` |

---

## BroadcastEvent `stored` (TTL 24h, org-wide)

| Field | Description |
| ----- | ----------- |
| `type` | any event from the event catalog |
| `triggerEmail` | who triggered |
| `displayName` | shown name |
| `message` | display text |
| `animationId` | animation to play |

---

## Message `stored`

| Field | Description |
| ----- | ----------- |
| `from` | sender email |
| `to` | recipient email |
| `body` | message content |
| `ts` | sent timestamp |
| `read` | read flag |

---

## EventConfig `stored` (event reactions)

Configurable reactions that fire when events match certain conditions.

| Field | Description |
| ----- | ----------- |
| `name` | display name |
| `active` | on/off toggle |
| `trigger` | any event from the event catalog |
| `fieldFilter[]` | field keys that must change (empty = any) |
| `conditions` | FilterGroup -- post-change filter (reuses FilterGroup/FilterCondition from Reports) |
| `communicationType` | webhook \| email \| chat \| sse |
| `receivers[]` | URLs \| emails \| channel IDs (by type) |
| `payloadTemplate` | renders into the provider's payload shape |
| `owner` | user who configured |

---

## CommunicationProvider `interface` (runtime, not stored)

| Field | Description |
| ----- | ----------- |
| `type` | webhook \| email \| chat \| sse |
| `send(receivers, payload)` | `Promise<void>` |

---

## WebhookCommunicationProvider `runtime`

| Field | Description |
| ----- | ----------- |
| `receivers` | URLs |
| `payload` | `{ url, method, headers, body }` -- RequestInit (fetch) |

---

## EmailCommunicationProvider `runtime`

| Field | Description |
| ----- | ----------- |
| `receivers` | email addresses |
| `payload` | `{ subject, body, from }` |

Resolves creds from email ProviderConfig via ServiceBinding.

---

## ChatCommunicationProvider `runtime`

| Field | Description |
| ----- | ----------- |
| `receivers` | channel IDs |
| `payload` | `{ message, threadId? }` |

Resolves bot tokens from chat ProviderConfig via ServiceBinding.

---

## SseCommunicationProvider `runtime`

| Field | Description |
| ----- | ----------- |
| `receivers` | user emails (empty = broadcast to team scope) |
| `payload` | rendered payloadTemplate, delivered as JSON on SSE stream |

Pushes to connected clients on the same `GET /api/events` SSE stream used by AppEvent/BroadcastEvent.
