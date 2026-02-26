# Deterministic Provider & Idempotency Framework Spec

## 0. Core Goal

Build a small reliability kernel that guarantees:

* Exactly-once execution per key
* Memoized receipts
* Lease-based concurrency control
* Backoff support
* Mandatory reconciliation
* Hot-swappable providers
* Serverless-safe state export/import

This framework centralizes reliability instead of
scattering it across providers and endpoints.

---

## 1. Idempoter (Reliability Kernel)

### Purpose

Guarantee deterministic execution of a
side-effecting function.

### 1.1 Public API

```ts
interface Idempoter {
  execute<T>(
    key: string,
    fn: () => Promise<T>
  ): Promise<T>;
}
```

### Behavior

`execute(key, fn)` must:

1. Atomically claim the key (with lease).
2. If state === succeeded -> return stored receipt.
3. If executable:
   * run `fn()`
   * persist receipt
   * return receipt
4. If `fn()` throws:
   * mark unknown or retryable
   * trigger reconcile process
5. Ensure eventual convergence via reconcile.

No state inspection required at call sites.

### 1.2 Internal State Model

Minimal internal states:

```ts
type State =
  | "started"
  | "succeeded"
  | "unknown"
  | "retryable";
```

Stored record:

```ts
interface IdempotencyRecord {
  key: string;
  state: State;
  leaseUntil: number;
  nextAttemptAt?: number;
  receipt?: unknown;
  attempts: number;
  updatedAt: number;
}
```

### 1.3 Key Design

Keys must be deterministic:

```
v1:tenant:endpoint:destination:sha256(canonical)
```

Requirements:

* Payload must be validated and normalized before
  hashing.
* Scope must include:
  * tenant/user
  * operation/endpoint
  * destination (if applicable)
  * version prefix
* Optional override key allowed.

---

## 2. Provider Abstraction

Providers are adapters. They do not manage
reliability.

### 2.1 Stateless Provider

```ts
new Provider(
  send: (payload) => Promise<Receipt>,
  reconcile: (key) => Promise<boolean>
)
```

### Rules

* `reconcile` is mandatory.
* Must deterministically answer:
  * `true` -> side effect happened
  * `false` -> did not happen
* If vendor cannot be queried:
  * Reconcile against internal ledger.
  * Embed idempotency key into payload where
    possible.

Provider never handles leases, retries, or
memoization.

---

## 3. Stateful Provider

Used when provider houses durable data (Firebase,
S3, etc.).

```ts
new StatefulProvider(
  send,
  reconcile,
  dump,
  ingest
)
```

### 3.1 dump(destination)

Exports canonical domain state.

Requirements:

* Must stream or chunk.
* Must not buffer entire dataset in memory.
* Must be resumable.
* Must be idempotent per chunk.
* Must export canonical DTO format (not
  vendor-specific shape).

```ts
dump(target: DumpTarget): Promise<DumpReceipt>
```

### 3.2 ingest(source)

Imports canonical data.

Requirements:

* Must be resumable.
* Must support chunk-based ingestion.
* Must tolerate retries safely.

```ts
ingest(source: string): Promise<void>
```

---

## 4. Serverless-Safe Dump Strategy

Long-running exports must be job-based.

Pattern:

1. startDump()
2. dumpStep(cursor)
3. upload chunk
4. persist cursor
5. repeat until done
6. write manifest

Each step must:

* Complete within serverless limits
* Be independently idempotent
* Persist progress

---

## 5. Reconciliation Model

Reconcile is mandatory.

```ts
reconcile(key): Promise<boolean>
```

Rules:

* Must converge unknown -> true or false.
* Must use:
  * Vendor query if available
  * Internal ledger otherwise
* Unknown must never be permanent.

---

## 6. Execution Flow

Inbound:

```
Idempoter.execute(key, handler)
```

Outbound:

```
Idempoter.execute(key, provider.send)
```

Stateful migration:

```
source.dump(target)
target.ingest(source)
```

---

## 7. Guarantees

This framework guarantees:

* No duplicate side effects
* Safe retries
* Memoized responses
* Deterministic provider swapping
* Canonical portable state
* Serverless-safe operation
* Convergent reconciliation

---

## 8. Design Constraints

* Idempoter < ~300 LOC
* Single public verb: `execute`
* No DSL
* No decorators
* No magic
* State machine fully encapsulated

---

## 9. Architectural Principle

Providers are dumb adapters.

Idempoter owns correctness.

State must be canonical and exportable.

Reliability must be centralized.
