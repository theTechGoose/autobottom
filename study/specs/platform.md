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

## 2. Logging [ ]

Developer-level observability across the entire app.
Full text search, log levels, structured data -- but
cost effective.

### Backend

Grafana Cloud (managed Loki + Grafana). One
platform-level logging backend configured by the
developer. Logging is NOT a per-org provider -- all
orgs write to the same backend. Single pane of glass
for debugging across orgs.

- Loki = log storage and query engine (S3-backed,
  label-indexed, full-text search on demand).
- Grafana = UI (dashboards, log search, filters).
- Pricing: per GB ingested, free up to 50 GB/month.
- If Grafana Cloud becomes a problem (cost,
  compliance), migrate to self-hosted Loki later --
  same API, same query language (LogQL).

### Log Shape

```
{
  timestamp, level (debug/info/warn/error),
  service, teamId, orgId, userId,
  message, data (Record<string, unknown>)
}
```

### Visibility Scoping

Label filtering on the existing team tree. No new
capability needed.

- Developer: sees all labels (all orgs).
- Admin: filters to their org's teamIds.
- User: filters to their team.

### Ingestion on Deno Deploy

App writes structured JSON to stdout via a thin
`log()` wrapper. Logs are shipped to Grafana Cloud's
Loki push API using `waitUntil()`:

1. Buffer structured log lines during the request.
2. After the response is sent, call
   `waitUntil(fetch(...))` to push the batch to
   Loki's HTTP push endpoint. Non-blocking -- the
   user's response is already sent.
3. ~20 lines of code. No SDK, no external forwarder.

Deno Deploy has a "custom OTel endpoint" setting on
Pro/Enterprise plans (coming soon). When it ships,
swap the `waitUntil` flush for the built-in OTel
pipe -- set the endpoint in the Deploy console and
`console.log` flows to Grafana Cloud automatically.
The log shape stays the same either way.

### Hot/Cold Storage

Loki handles this internally. No custom hot/cold
split to build.

- Ingesters hold recent data in memory (hot).
- Loki flushes to S3 as compressed chunks based on
  chunk age and size (not wall clock time).
- Queries that span hot + cold merge both sources
  transparently. Result caching is built in.

Configure `retention_period`,
`ingester.chunk_idle_period`, and query cache TTL.
No custom code.

## ~~3. Providers [ ]~~

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

Multiple ProviderConfigs of the same type are allowed
per team. Uniqueness is on the ProviderConfig ID, not
on (teamId, type). This enables quality tiers and
fallback chains -- e.g. a cheap LLM config and a
premium LLM config on the same team, referenced by
ID from ServiceBindings.

### Cascading Resolution

Walk up the team tree until you find a ProviderConfig
for the requested type. A child team can only override
if the parent's `delegateTo[]` includes their teamId.

### Credentials

Stored encrypted at rest. Encryption key scoped at the
developer level.

### Simplicity Rules

1. ProviderConfig is a flat bag of values. No logic,
   no hooks. Filled-in fields matching configSchema.
   Validation is FieldDef's job.
2. Resolution is one function. Given teamId + type,
   walk up the tree, return first match. No caching,
   no inheritance merging, no overrides beyond
   delegateTo[].

Subsystem boundary: providers own configs and
resolution. ServiceBindings own wiring and fallback.
They communicate through ProviderConfig IDs only.
Each subsystem fits in one file.

### Schema Changes

When a developer updates configSchema, existing
ProviderConfigs are validated against the new schema
using FieldDef rules. New fields with defaults work
transparently. If a developer adds a required field
without a default, the UI warns them with the count
of affected configs before saving.

No schema versioning system. FieldDef defaults are
the migration mechanism.

### Breaking Change Event

A breaking change is: required field added without
default, field removed, or field type changed. On
breaking change, fire `breakingChange` event (unscoped
-- not tied to a specific domain prefix).

Event payload: provider ID, before/after schema diff,
count of affected configs, list of affected team IDs.

This reuses the existing EventConfig infrastructure
(triggers, conditions, HTTP dispatch). No new event
system needed -- just a new event catalog entry.

## ~~4. Services & Service Bindings [ ]~~

A service is a named app function that needs a
provider. ServiceBindings wire services to providers
with ordered fallback.

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

Same pattern as ProviderConfig. Walk up the tree,
find the binding, use index 0. If it fails, try
index 1, etc.

### Fallback & Health

- Fallback is automatic on error. Network errors and
  5xx trigger fallback. 4xx does not -- it is a
  caller problem.
- Circuit breakers: if a provider fails N times in a
  window, mark it degraded and skip to the next in
  the chain without waiting for a timeout. Reset
  after a cooldown.
- Services are discovered from a registry, not
  hardcoded.

### Marketplace Services

All marketplace functions share the existing
"expression-eval" service binding. One binding, all
plugins use it. Per-plugin service declarations can
be added later if granularity becomes a real need.

### Cross-Level Provider References

A ServiceBinding's providers[] can reference
ProviderConfigs from its own team or any ancestor
team. This allows fallback chains like: "use our
team's provider, fall back to the org's, fall back
to the platform's."

### Dead Reference Handling

When a parent removes a ProviderConfig, it is set to
isActive=false (not deleted). Child bindings that
reference it skip the inactive ref at resolution
time and fall through to the next provider in the
chain.

On deactivation, the system scans child
ServiceBindings for references to the config and
fires `serviceBinding.referenceOrphaned`
for each affected binding. This is a standard event
in the existing EventConfig system -- no new
infrastructure.

Event payload: orphaned ProviderConfig ID, affected
ServiceBinding ID, affected team ID, remaining
providers count in the chain.

Frontend renders inactive ProviderConfig references
with a visual indicator (red + icon) by checking
isActive on the referenced config. No new fields
needed.

### Notification Packs

Notification packs are marketplace items -- bundles
of pre-built EventConfig templates. Installing a
pack creates EventConfigs in the org with sensible
defaults (e.g. email admin on referenceOrphaned,
Slack alert on breakingChange). Admins customize
conditions, URL, and body template from there.

The platform ships zero notification logic. All
notification behavior lives in EventConfig, the same
system that handles audit-completed and
record-modified today. Marketplace packs are config
bundles, not code.
