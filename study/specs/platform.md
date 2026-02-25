# Platform: Developer Role, Providers & Services

## 1. Developer Capability [X]

A developer is a platform-level user whose team spans
multiple orgs. They can impersonate any admin and
everything down the tree. They create providers and
publish marketplace items. Their default dashboard shows
app-wide stability and performance metrics.

- Developer is RoleDef level 0. Admin moves to level 1.
  All existing levels shift down by one.
- Developer is a capability, not a role. The team works
  the same way -- a lead, members, the full tree.
  Typically higher scope because they need to effect
  changes on a wide area. A developer at the bottom
  could exist but could only affect his team.
- The developer capability team typically sits as a
  parent above all org root teams in the existing
  hierarchy.
- Impersonation: developer picks an admin below them,
  enters as admin, navigates normally from there. If
  we start nesting impersonation we need the ability
  to go back up so you can return to where you were
  and have natural navigation.
- Every org starts with blank provider configs.
  Developer can impersonate admins to set these up if
  needed.

## ~~2. Logging [ ]

Developer-level observability across the entire app.
Full text search, log levels, structured data -- but
cost effective.

Logging is a platform-level system, not a per-org
provider. The developer configures one logging backend
for the whole platform. All orgs write to it.

**Stack:** Grafana Loki (backend: log storage and query
engine, no UI) + Grafana (frontend: dashboards and
search UI). Two separate products from Grafana Labs.

**Recommended deployment:** Grafana Cloud (managed
Loki + managed Grafana, single bill). Free tier covers
50 GB/month of logs. No containers, no infra, no
upgrades. If compliance requires logs to stay on owned
infrastructure, self-hosted Loki on a single VM with
S3 backend is the fallback.

**Storage:** S3 as the backing store. Loki handles the
hot/cold split internally:

- Ingesters hold recent data in memory (hot logs),
  queryable instantly.
- Loki flushes ingester data to S3 as compressed
  chunks on a configurable interval (not wall-clock
  based -- avoids timezone problems across orgs).
- Queries spanning hot and cold data pull S3 chunks,
  merge with ingester data, and cache results locally.

**Configuration (not custom code):**

- `retention_period` -- how long S3 chunks live before
  deletion.
- `ingester.chunk_idle_period` -- flush cadence for
  inactive streams.
- Query result caching -- TTL for cached query
  results.

**Log shape:** timestamp, level (debug/info/warn/
error), service, teamId, userId, message, structured
data (Record<string, unknown>).

**Visibility scoping:** Label filtering on existing
team tree permissions. Developer sees all labels.
Admin filters to their org's teamIds. Users filter to
their team. No new capability needed.

## ~~3. Providers [ ]

Infrastructure integrations. The developer defines what
a provider looks like (its config schema). Admins fill
in credentials for their org.

### Provider (defined by developer)

| Field        | Description                           |
| ------------ | ------------------------------------- |
| type         | db \| llm \| storage \| email \| auth |
| name         | display name ("OpenAI", "S3", etc.)   |
| configSchema | FieldDef[] -- fields admin fills in   |

### ProviderConfig (configured by admin, per team)

| Field        | Description                            |
| ------------ | -------------------------------------- |
| teamId       | which team this config applies to      |
| type         | db \| llm \| storage \| email \| auth  |
| providerId   | which Provider definition              |
| config       | filled-in values matching configSchema |
| delegateTo[] | child team IDs allowed to override     |

### Cascading Resolution

Walk up the team tree until you find a ProviderConfig
for the requested type. A child team can only override
if the parent's `delegateTo[]` includes their teamId.

### Credentials

Stored encrypted at rest. Encryption key scoped at the
developer level.

### Multiple Configs Per Type

Multiple ProviderConfigs of the same type are allowed
per team. Uniqueness is on the ProviderConfig ID, not
on (teamId, type). This enables quality tiers (e.g.
a cheap LLM for transcription and a premium LLM for
reasoning) and meaningful fallback chains where both
providers live at the same tree level.
ServiceBindings reference specific ProviderConfig IDs.

### Simplicity Rules

1. ProviderConfig is a flat bag of values. No logic,
   no hooks. Filled-in fields matching configSchema.
   Validation is FieldDef's job.
