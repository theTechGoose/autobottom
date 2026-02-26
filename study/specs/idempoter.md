# Deterministic Provider & Idempotency Framework Spec

## 0. Core Goal

Build a small reliability kernel that guarantees:

- Exactly-once execution per key
- Memoized receipts
- Lease-based concurrency control
- Backoff support
- Mandatory reconciliation

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
  execute<T>(key: string, fn: () => Promise<T>): Promise<T>;
}
```

### Behavior

`execute(key, fn)` must:

1. Atomically claim the key (with lease).
1. If state === succeeded -> return stored receipt.
1. If executable:
   - run `fn()`
   - persist receipt
   - return receipt
1. If `fn()` throws:
   - mark unknown
1. if called again with the same idempotency key and unknown trigger reconcile
   - reconcile returns either a reciept or null
   - if reconcile result === null mark as failed
   - if reconcile result is truthy mark as succeeded

No state inspection required at call sites.

### 1.2 Internal State Model

Minimal internal states:

```ts
type State = "locked" | "succeeded" | "unknown" | "retryable";
```

Stored record:

```ts
interface IdempotencyRecord {
  key: string;
  state: State;
  lockedUntil: number;
  attempts: number;
  updatedAt: number;
  receipt: unknown;
}
```

> rafa
> i dont like the nullable reciept field is thre anything we can do here?

>> kai
>> Discriminated union on state. Split the record
>> into two shapes:
>>
>> ```ts
>> type IdempotencyRecord =
>>   | { key: string; state: "locked" | "unknown"
>>       lockedUntil: number; attempts: number;
>>       updatedAt: number }
>>   | { key: string; state: "succeeded";
>>       receipt: unknown; attempts: number;
>>       updatedAt: number };
>> ```
>>
>> `receipt` only exists when `state === "succeeded"`
>> so there's no nullable field and the narrowing
>> is enforced by the compiler. You could also drop
>> `lockedUntil` from the succeeded variant since
>> the lease is irrelevant once it's done.

### 1.3 Key Design

Keys must be deterministic:

```
v1:tenant:endpoint:destination:sha256(canonical)
```

Requirements:

- Payload must be validated and normalized before if caller does not control
  the object.
  > rafa
  > how can we enfore this?

  >> kai
  >> You can't fully enforce normalization at the
  >> type level. But you can make it hard to skip:
  >> require the constructor to take a
  >> `normalize: (obj: T) => T` function. The
  >> key-builder calls it before hashing. Callers
  >> who pass `identity` are opting out explicitly.
  >> Alternatively, accept only `string` keys and
  >> push normalization entirely to the caller --
  >> simpler kernel, but less safety. Given your
  >> `(obj, ...keys)` idea below, I'd lean toward
  >> the normalize callback since the kernel is
  >> already touching the object.
- Scope must include:
  - tenant/user
  - operation/endpoint
  - destination (if applicable)
  - version prefix
    > rafa
    > hate all this shit, can it not just be (obj, ...keys)

    >> kai
    >> Yeah, `(obj, ...keys)` is cleaner. The kernel
    >> picks the listed keys from the object, sorts
    >> them deterministically, hashes. Tenant and
    >> version become instance-level config baked
    >> into the Idempoter at construction -- not
    >> per-call noise.
    >>
    >> One pushback: you lose the forced
    >> `destination` scope. If someone forgets to
    >> include the target endpoint in their keys,
    >> two different API calls with the same payload
    >> body collide. Maybe the static factory could
    >> require a `scope: string` alongside the
    >> object keys? Something like:
    >>
    >> ```ts
    >> Idempoter.from(scope, obj, ...keys)
    >> ```
    >>
    >> That way scope is always explicit and the
    >> key extraction stays flexible.

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

> rafa
> providers are out of scope here lets talk about idempoency then we can
> deal with providers

>> kai
>> Agreed. The provider abstraction is a separate
>> concern. Get the kernel right first -- the
>> provider layer is just a consumer of `execute`.
>> Parking sections 3, 4, and the dump/ingest
>> stuff until the kernel is solid.

### Rules

- `reconcile` is mandatory.
  > rafa
  > callback function given to idempoter on newing up
  > this way the caller does not leak implementation
  > details to idempoter

  >> kai
  >> This is the right call. Reconcile as a
  >> constructor-injected callback keeps the kernel
  >> ignorant of vendor specifics. The signature
  >> would be something like:
  >>
  >> ```ts
  >> type Reconciler = (key: string) =>
  >>   Promise<unknown | null>;
  >> ```
  >>
  >> Returns the receipt if the effect happened,
  >> null if it didn't. This matches your earlier
  >> note about `receipt(truthy)` vs `null`.
  >>
  >> One thing to nail down: what happens when
  >> reconcile itself throws? That's different from
  >> returning null (confirmed no-op). A throw
  >> means "I don't know" -- the record should stay
  >> `unknown` and the caller gets the error. Don't
  >> conflate "confirmed didn't happen" with "can't
  >> reach the vendor to check."
- Must deterministically answer:
  - `reciept(truthy)` -> side effect happened
  - `null` -> did not happen

---

## 6. Execution Flow

```
Idempoter.execute(key, handler)
```

```

---

## 7. Guarantees

This framework guarantees:

* No duplicate side effects
* Safe retries
* Memoized responses
* Canonical portable state
* Serverless-safe operation
* Convergent reconciliation

---

## 8. Design Constraints

* Idempoter < ~300 LOC
* Single public verb: `execute` on instance
* constructor is private, has static methods to make an idempoter from
* different objects. follows constructor(deterministicKeySortedObject, ...scopes)
* State machine fully encapsulated
```
