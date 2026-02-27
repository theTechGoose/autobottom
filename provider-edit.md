# Providers & Connectors -- Revised Architecture

Two systems for two problems. Stateless operations
(LLM, email, transcription) use the Provider system
with fallback chains. Stateful infrastructure (database,
file storage, auth, queue) uses the Connector system
with no fallback.

Unified marketplace for both. Developers publish
either. Admins install either through the same UI.

---

## The Dividing Line

**"Can I delete this provider and lose nothing the
app needs later?"**

- Yes -> Provider (stateless). Payload in, result out.
  Fallback is safe because each call is independent.
- No -> Connector (stateful). Data lives inside the
  provider. Fallback is impossible because the next
  provider doesn't have your data.

Stateless: LLM inference, email sending, transcription,
TTS, notifications, webhook delivery, recordings
retrieval.

Stateful: database, file storage, auth, queue.

---

## Provider System (Stateless)

### Provider

Dumb executor. One function. No idempotency, no state
machine, no reliability logic. Call it twice with the
same payload, it runs twice.

**Stored entity (marketplace listing):**

| Field | Description |
| ----- | ----------- |
| `category` | free-form string, UI grouping only |
| `displayName` | "OpenAI GPT-4", "SendGrid", etc. |
| `displayImageUrl` | logo/icon for marketplace UI |
| `exposedMethodName` | what it does: "transcribe", "complete", "deliver" |
| `exposedMethodDescription` | human-readable description of the method |
| `configSchema` | JSON Schema -- fields admin fills in (API keys, endpoints, etc.) |

**Runtime class:**

```ts
class Provider {
  constructor(code: string) {}
  execute(payload: unknown): Promise<CodeReturn>;
}
```

One method per provider. Need upload AND download?
Two providers. `execute` is the only method. The
`exposedMethodName` is metadata for humans and for
ProviderChain composition -- the runtime always
calls `execute`.

### ProviderChain

Groups providers with identical `exposedMethodName`
into an ordered fallback array. Owns the Idempoter
for dedup across fallback hops. Per team.

**Stored entity:**

| Field | Description |
| ----- | ----------- |
| `teamId` | which team |
| `exposedMethodName` | what operation this chain serves |
| `providers[]` | ordered ProviderConfig IDs (0 = primary) |
| `reconcileTimeout` | ms, for guaranteeSend reconciliation window |
| `delegateTo[]` | child team IDs allowed to override |

**Runtime class:**

```ts
class ProviderChain {
  constructor(
    providers: Provider[],
    reconcile: Reconciler,
  ) {}
  // owns Idempoter internally
  send(payload): Promise<CodeReturn>;
  guaranteeSend(payload):
    Promise<{ receipt: Receipt; result: CodeReturn }>;
}
```

**Fallback rules:**

- `send` (optimistic): fall back immediately on
  error. No receipt check. If the first provider
  actually succeeded in the background, the
  Idempoter deduplicates on the next call.
- `guaranteeSend` (pessimistic): wait for
  reconciliation window before falling back.
  Correctness over speed.
- 5xx / timeout: try next provider in chain.
- 4xx: fail immediately. Bad request, not a
  provider problem. No fallback.
- Error classification drives fallback, not a
  return-value field.

**Constraint:** all providers in a chain MUST have
identical `exposedMethodName`. Enforced at write
time.

### ProviderConfig

Admin-configured credentials per team. Points at a
Provider definition. Same Provider can have different
configs per team.

| Field | Description |
| ----- | ----------- |
| `teamId` | which team |
| `providerId` | which Provider definition |
| `config` | filled-in values matching configSchema |

No `type` field -- derive from Provider. No
`delegateTo[]` -- delegation lives on ProviderChain
only. ProviderConfig is just credentials.

**Resolution cascade:** child team -> parent team ->
org root -> platform.

---

## Connector System (Stateful)

Three-tier inheritance: base contract, category
contract, implementation.

### Connector (base abstract class)

The contract ALL connectors share. Platform-level
concerns: lifecycle, health, marketplace metadata,
idempotency.

```ts
abstract class Connector {
  // marketplace metadata
  abstract configSchema: JSONSchema;
  abstract displayName: string;
  abstract displayImageUrl: string;

  // lifecycle
  abstract connect(config: unknown): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract healthCheck(): Promise<boolean>;

  // owns Idempoter -- every method call on any
  // subclass is auto-wrapped with idempotency
  protected idempoter: Idempoter;
}
```