2. Resolution is one function. Given teamId + type,
   walk up the tree, return first match. No caching,
   no inheritance merging, no overrides beyond
   delegateTo[].
3. Subsystem boundary: providers own configs and
   resolution. ServiceBindings own wiring and
   fallback. They communicate through ProviderConfig
   IDs only. Each subsystem fits in one file.

### Schema Changes

When a developer updates a Provider's configSchema,
existing ProviderConfigs may become invalid. Handling:

- New field with a default: existing configs keep
  working (FieldDef `default?` fills the gap).
- New required field without a default: existing
  configs show a warning in the admin UI until
  updated. Before saving, the developer sees "this
  will invalidate X existing configs."
- No schema versioning system. FieldDef defaults are
  the migration mechanism.

### Breaking Change Event

`configSchema.error.breakingChange` -- a new value in
the existing EventTrigger enum (no new event system).
Fires when: required field added without default, field
removed, or field type changed. Payload: provider ID,
before/after schema diff, count of affected configs,
list of affected team IDs. Admins subscribe via
EventConfig with their own endpoint, same as any other
platform event.

## ~~4. Services & Service Bindings [ ]

A service is a named app function that needs a provider.
ServiceBindings wire services to providers with ordered
fallback.

### Service Examples

| Service         | Type    | Typical Provider |
| --------------- | ------- | ---------------- |
| audit-questions | llm     | powerful model   |
| transcription   | llm     | Whisper          |
| expression-eval | llm     | powerful model   |
| email-sending   | email   | SES / SendGrid   |
| file-storage    | storage | S3 / GCS         |

### ServiceBinding (per team, cascades with delegation)

| Field        | Description                        |
| ------------ | ---------------------------------- |
| teamId       | which team                         |
| service      | named app function                 |
| providers[]  | ordered ProviderConfig IDs --      |
|              | 0 = default, rest = fallback       |
| delegateTo[] | child team IDs allowed to override |

### Cascading Resolution

Same pattern as ProviderConfig. Walk up the tree, find
the binding, use index 0. If it fails, try index 1,
etc.

### Fallback & Health

- Fallback is automatic on error, but must verify the
  error is real (not a false positive from a bad
  request). Network errors and 5xx = fallback. 4xx =
  don't fallback, it's a caller problem.
- Health checks / circuit breakers: if a provider fails
  N times in a window, mark it degraded and skip to the
  next in the chain without waiting for a timeout.
  Reset after a cooldown.
- Services are discovered from a registry, not
  hardcoded.

### Marketplace Services

All marketplace functions share the existing
"expression-eval" service binding. One binding, all
plugins use it. If granularity becomes a real need once
the marketplace has real plugins, per-plugin service
declarations can be added later.

### Cross-Level Provider References

A ServiceBinding's providers[] can reference
ProviderConfigs from its own team or any ancestor team.
This allows natural fallback chains like: "use our
team's provider, fall back to the org's, fall back to
the platform's."

### Dead References

When a parent removes a ProviderConfig, it is set to
isActive=false (existing field on all stored entities).
Child bindings skip inactive refs at resolution time
and fall through to the next provider in the chain.

### Orphaned Reference Event

`serviceBindings.warning.referenceOrphaned` -- a new
value in the existing EventTrigger enum (no new event
system). Fires at deletion time: when a ProviderConfig
is set to inactive, scan child ServiceBindings for
references and emit the event for each affected
binding. Payload: orphaned ProviderConfig ID, affected
ServiceBinding ID, affected team ID, remaining
providers count in the chain.

### Frontend Indicator

ServiceBinding entries referencing an inactive
ProviderConfig render with a visual indicator (red +
icon). The check is simply isActive on the referenced
config. No new fields needed.

### Notification Packs (Marketplace)

A notification pack is a bundle of pre-built
EventConfig templates sold or shared through the
marketplace. Installing a pack creates EventConfigs in
the org with sensible defaults (e.g. email admin on
referenceOrphaned, Slack alert on breakingChange).
Admin customizes conditions, URL, and body template
from there. The platform ships zero notification
logic -- it all lives in EventConfig, the same system
that handles audit-completed and record-modified
today. Packs are config bundles, not code.
