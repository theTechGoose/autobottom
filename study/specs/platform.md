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
>>>>>  data in memory, queryable instantly.
>>>>>- **Flush** = your midnight cutoff. Loki
>>>>>  flushes ingester data to S3 as compressed
>>>>>  chunks on a configurable interval -- not
>>>>>  tied to wall clock time.
>>>>>- **Querier** = your tmp:hotlog. Queries
>>>>>  that span hot + cold data pull S3 chunks,
>>>>>  merge with ingester data, and cache
>>>>>  results locally.
>>>>>
>>>>>**What you'd configure (not build):**
>>>>>
>>>>>- `retention_period` -- how long S3 chunks
>>>>>  live before deletion.
>>>>>- `ingester.chunk_idle_period` -- flush
>>>>>  cadence for inactive streams.
>>>>>- Query result caching -- maps directly to
>>>>>  your 30-day tmp:hotlog TTL.
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

## 3. Providers [ ]

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

> Kai
>
> **Pros of multiple ProviderConfigs per type:** An org
> might want both OpenAI AND Anthropic configured as
> LLM providers. The ServiceBinding providers[] array
> references specific ProviderConfig IDs -- so the
> fallback chain `[OpenAI-cheap, Anthropic-fallback]`
> needs both to exist at the same team level.
> One-per-type would force fallbacks to only reference
> configs from different tree levels, which is too
> limiting.
>
> **Cons:** More configs to manage. Admin has to name
> them clearly to tell them apart.
>
> **Suggestion:** Allow multiple ProviderConfigs per
> type per team. The uniqueness is on the
> ProviderConfig ID, not on (teamId, type).
> ServiceBindings reference specific IDs.
>
>>Rafa
>>
>>im dumb you need to explain this at a 12th grade
>>level
>>
>>>Kai
>>>
>>>**Simpler explanation:**
>>>
>>>Think of provider configs like phone plans. Your
>>>team might want two LLM "plans" -- a cheap one
>>>(GPT-4o-mini, $5/mo) for everyday tasks, and an
>>>expensive one (Claude Opus, $50/mo) for hard
>>>problems.
>>>
>>>If we only allowed **one LLM config per team**,
>>>you'd have to pick one. Every service that needs
>>>an LLM gets the same one.
>>>
>>>With **multiple configs per type**, your team can
>>>have both:
>>>
>>>- Config #101: "OpenAI-Cheap" (type: llm)
>>>- Config #102: "Anthropic-Premium" (type: llm)
>>>
>>>Then when you set up a service binding, you say:
>>>"For audit-questions, use #102 (the premium one).
>>>For transcription, use #101 (the cheap one)." And
>>>you can even set up a fallback: "Try #102 first,
>>>if it's down, fall back to #101."
>>>
>>>The rule is: each config gets its own unique ID
>>>(like a phone number). The system doesn't care
>>>that two configs on the same team are both type
>>>"llm" -- it tells them apart by ID, not by type.
>>>
>>>**Pros:** This is just how it needs to work.
>>>Without it, you can't have different quality tiers
>>>or meaningful fallback chains.
>>>
>>>**Cons:** An admin managing 5+ configs of the
>>>same type needs clear naming. The UI should group
>>>by type and show which services reference each
>>>config.
>>>
>>>**Suggestion:** Same as before -- allow multiple
>>>per type, unique by ID. The UI should make it
>>>obvious which configs are in use and which are
>>>orphaned.
>>>
>>>>rafa
>>>>okay, if you do this we need to make sure that the engineering is simple
>>>>this app is getting complex af, we can manage it as long as we keep the
>>>>sub systems separate and each subsystem simple.
>>>>
>>>>>Kai
>>>>>
>>>>>Agreed. Two rules keep the provider
>>>>>subsystem simple:
>>>>>
>>>>>1. **ProviderConfig is a flat bag of
>>>>>   values.** No logic, no hooks. Filled-in
>>>>>   fields matching configSchema. Validation
>>>>>   is FieldDef's job.
>>>>>
>>>>>2. **Resolution is one function.** Given
>>>>>   teamId + type, walk up the tree, return
>>>>>   first match. No caching, no inheritance
>>>>>   merging, no overrides beyond
>>>>>   delegateTo[].
>>>>>
>>>>>Subsystem boundary: providers own configs
>>>>>and resolution. ServiceBindings own wiring
>>>>>and fallback. They communicate through
>>>>>ProviderConfig IDs only. Each subsystem
>>>>>fits in one file.

