# Idempoter Spec

Reliability kernel for deterministic execution of
side-effecting functions. Guarantees effectively-once
semantics via idempotency keys, lease-based locking,
memoized receipts, and mandatory reconciliation.

Runs on Deno Deploy. Uses Deno KV internally.

---

## 1. Public API

### Construction (cold -- just config)

```ts
type Schema<T> = (raw: unknown) => T;
type Reconciler = (key: string) =>
  Promise<unknown | null>;

const idm = Idempoter
  .from(schema, reconcile)
  .defineScope("send-email", ["to", "body"]);
```

- `from(schema, reconcile)` -- binds a type
  stripper and a reconciliation callback.
  Constructor is private; `from` is the only
  entry point.
- `defineScope(scope, keys)` -- binds a scope
  name and the object keys used for hashing.
  Returns a scoped executor. Nothing executes
  until this is called (cold-until-scope).

### Execution (hot)

```ts
const receipt = await idm.execute(obj, fn);
```

- `execute(obj, fn)` -- the single public verb.
  Strips the object via schema, extracts keys,
  hashes deterministically, then runs the state
  machine.

### Throwaway usage

```ts
await Idempoter
  .from(schema, reconcile)
  .defineScope("send-email", ["to", "body"])
  .execute(obj, () => emailApi.send(obj));
```

Instance is garbage collected immediately.

---

## 2. Schema

The schema is a plain function: `(raw: unknown) => T`.
No validation library. It picks the keys you expect
and strips everything else. The kernel calls it before
key extraction to guarantee canonical input.

```ts
const emailSchema = (raw: unknown) => {
  const obj = raw as Record<string, unknown>;
  return { to: String(obj.to), body: String(obj.body) };
};
```

---

## 3. Key Generation

Keys are deterministic. The kernel:

1. Runs the schema stripper on the object.
2. Picks the fields listed in `defineScope`.
3. Sorts them deterministically.
4. Hashes: `sha256(scope + sorted key-value pairs)`.

The scope name is mandatory and prevents collisions
between operations that share payload shapes.

---

## 4. Internal State

### Record (stored in Deno KV)

```ts
interface IdempotencyRecord {
  key: string;
  state: "locked" | "succeeded" | "unknown"
    | "failed";
  lockedUntil: number;
  attempts: number;
  updatedAt: number;
}
```

No receipt field on the record. Receipts are stored
separately, keyed by idempotency key.

### State transitions

```
locked    -> succeeded  (fn returns)
locked    -> unknown    (fn throws)
unknown   -> succeeded  (reconcile returns receipt)
unknown   -> failed     (reconcile returns null)
unknown   -> unknown    (reconcile throws)
```

---

## 5. Reconciliation

Reconcile is a callback injected at construction.
The kernel is ignorant of vendor specifics.

```ts
type Reconciler = (key: string) =>
  Promise<unknown | null>;
```

Three outcomes:

- **Returns receipt** -- side effect happened.
  Record moves to `succeeded`, receipt is stored.
- **Returns null** -- side effect did not happen.
  Record moves to `failed`.
- **Throws** -- vendor unreachable, can't confirm.
  Record stays `unknown`, error propagates to
  caller.

Reconcile is triggered when `execute` is called
again with a key that is in `unknown` state.

---

## 6. Execution Flow

`execute(obj, fn)` must:

1. Build key from schema + scope + extracted fields.
2. Atomically claim the key with a lease
   (Deno KV `atomic().check().set().commit()`).
3. If `state === succeeded` -- return stored receipt.
4. If `state === unknown` -- trigger reconcile:
   - Receipt returned: mark succeeded, store receipt.
   - Null returned: mark failed, throw.
   - Reconcile throws: stay unknown, propagate error.
5. If claimable:
   - Run `fn()`.
   - On success: persist receipt, mark succeeded,
     return receipt.
   - On throw: mark unknown, propagate error.

Lease atomicity is guaranteed by Deno KV's CAS
primitives. No external store configuration needed.

---

## 7. Runtime

- **Store:** Deno KV (internal, via `Deno.openKv()`).
- **Atomicity:** Deno KV atomic operations for
  lease safety.
- **Portability:** Coupled to Deno runtime.
  Not portable to Node/Bun. Tests require
  `--unstable-kv` locally.

---

## 8. Design Constraints

- Idempoter < ~300 LOC
- Single public verb: `execute`
- Constructor is private; `from` static factory only
- State machine fully encapsulated
- No DSL, no decorators, no magic
- No external dependencies for schema validation