The Idempoter in the base class means every
connector method (read, write, upload, whatever)
gets effectively-once semantics without the
implementation author thinking about it.

### Category Connectors (platform-defined)

Each category defines the methods the platform
calls. The platform ships these. Developers can
define NEW categories via the provider system.

```ts
abstract class DatabaseConnector extends Connector {
  abstract read(key: string): Promise<unknown>;
  abstract write(key: string, val: unknown):
    Promise<void>;
  abstract query(q: Query): Promise<unknown[]>;
  abstract delete(key: string): Promise<void>;
}

abstract class StorageConnector extends Connector {
  abstract upload(key: string, data: Blob):
    Promise<string>; // returns URL
  abstract download(key: string): Promise<Blob>;
  abstract delete(key: string): Promise<void>;
}

abstract class AuthConnector extends Connector {
  abstract authenticate(creds: unknown):
    Promise<Session>;
  abstract verify(token: string):
    Promise<boolean>;
  abstract refresh(token: string):
    Promise<Session>;
}

abstract class QueueConnector extends Connector {
  abstract enqueue(msg: unknown): Promise<string>;
  abstract dequeue(): Promise<unknown>;
  abstract ack(id: string): Promise<void>;
}
```

### Implementations (developer-built)

The thing developers write and publish to the
marketplace. Extends a category, implements the
methods against a specific service.

```ts
class FirebaseConnector extends DatabaseConnector {
  configSchema = { /* projectId, serviceAccountKey */ };
  displayName = "Firebase Realtime DB";
  displayImageUrl = "https://...";

  async connect(config) { /* init firebase */ }
  async read(key) { /* firebase get */ }
  async write(key, val) { /* firebase set */ }
  // ...
}
```

Admin installs, fills in configSchema, done.

### Connector Rules

- **One per category per team.** You cannot have
  Firebase AND Supabase as database connectors on
  the same team. Platform enforces this.
- **No fallback.** If it's down, it's down. Monitor
  and alert, don't swap.
- **Changing shows a warning.** "Your existing data
  will not migrate. Records written to Firebase will
  not be readable from Supabase."
- **New categories via providers.** Developers define
  new category abstract classes through the provider
  system. This means the provider system bootstraps
  the connector system.

---

## Idempotency

Same Idempoter class, two different owners, two
different jobs.

| Owner | Scope | Purpose |
| ----- | ----- | ------- |
| ProviderChain | exposedMethodName + payload | Dedup across fallback hops. Provider A enters `unknown`, chain falls back to B -- Idempoter prevents double execution. |
| Connector (base class) | category.method + payload | Dedup individual method calls. Pipeline retries a step -- connector doesn't double-write. |

Provider itself has NO Idempoter. It's a dumb
executor. Runs every time you call it.

Idempoter is unchanged from the current spec. No
modifications needed. The existing states cover
both use cases:

- `succeeded` -> return stored receipt, skip exec
- `failed` -> confirmed nothing happened, safe to
  retry or fall back
- `unknown` -> ambiguous, reconcile before deciding

---

## What's Gone

| Old concept | Replacement |
| ----------- | ----------- |
| ServiceBinding | ProviderChain (stateless), ConnectorBinding (stateful) |
| ProviderConfig `type` field | Derive from Provider |
| CommunicationProvider | Regular Providers with category = "communication" |
| SSE as a provider | Platform transport, not a provider |
| Database as a provider | Connector system |
| `delegateTo[]` on ProviderConfig | Delegation only on ProviderChain |
| notification-delivery service | EventConfig resolves directly to communication chain |
| Provider owns Idempoter | Chain owns it (stateless), Connector base owns it (stateful) |

---

## Open Questions

1. How does "define new connector category via
   provider system" actually work? What does the
   provider expose -- a schema of required methods?
   A code template? This needs its own spec.
2. ProviderChain delegation: keep `delegateTo[]` on
   the chain, or move delegation to the Team entity?
3. Credentials encryption: per-developer or per-org?
   Matters for key rotation.
4. Should CommunicationProviders (webhook, email,
   chat) live in the provider system or become a
   connector category? They're stateless but
   tightly coupled to EventConfig.