> Kai
>
> **Schema changes (developer updates configSchema):**
>
> The scenario: developer defined "OpenAI" with
> configSchema [apiKey, model]. 50 orgs filled it in.
> Now developer adds a "organization" field.
>
> **Pros of keeping it simple:** FieldDef already has
> `default?` and `required`. If the developer adds a
> new field with a default, existing configs keep
> working. If they add a required field with no
> default, existing configs show a warning in the admin
> UI until updated. No migration system, no versioning,
> just the FieldDef contract.
>
> **Cons:** A developer could break 50 orgs by adding a
> required field with no default. No rollback path.
>
> **Suggestion:** Keep it simple -- lean on FieldDef
> defaults. Add a validation check: if a developer adds
> a required field without a default, warn them "this
> will invalidate X existing configs" before saving.
> That's enough guardrail without building a schema
> versioning system.
>
>>Rafa
>>
>>would adding a configSchema.error.breakingChange
>>event help?
>>
>>>Kai
>>>
>>>**Pros:** It makes breaking changes programmable.
>>>Instead of just a UI warning, any system can
>>>subscribe -- notify affected admins, pause
>>>deploys, trigger a migration script, send a Slack
>>>alert. The UI warning becomes just one consumer of
>>>this event rather than a one-off feature. It's the
>>>right primitive.
>>>
>>>**Cons:** Need to define "breaking" precisely. And
>>>this is the second event you've proposed (alongside
>>>the dead-reference one in section 4). Both are
>>>good, but they imply we need a lightweight
>>>event/notification system -- a place for these
>>>events to live and be consumed.
>>>
>>>**Suggestion:** Yes, add it. Define breaking as:
>>>required field added without default, field
>>>removed, or field type changed. Event payload:
>>>provider ID, before/after schema diff, count of
>>>affected configs, list of affected team IDs. Name:
>>>`configSchema.error.breakingChange`.
>>>
>>>Worth flagging: between this event and the
>>>`serviceBindings.warning.referenceOrphaned` event
>>>below, we're building toward a platform event
>>>system. Doesn't need to be complex -- even a
>>>simple internal pub/sub or webhook dispatch -- but
>>>it should be a conscious design decision rather
>>>than ad-hoc per feature. Maybe worth its own
>>>section once we settle on both events.
>>>we've already built events into this system,
>>>please see /Users/raphaelcastro/Documents/programming/autobottom/study/data-model-overview.html
>>>this conversation is just an extension of that eventually we will integrate it into that document
>>>
>>>>Kai
>>>>
>>>>Looked at the data model. EventConfig
>>>>already has triggers (EventTrigger enum),
>>>>conditions (FilterGroup), and HTTP dispatch
>>>>(url, method, headers, bodyTemplate). The
>>>>two events we're proposing are just new
>>>>EventTrigger values:
>>>>
>>>>- `configSchema.error.breakingChange`
>>>>- `serviceBindings.warning`
>>>>  `.referenceOrphaned`
>>>>
>>>>No new event system needed. An admin who
>>>>wants "email me when a provider link
>>>>breaks" creates an EventConfig with the new
>>>>trigger type and their endpoint. Same
>>>>system, new trigger values.
>>>>
>>>>Only change: add the two trigger names to
>>>>EventTrigger. No structural additions.

## 4. Services & Service Bindings [ ]

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

Dead references (where a parent removed a ProviderConfig
that a child binding still points to) are skipped at
runtime -- the binding falls through to the next
provider in the chain.

> Rafa
>
> can we also add an event
> providerConfigs.error.deadReferenceCreated
>
>>Kai
>>
>>**Pros:** Without this event, dead references are
>>silent. A binding quietly skips the dead ref and
>>falls through -- which is correct runtime behavior,
>>but means nobody knows the fallback chain just lost
>>a link. The event makes it observable so
>>admins/developers can fix broken chains proactively
>>instead of discovering them when the remaining
>>providers also fail.
>>
>>**Cons:** Naming -- "deadReferenceCreated" implies
>>someone created it on purpose. It's actually a side
>>effect of a parent deleting their ProviderConfig.
>>Also need to decide when it fires: at deletion time
>>(scan child bindings for references) or at
>>resolution time (when a binding tries to use a dead
>>ref). Deletion time is better -- you catch it
>>immediately, not when traffic hits.
>>
>>**Suggestion:** Yes, add it. Fire at deletion time
>>-- when a ProviderConfig is set to inactive, scan child
>>ServiceBindings for references to it and emit the
>>event for each affected binding. Rename to
>>`serviceBindings.warning.referenceOrphaned` -- it's
>>a warning on the binding (its chain is degraded),
>>not an error on the provider config (which no longer
>>exists). Payload: orphaned ProviderConfig ID,
>>affected ServiceBinding ID, affected team ID,
>>remaining providers count in the chain.
>>
>>This is now two platform events
>>(`configSchema.error.breakingChange` and
>>`serviceBindings.warning.referenceOrphaned`). Both
>>are config-integrity warnings. Suggest we add a
>>"Platform Events" section to this spec once both
>>are settled -- even a simple internal event bus with
>>webhook dispatch would cover both cases.
>>
>>>rafa
>>>we could also add in the ui a way to see that a link is broken color + icon
>>>but that has nothing to do with the backend which is what we are designing
>>>right now. we just need to show providerConfig as inactive, when rendered
>>>in the app it will be red with an icon so the admin knows to remove it
>>>the even is for notifications. this way admins can send. we can ship optional
>>>notification packs that admins can install
>>>in the marketplace
>>>
>>>>Kai
>>>>
>>>>Clean separation. To confirm alignment:
>>>>
>>>>**Backend:** ProviderConfig already has
>>>>isActive (all stored entities do per the
>>>>data model). Parent removes config = set
>>>>isActive=false. Fire the event. Child
>>>>bindings skip inactive refs at resolution
>>>>time. Existing behavior, no new code.
>>>>
>>>>**Frontend:** ServiceBinding entries that
>>>>reference an inactive ProviderConfig render
>>>>red + icon. Just check isActive on the
>>>>referenced config. No new fields needed.
>>>>
>>>>**Notification packs in marketplace:** A
>>>>pack is a bundle of pre-built EventConfig
>>>>templates. "Install" = create EventConfigs
>>>>in the org with sensible defaults (email
>>>>admin on referenceOrphaned, Slack alert on
>>>>breakingChange). Admin customizes
>>>>conditions, URL, body template from there.
>>>>
>>>>Platform ships zero notification logic.
>>>>It all lives in EventConfig -- same system
>>>>that handles audit-completed and
>>>>record-modified today. Marketplace packs
>>>>are config bundles, not code.
