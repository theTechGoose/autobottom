# Providers & Services

> Infra wiring + execution kernel

---

## Provider `stored` (defined by developer)

| Field | Description |
| ----- | ----------- |
| `type` | db \| llm \| storage \| email \| auth |
| `name` | display name ("OpenAI", "S3", etc.) |
| `configSchema` | FieldDef[] -- fields admin fills in |
| `code` | implementation string, executed in sandbox |
| `send(payload)` | fire-and-forget via sandboxed worker |
| `guaranteeSend(payload)` | pessimistic: send + reconcile, returns receipt |

**Relationships:**
- owns internal Idempoter instance

---

## IdempotencyRecord `stored` (Deno KV, per idempotency key)

| Field | Description |
| ----- | ----------- |
| `key` | `sha256(code + canonicalize(payload))` |
| `state` | locked \| succeeded \| unknown \| failed |
| `lockedUntil` | lease expiry timestamp |
| `attempts` | execution count |
| `updatedAt` | last state change |

---

## ProviderConfig `stored` (per team, configured by admin)

| Field | Description |
| ----- | ----------- |
| `teamId` | which team this config applies to |
| `type` | db \| llm \| storage \| email \| auth |
| `providerId` | which Provider definition |
| `config` | filled-in values matching configSchema |
| `delegateTo[]` | child team IDs allowed to override |

**Relationships:**
- references Provider (providerId)
- belongs to Team (teamId)

**Resolution cascade:** child team -> parent team -> org root -> platform

---

## ServiceBinding `stored` (per team, cascades with delegation)

| Field | Description |
| ----- | ----------- |
| `teamId` | which team |
| `service` | named app function (e.g. audit-questions, transcription) |
| `providers[]` | ordered ProviderConfig IDs (0 = default, rest = fallback) |
| `delegateTo[]` | child team IDs allowed to override |

**Relationships:**
- references ProviderConfig[] (providers)
- belongs to Team (teamId)

---

## Resolution & Fallback Rules

- **Resolution:** walk up team tree, first match wins. Override only if parent's
  `delegateTo[]` includes child.
- **Fallback:** 5xx / network error -> next provider in chain. 4xx = caller
  problem, no fallback. Circuit breaker on N failures.
- **Dead refs:** deactivated ProviderConfig (`isActive=false`) skipped at
  resolution, fires `referenceOrphaned` event.
- **Credentials:** encrypted at rest, encryption key scoped at developer level.
