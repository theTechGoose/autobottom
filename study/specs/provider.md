# Provider Spec

Providers are dumb adapters. They perform side
effects and expose state. They do not manage
reliability -- the Idempoter kernel owns that.

Providers must be hot-swappable: swap the adapter,
keep the data.

---

## 1. Stateless Provider

Used for fire-and-forget side effects (send email,
call API, post webhook). No durable state to manage.

### 1.1 Interface

```ts
interface StatelessProvider<TPayload, TReceipt> {
  send: (payload: TPayload) => Promise<TReceipt>;
}
```

`send` is the only method. It performs the side
effect and returns a receipt.

### 1.2 Relationship to Idempoter

The provider's `send` is what gets wrapped by
`execute`:

```ts
const idm = Idempoter
  .from(schema, reconcile)
  .defineScope("send-email", ["to", "body"]);

await idm.execute(obj, () => emailProvider.send(obj));
```

The provider does not know it's being wrapped.
It has no concept of idempotency, leases, or
retries. That's the kernel's job.

### 1.3 Reconcile

Reconcile is NOT on the provider. It was pulled
into the Idempoter kernel as a constructor-injected
callback. The provider just sends.

However, the reconcile callback will often need to
query the provider's vendor API to confirm whether
a side effect happened. The caller wires this up
at Idempoter construction:

```ts
const reconcile = async (key: string) => {
  const result = await emailApi.checkStatus(key);
  if (result.delivered) return result;
  if (result.notFound) return null;
  throw new Error("vendor unreachable");
};
```

---

## 2. Stateful Provider

Used when the provider houses durable data that
must survive a provider swap (Firebase, S3,
Postgres, etc.).

### 2.1 Interface

```ts
interface StatefulProvider<TPayload, TReceipt>
  extends StatelessProvider<TPayload, TReceipt> {
  dump: (target: DumpTarget) => Promise<DumpReceipt>;
  ingest: (source: IngestSource) => Promise<void>;
}
```

Adds `dump` and `ingest` to the stateless interface.

### 2.2 dump(target)

Exports canonical domain state from the provider.

Requirements:

- Must stream or chunk. Must not buffer the entire
  dataset in memory.
- Must be resumable via cursor. If interrupted,
  restart from the last persisted cursor.
- Must be idempotent per chunk. Re-uploading the
  same chunk is a no-op.
- Must export canonical DTO format, not the
  vendor-specific shape. Firebase nested docs,
  S3 flat keys, and Postgres rows must all produce
  the same canonical output.

```ts
interface DumpTarget {
  write: (chunk: CanonicalChunk) => Promise<void>;
  cursor?: string;
}

interface DumpReceipt {
  chunks: number;
  cursor: string;
  complete: boolean;
}
```

### 2.3 ingest(source)

Imports canonical data into the provider.

Requirements:

- Must be resumable. Tracks its own cursor.
- Must support chunk-based ingestion.
- Must tolerate retries. Re-ingesting the same
  chunk must be safe (upsert semantics).

```ts
interface IngestSource {
  read: () => AsyncIterable<CanonicalChunk>;
  cursor?: string;
}
```

---

## 3. Canonical DTO

The canonical format is the contract between
providers. When swapping from Provider A to
Provider B, the data passes through this format.

### 3.1 Requirements

- Must be JSON-serializable.
- Must be provider-agnostic. No Firebase refs,
  no S3 ETags, no Postgres OIDs.
- Must be versioned. Schema changes require a
  migration path.
- Must be domain-shaped, not storage-shaped.
  The DTO reflects the application's data model,
  not the vendor's storage model.

### 3.2 Definition

The canonical DTO is defined per domain entity
by the application, not by the framework. The
framework provides the transport (dump/ingest).
The application provides the shape.

```ts
interface CanonicalChunk {
  version: string;
  entity: string;
  items: Record<string, unknown>[];
  cursor: string;
}
```

---

## 4. Serverless-Safe Dump

Long-running exports must work within serverless
execution limits.

### 4.1 Pattern

Each step must complete within a single serverless
invocation:

1. `startDump()` -- initialize, persist job state.
2. `dumpStep(cursor)` -- fetch one chunk from
   source provider.
3. Upload chunk to target.
4. Persist cursor.
5. Repeat steps 2-4 until done.
6. Write manifest.

### 4.2 Requirements

- Each step is independently idempotent.
- Progress is persisted between steps (Deno KV).
- Steps are orchestrated by Deno Queues or an
  external scheduler.
- Total job state: `{ jobId, cursor, status,
  chunksCompleted, startedAt, updatedAt }`.

---

## 5. Hot Swap

Swapping providers means:

1. `sourceProvider.dump(target)` -- export
   canonical state.
2. `targetProvider.ingest(source)` -- import
   canonical state.
3. Redirect traffic to new provider.
4. Decommission old provider.

### 5.1 Consistency

Dump reads from a live system. Data can change
mid-dump. Options:

- **Point-in-time snapshot** -- if the vendor
  supports it (Postgres snapshots, Firestore
  export). Preferred.
- **Cursor-based with change tracking** -- dump
  from a cursor, then replay changes that happened
  after the dump started.
- **Downtime window** -- stop writes, dump, ingest,
  resume. Simplest but requires coordination.

### 5.2 Verification

After ingest, verify:

- Record counts match.
- Spot-check sample records.
- Run reconciliation against both providers.

---

## 6. Open Questions

- What orchestrates the serverless dump steps?
  Deno Queues? Cron? Manual trigger?
- How is the canonical DTO versioned across
  schema migrations?
- Should dump/ingest be provider methods or
  standalone functions that take a provider?
- Is there a rollback strategy if ingest fails
  midway?
