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

> Kai
>
> **Pros:** GCP-style logging is the gold standard for
> observability. Scoping it to the developer level
> (sees all orgs) and cascading down (admins see their
> org, users see their team) fits the existing
> permission model perfectly.
>
> **Cons:** Cloud logging services charge per ingestion
> volume. Multi-tenant app with many orgs = expensive
> fast. Full text search on every log line is the
> biggest cost driver.
>
> **Suggestion:** Two things to consider:
>
> 1. **Logging could be a provider itself.** The
>    developer configures a "logging" provider
>    (ClickHouse, Loki, CloudWatch, whatever). The app
>    writes logs through it. You'd be dog-fooding the
>    provider system. This means different orgs could
>    even use different logging backends if delegated.
>
> The log scoping follows the same team tree visibility
> -- developer sees all, admin sees their org down,
> users see their team down. No new capability needed,
> just the existing permission model applied to logs.
>
> What's the log shape look like? Something like:
> timestamp, level (debug/info/warn/error), service,
> teamId, userId, message, structured data
> (Record<string, unknown>)?
>
>>Rafa
>>
>>okay how would we then have unified logging for
>>developers? lets say im a user with the developer
>>capability and i am in charge of 3 different admins
>>who have 3 different logging providers. and i need
>>to debug an issue, how? what is dog-fooding? would
>>it be possible for me to use some sort of logger
>>that can shard logs i can pick a date range it
>>pulls the shard and then allows me to do full text
>>search on it? cold storage on s3 is cheap, is
>>there something that could work off that and have
>>a nice ui?
>>
>>>Kai
>>>
>>>First -- **dog-fooding** means using your own
>>>product to do its own job. Here it meant: "the
>>>platform's logging system would itself be wired
>>>through the provider system the platform already
>>>offers." But your question exposes why that's the
>>>wrong move for logging specifically.
>>>
>>>**The problem you're describing:** You're the
>>>developer. Admin A uses CloudWatch, Admin B uses
>>>Loki, Admin C uses ClickHouse. You need to debug
>>>something that crosses all three orgs. Where do
>>>you look? There's no single pane of glass.
>>>
>>>Two ways to solve it:
>>>
>>>1.  **Query federation** -- a thin API fans out
>>>your search to all three backends. Problem:
>>>each has different query languages, different
>>>latency, and you're building a translator.
>>>Fragile and slow.
>>>2.  **One unified backend at the platform level**
>>>-- all logs ship to one place. Orgs don't
>>>choose their own logging backend. The developer
>>>chooses it once for the whole platform.
>>>
>>>**Your S3 instinct is right.** The pattern:
>>>
>>>- All logs ship to S3, partitioned by date:
>>>`s3://logs/2026/02/25/team-abc/*.jsonl.gz`
>>>- For search: pull the date-range shards,
>>>decompress, full-text search
>>>- **Grafana Loki** does exactly this -- S3 as the
>>>storage backend, minimal indexing (just labels
>>>like teamId, level, service), full-text search
>>>on demand, and Grafana as the UI. Storage cost
>>>is basically just S3 pricing.
>>>
>>>**Pros:** One place to look. Cheap (S3 cold
>>>storage). Loki is battle-tested. Grafana UI is
>>>good. Visibility scoping is just label filtering
>>>-- developer sees all labels, admin filters to
>>>their org's teamIds, users filter to their team.
>>>
>>>**Cons:** Logging is no longer delegatable to
>>>orgs. If an admin wants their own separate logging
>>>system, they'd need to set that up outside the
>>>platform. Full-text search on large date ranges
>>>can be slow since Loki only indexes labels, not
>>>log content.
>>>
>>>**Suggestion:** Don't make logging a per-org
>>>provider. The developer configures ONE logging
>>>backend at the platform level (Loki + S3). All
>>>orgs write to it. Visibility scoping is label
>>>filtering on teamId, not separate backends. If an
>>>admin also wants to forward logs to their own
>>>external system, that can be an optional
>>>webhook/export later -- but the platform's source
>>>of truth is unified.
>>>
>>>>rafa
>>>>okay wonderful, so at the end of the day, we have a hot-logs for the day
>>>>at the end of the day 11:59:59 a new hotlog is started, old logs are then
>>>>moved to s3, happens in that order for no interuption, new pointer to todays
>>>>hotlogs, old hotlogs stay exactly the same, a cleanup process then saves them
>>>>to s3, on loading the logs hotlogs are displayed first, if a timeframe outside
>>>>of the hotlogs is chosen, then it will pull cold storage into a tmp hotlog
>>>>and query against the tmp:hotlog:<create-datetime>:<start-datetime>-<end-datetime>, is that how it will work?
>>>>tmp:hotlog is cached for 30 days. before creating a new hotlog when someone requests one
>>>>it checks to see if it already exists. does that work?
>>>>
>>>>>Kai
>>>>>
>>>>>You're describing the exact pattern Loki
>>>>>uses internally -- you don't have to build
>>>>>this.
>>>>>
>>>>>**How Loki already works:**
>>>>>
>>>>>- **Ingesters** = your hot logs. Recent
>>>>>data in memory, queryable instantly.
>>>>>- **Flush** = your midnight cutoff. Loki
>>>>>flushes ingester data to S3 as compressed
>>>>>chunks on a configurable interval -- not
>>>>>tied to wall clock time.
>>>>>- **Querier** = your tmp:hotlog. Queries
>>>>>that span hot + cold data pull S3 chunks,
>>>>>merge with ingester data, and cache
>>>>>results locally.
>>>>>
>>>>>**What you'd configure (not build):**
>>>>>
>>>>>- `retention_period` -- how long S3 chunks
>>>>>live before deletion.
>>>>>- `ingester.chunk_idle_period` -- flush
>>>>>cadence for inactive streams.
>>>>>- Query result caching -- maps directly to
>>>>>your 30-day tmp:hotlog TTL.
>>>>>
>>>>>**One concern:** the midnight cutoff has a
>>>>>timezone problem. Orgs in different zones
>>>>>disagree on when "end of day" is. Loki
>>>>>avoids this by flushing based on chunk age
>>>>>and size, not wall clock. Let Loki handle
>>>>>rotation rather than pinning to 11:59:59.
>>>>>
>>>>>**Suggestion:** Don't build the hot/cold
>>>>>split. Deploy Loki with S3 backend. Your
>>>>>mental model is correct -- the
>>>>>implementation is Loki config, not custom
>>>>>code. The dedup check ("does this
>>>>>tmp:hotlog exist?") is built into Loki's
>>>>>query cache.
>>>>>
>>>>>>rafa
>>>>>>is loki a backend or a ui?
>>>>>>is there a managed service it sucks to have to manage containers and shit
>>>>>>
>>>>>>>Kai
>>>>>>>
>>>>>>>Loki is **backend only** -- it stores and
>>>>>>>queries logs. No UI. Grafana is the
>>>>>>>separate UI that talks to Loki. They're
>>>>>>>from the same company (Grafana Labs) but
>>>>>>>are two different services you deploy.
>>>>>>>
>>>>>>>**Managed options:**
>>>>>>>
>>>>>>>- **Grafana Cloud** -- Grafana Labs hosts
>>>>>>>both Loki and Grafana for you. Free tier
>>>>>>>covers 50GB/month of logs. Pay-as-you-go
>>>>>>>after that. No containers, no S3 config,
>>>>>>>nothing to manage. You just send logs to
>>>>>>>their endpoint. This is the path of least
>>>>>>>resistance.
>>>>>>>- **AWS has no managed Loki.** If you want
>>>>>>>AWS-native, the equivalent is CloudWatch
>>>>>>>Logs, but it's expensive at scale and the
>>>>>>>query language is worse.
>>>>>>>
>>>>>>>**Suggestion:** Start with Grafana Cloud.
>>>>>>>You get Loki + Grafana UI + alerting with
>>>>>>>zero ops burden. The free tier is enough
>>>>>>>for development and early production. If
>>>>>>>costs spike later because ingestion volume
>>>>>>>grows, you can migrate to self-hosted Loki
>>>>>>>on S3 -- the log format is the same, just
>>>>>>>point the config at your own bucket. But
>>>>>>>don't start there. Self-hosting Loki means
>>>>>>>running ingesters, queriers, compactors --
>>>>>>>exactly the container management you want
>>>>>>>to avoid.

## ~~3. Providers

Infrastructure integrations. The developer defines
what a provider looks like (its config schema). Admins
fill in credentials for their org.

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

### Multiple Configs per Type

Multiple ProviderConfigs of the same type are allowed
on the same team. Uniqueness is on the ProviderConfig
ID, not on (teamId, type). This enables quality tiers
and fallback chains -- e.g., a cheap LLM config and a
premium LLM config on the same team, each referenced
by different ServiceBindings.

### Engineering Simplicity

Two rules keep the subsystem simple:

1. ProviderConfig is a flat bag of values. No logic,
   no hooks. Validation is FieldDef's job.
2. Resolution is one function: given teamId + type,
   walk up the tree, return first match. No caching,
   no inheritance merging, no overrides beyond
   delegateTo[].

Subsystem boundary: providers own configs and
resolution. ServiceBindings own wiring and fallback.
They communicate through ProviderConfig IDs only.
Each subsystem fits in one file.

### Schema Evolution

When a developer updates configSchema, existing
ProviderConfigs are validated against the new schema
using FieldDef rules. New fields with defaults work
silently. New required fields without defaults show a
warning in the admin UI until updated.

If a developer adds a breaking change (required field
without default, field removed, or field type changed),
the system warns: "this will invalidate X existing
configs" before saving.

Event trigger: `configSchema.error.breakingChange`.
Payload: provider ID, before/after schema diff, count
of affected configs, list of affected team IDs. This
is a new value in the existing EventTrigger enum --
no new event system needed.

## ~~4. Services & Service Bindings

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
ProviderConfigs from its own team or any ancestor
team. This allows natural fallback chains like: "use
our team's provider, fall back to the org's, fall back
to the platform's."

### Dead References

When a parent removes or deactivates a ProviderConfig,
it is set to isActive=false (existing field from the
data model). Child ServiceBindings that reference an
inactive config skip it at resolution time and fall
through to the next provider in the chain.

At deactivation time, the system scans child
ServiceBindings for references to the affected config
and emits `serviceBindings.warning.referenceOrphaned`
for each affected binding. Payload: orphaned
ProviderConfig ID, affected ServiceBinding ID,
affected team ID, remaining providers count in the
chain. This is a new EventTrigger value in the
existing EventConfig system -- no new infrastructure.

### Frontend Indication

ServiceBinding entries referencing an inactive
ProviderConfig render with a visual indicator (color
and icon). The check is isActive on the referenced
config. No new fields needed.

### Notification Packs (Marketplace)

A notification pack is a bundle of pre-built
EventConfig templates. Installing a pack creates
EventConfigs in the org with sensible defaults (e.g.,
email admin on referenceOrphaned, Slack alert on
breakingChange). Admins customize conditions, URL,
and body template from there.

The platform ships zero notification logic. All
notification behavior lives in EventConfig -- the
same system that handles audit-completed and
record-modified today. Marketplace packs are config
bundles, not code.
