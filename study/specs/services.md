# Platform Providers & Service Bindings Spec

Infrastructure integrations defined by developers,
configured by admins. Services bind named app
functions to specific providers.

Note: Provider is a single concept that combines
infrastructure config (type, name, configSchema)
with an execution kernel (code sandbox + idempoter).
See provider.md for the execution methods and
idempoter.md for the reliability kernel.

---

## 1. Provider (defined by developer)

- type (db | llm | storage | email | auth | ...)
- name ("OpenAI", "Anthropic", "S3", "Postgres")
- configSchema (FieldDef[] -- what the admin needs
  to fill in: endpoint, apiKey, region, etc.)

---

## 2. ProviderConfig (configured by admin, per team)

- teamId
- type
- providerId (which Provider definition)
- config (filled-in credentials/settings)
- delegateTo[] (child team IDs allowed to override)

Cascading resolution: walk up the team tree until
you find a ProviderConfig. Override only allowed if
parent's delegateTo[] includes your team.

---

## 3. Services

Services are named app functions that need a
provider. Different services can use different
providers -- no hunting rabbits with cannons.

Examples:

- audit-questions (bulk yes/no) -> cheap fast LLM
- transcription -> Whisper / AssemblyAI
- expression-eval / llm() -> powerful LLM
- email-sending -> SES / SendGrid / Postmark
- file-storage -> S3 / GCS
- recordings -> Genie / direct upload / any
  recording provider
- queue -> QStash / SQS / any async queue
  provider for pipeline step orchestration
- messaging -> in-app message delivery,
  resolves to a messaging provider (Slack,
  Teams, in-app chat, etc.)
- notification-delivery -> outbound delivery
  for EventConfig actions. Receives rendered
  payloads from the event system and dispatches
  via the bound provider (webhook, email,
  chat). This is the execution layer for
  EventConfig -- events fire, conditions are
  checked, payloads are rendered, then
  notification-delivery sends them out.

---

## 4. ServiceBinding (per team, cascades)

- teamId
- service (named app function)
- providers[] (ordered fallback chain: index 0 =
  default, higher = fallback)
- delegateTo[] (child teams allowed to override)

Failover is automatic -- primary fails, try the
next in the array.
