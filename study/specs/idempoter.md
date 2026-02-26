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
>
>>kai
>>Discriminated union on state. Split the record
>>into two shapes:
>>
>>```ts
>>type IdempotencyRecord =
>>| {
>>key: string;
>>state: "locked" | "unknown";
>>lockedUntil: number;
>>attempts: number;
>>updatedAt: number;
>>}
>>| {
>>key: string;
>>state: "succeeded";
>>receipt: unknown;
>>attempts: number;
>>updatedAt: number;
>>};
>>```
>>
>>`receipt` only exists when `state === "succeeded"`
>>so there's no nullable field and the narrowing
>>is enforced by the compiler. You could also drop
>>`lockedUntil` from the succeeded variant since
>>the lease is irrelevant once it's done.
>>
>>rafa
>>
>>>this is just a nullable key in a different shape
>>>
>>>>kai
>>>>You're right, it's structural nullability with
>>>>extra syntax. But here's the thing: does it
>>>>matter? The only public API is `execute()`
>>>>which returns `Promise<T>`. The caller never
>>>>sees the record. If the nullable receipt
>>>>bothers you at the storage level, store
>>>>receipts in a separate `Map<string, unknown>`
>>>>keyed by idempotency key. Then the record has
>>>>no receipt field at all -- it's just state +
>>>>lease metadata. Receipt lives next door.
>>>>
>>>>rafa
>>>>this is the right call. collapse this one
>>>>
>>>>>kai
>>>>>Noted -- will collapse. Decision: receipts
>>>>>in a separate map, record is just state +
>>>>>lease metadata.

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
>
>>kai
>>You can't fully enforce normalization at the
>>type level. But you can make it hard to skip:
>>require the constructor to take a
>>`normalize: (obj: T) => T` function. The
>>key-builder calls it before hashing. Callers
>>who pass `identity` are opting out explicitly.
>>Alternatively, accept only `string` keys and
>>push normalization entirely to the caller --
>>simpler kernel, but less safety. Given your
>>`(obj, ...keys)` idea below, I'd lean toward
>>the normalize callback since the kernel is
>>already touching the object.
>>
>>>rafa
>>>i dont understand
>>>
>>>>kai
>>>>Simpler: before the kernel hashes an object
>>>>to make a key, it runs a cleanup function on
>>>>it first. You give that function to the
>>>>constructor. Example:
>>>>
>>>>```ts
>>>>const idem = new Idempoter({
>>>>normalize: (obj) => sortKeys(stripUndefined(obj)),
>>>>reconcile: myReconciler,
>>>>});
>>>>```
>>>>
>>>>Now every call to `execute` automatically
>>>>normalizes before hashing. `{ b: 1, a: 2 }`
>>>>and `{ a: 2, b: 1 }` produce the same key.
>>>>If the caller doesn't care, they pass
>>>>`(x) => x`. The point is the kernel does
>>>>the normalizing, not the caller at each
>>>>call site.
>>>>
>>>>rafa
>>>>what about if we did something like
>>>>
>>>>```typescript
>>>>Idempoter.fromxyz(schema, obj).defineScope(...)
>>>>```
>>>>
>>>>>kai
>>>>>This is sharp. The schema IS the normalizer
>>>>>-- a zod/valibot schema validates and
>>>>>canonicalizes in one pass. No separate
>>>>>`normalize` callback needed.
>>>>>
>>>>>One detail: passing `obj` here binds the
>>>>>payload at construction, making each chain
>>>>>single-use. Is that intentional? Or should
>>>>>the object go into `execute()`?
>>>>>
>>>>>```ts
>>>>>// A: obj bound at construction (single-use)
>>>>>Idempoter.from(schema, obj)
>>>>>.defineScope("send-email", "to", "body")
>>>>>.execute(fn);
>>>>>
>>>>>// B: obj at execute-time (reusable)
>>>>>const send = Idempoter.from(schema).defineScope(
>>>>>"send-email",
>>>>>"to",
>>>>>"body",
>>>>>);
>>>>>await send.execute(obj, fn);
>>>>>```
>>>>>
>>>>>B lets you define the pipeline once and
>>>>>reuse across requests. A is more
>>>>>declarative but new chain per call.
>>>>>
>>>>>rafa
>>>>>essentially what we are doing by building a class is scoping state
>>>>>if we want to run the function again we build another throwaway scope
>>>>>this prevents reusing the same state accedentally. this has nothing to do
>>>>>with archetecture and more to do with my preferences as a programmer
>>>>>early on in my career i got bit by modifying global state
>>>>>because its not thread safe, so i figure that from now on im going
>>>>>to encapsulate my code in a function that always returns an object
>>>>>well what is that? a class, boom everything is a class was born.
>>>>>
>>>>>>kai
>>>>>>I get the philosophy and it's
>>>>>>battle-tested. But there's a tension:
>>>>>>the Idempoter NEEDS persistent state to
>>>>>>work. The idempotency records and receipts
>>>>>>must survive across calls -- that's the
>>>>>>whole point. If the instance is throwaway,
>>>>>>where do the records live?
>>>>>>
>>>>>>Answer: the store is external. The
>>>>>>throwaway instance is a transaction scope
>>>>>>-- it holds the config and key identity
>>>>>>for one execution, but delegates
>>>>>>persistence to the injected store. The
>>>>>>instance is disposable, the data isn't.
>>>>>>
>>>>>>So the class is a closure with a name.
>>>>>>Which is exactly what you said: a function
>>>>>>that returns an object. That tracks. The
>>>>>>store is the only thing that persists
>>>>>>across throwaway instances.
>>>>>>
>>>>>>>rafa
>>>>>>>what if we assume we always have access to all of the deno
>>>>>>>deploy primitives? This would make it so we dont have to pass
>>>>>>>the store on construct

>>>>>>>> kai
>>>>>>>> This kills a whole category of API
>>>>>>>> complexity. If the kernel owns the store
>>>>>>>> internally via `Deno.openKv()`, the
>>>>>>>> caller never thinks about persistence.
>>>>>>>> One less arg, one less thing to wrong.
>>>>>>>>
>>>>>>>> Trade-off: the kernel is now coupled to
>>>>>>>> Deno runtime. Not portable to Node/Bun.
>>>>>>>> Tests need `--unstable-kv` locally. But
>>>>>>>> if this is a Deno Deploy framework and
>>>>>>>> you're not pretending otherwise, that's
>>>>>>>> fine. Portability is YAGNI until it isn't.
>>>>>>>>
>>>>>>>> Real upside: Deno KV gives you atomic
>>>>>>>> ops (`kv.atomic().check().set().commit()`)
>>>>>>>> That's the CAS primitive you need for
>>>>>>>> lease safety. The kernel can guarantee
>>>>>>>> lease atomicity internally without
>>>>>>>> exposing it to callers. That was an open
>>>>>>>> question -- now answered by the runtime.

- Scope must include:

  - tenant/user
  - operation/endpoint
  - destination (if applicable)
  - version prefix

    > rafa
    > hate all this shit, can it not just be (obj, ...keys)

>>kai
>>Yeah, `(obj, ...keys)` is cleaner. The kernel
>>picks the listed keys from the object, sorts
>>them deterministically, hashes. Tenant and
>>version become instance-level config baked
>>into the Idempoter at construction -- not
>>per-call noise.
>>
>>One pushback: you lose the forced
>>`destination` scope. If someone forgets to
>>include the target endpoint in their keys,
>>two different API calls with the same payload
>>body collide. Maybe the static factory could
>>require a `scope: string` alongside the
>>object keys? Something like:
>>
>>```ts
>>Idempoter.from(scope, obj, ...keys);
>>```
>>
>>That way scope is always explicit and the
>>key extraction stays flexible.
>>
>>>rafa
>>>what about this? i like this api better
>>>
>>>```ts
>>>Idempoter.from(xyz).defineScope(scope, ...keys);
>>>```

>>>>kai
>>>>I like the separation but I'd flip the
>>>>mental model. `from(xyz)` creates a reusable
>>>>instance (bound to a store + reconciler).
>>>>`defineScope` generates the key for one call.
>>>>So the usage would be:
>>>>
>>>>```ts
>>>>const idem = Idempoter.from({
>>>>store,
>>>>reconcile,
>>>>});
>>>>
>>>>// per-call:
>>>>const key = idem.key("send-email", obj, "to", "subject", "body");
>>>>await idem.execute(key, () => sendEmail(obj));
>>>>```
>>>>
>>>>But `defineScope` as a chainable that returns
>>>>a scoped executor could be cleaner:
>>>>
>>>>```ts
>>>>const sendScope = idem.scope("send-email");
>>>>await sendScope.execute(obj, ["to", "subject"], () => sendEmail(obj));
>>>>```
>>>>
>>>>The scope is bound once, keys are extracted
>>>>per call. Keeps `execute` as the single verb.
>>>>What's `xyz` in your version -- the store
>>>>config? The reconciler? Both?
>>>>
>>>>rafa
>>>>i hate your version tell me why we would not just chain it?
>>>>do you want to reuse the idempoter? im just trying to follow the rxjs
>>>>pattern that nothing happens until you subscribe. here nothing
>>>>happens until you define a scope.

>>>>>kai
>>>>>You're right, I was wrong to push back.
>>>>>The cold-until-scope pattern is clean and
>>>>>it actually gives you reuse too:
>>>>>
>>>>>```ts
>>>>>// define once (cold -- just config)
>>>>>const sendEmail = Idempoter.from(
>>>>>schema,
>>>>>store,
>>>>>reconcile,
>>>>>).defineScope("send-email", "to", "body");
>>>>>
>>>>>// execute many times (hot)
>>>>>await sendEmail.execute(obj1, fn1);
>>>>>await sendEmail.execute(obj2, fn2);
>>>>>```
>>>>>
>>>>>`defineScope` returns a reusable scoped
>>>>>executor. Construction describes, execute
>>>>>subscribes. You get both the rxjs semantics
>>>>>and reuse without my two-step split.
>>>>>
>>>>>Only thing: does `execute` here take the
>>>>>obj + fn, or just fn? If the scope already
>>>>>knows which keys to extract, it needs the
>>>>>obj at execute-time to hash them. So it's
>>>>>`execute(obj, fn)` not `execute(fn)`.
>>>>>
>>>>>rafa
>>>>>we made a change above that would make this viable
>>>>>
>>>>>```ts
>>>>>// define once (cold -- just config)
>>>>>const scope = ["send-email", "to", "body"];
>>>>>const idm = Idempoter.from(schema, reconcile).defineScope(scope);
>>>>>
>>>>>// execute many times (hot)
>>>>>await idm.execute(obj1, fn1);
>>>>>await idm.execute(obj2, fn2);
>>>>>```

>>>>>> kai
>>>>>> This is clean. Store is gone (Deno KV
>>>>>> internal), two args to `from`, one to
>>>>>> `defineScope`. The chain reads well.
>>>>>>
>>>>>> Clarifying `scope` -- you have
>>>>>> `["send-email", "to", "body"]` as one
>>>>>> array. Is the first element the scope
>>>>>> name and the rest are object keys to
>>>>>> extract? If so, I'd separate them:
>>>>>>
>>>>>> ```ts
>>>>>> .defineScope("send-email", ["to", "body"])
>>>>>> ```
>>>>>>
>>>>>> Mixing the scope name with the key list
>>>>>> in one flat array is ambiguous. The first
>>>>>> element has different semantics from the
>>>>>> rest -- it's a namespace, not a field to
>>>>>> hash. Separating them makes the contract
>>>>>> explicit.
>>>>>>
>>>>>> Also: `schema` is back. This means the
>>>>>> kernel validates + canonicalizes via
>>>>>> `schema.parse()` before key extraction.
>>>>>> That's the normalize callback from earlier
>>>>>> but formalized. Good -- it means the
>>>>>> caller can't accidentally hash a
>>>>>> non-canonical object. The schema enforces
>>>>>> it.

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

>>kai
>>Agreed. The provider abstraction is a separate
>>concern. Get the kernel right first -- the
>>provider layer is just a consumer of `execute`.
>>Parking sections 3, 4, and the dump/ingest
>>stuff until the kernel is solid.
>>
>>>rafa
>>>collapse this section(remove)

>>>>kai
>>>>Noted -- will remove section 2 on collapse.
>>>>Reconcile discussion below migrates to
>>>>section 1 since it's kernel config.

### Rules

- `reconcile` is mandatory.

  > rafa
  > callback function given to idempoter on newing up
  > this way the caller does not leak implementation
  > details to idempoter

>>kai
>>This is the right call. Reconcile as a
>>constructor-injected callback keeps the kernel
>>ignorant of vendor specifics. The signature
>>would be something like:
>>
>>```ts
>>type Reconciler = (key: string) => Promise<unknown | null>;
>>```
>>
>>Returns the receipt if the effect happened,
>>null if it didn't. This matches your earlier
>>note about `receipt(truthy)` vs `null`.
>>
>>One thing to nail down: what happens when
>>reconcile itself throws? That's different from
>>returning null (confirmed no-op). A throw
>>means "I don't know" -- the record should stay
>>`unknown` and the caller gets the error. Don't
>>conflate "confirmed didn't happen" with "can't
>>reach the vendor to check."
>>
>>>rafa
>>>hmm i dont know i also dont want to explode this constuctor signature
>>>what would the api look like?

>>>>kai
>>>>The constructor doesn't change at all. The
>>>>three outcomes are already in the reconciler's
>>>>natural behavior:
>>>>
>>>>```ts
>>>>reconcile: (key) => Promise<unknown | null>;
>>>>```
>>>>
>>>>- Returns receipt -> succeeded
>>>>- Returns null -> confirmed didn't happen
>>>>- Throws -> vendor unreachable, stay unknown
>>>>
>>>>The Idempoter just wraps the call in
>>>>try/catch internally. If reconcile throws,
>>>>the record stays `unknown` and the error
>>>>propagates to the caller. Zero API surface
>>>>added. The contract is: "return a value or
>>>>null if you know, throw if you don't."
>>>>
>>>>That said -- if you genuinely don't want to
>>>>distinguish "didn't happen" from "can't check,"
>>>>you can collapse both into null and accept that
>>>>unknown records might get marked failed when
>>>>the vendor was just temporarily down. That's a
>>>>real trade-off though, not just an API choice.
>>>>
>>>>>rafa
>>>>>okay, look at this entire document, what does the final signature look like?
>>>>>
>>>>>>kai
>>>>>>Synthesizing everything agreed so far:
>>>>>>
>>>>>>```ts
>>>>>>type Schema<T> = { parse: (raw: unknown) => T };
>>>>>>type Reconciler = (key: string) => Promise<unknown | null>;
>>>>>>
>>>>>>// construction (cold -- just config)
>>>>>>const idem = Idempoter.from(
>>>>>>schema, // validates + canonicalizes
>>>>>>store, // KV backend (Deno KV, etc.)
>>>>>>reconcile, // (key) => receipt | null | throw
>>>>>>);
>>>>>>
>>>>>>// scope definition (still cold)
>>>>>>const sendEmail = idem.defineScope(
>>>>>>"send-email", // scope name
>>>>>>"to",
>>>>>>"body", // ...keys to extract
>>>>>>);
>>>>>>
>>>>>>// execution (hot)
>>>>>>const receipt = await sendEmail.execute(
>>>>>>obj, // payload
>>>>>>() => emailApi.send(obj), // side effect
>>>>>>);
>>>>>>```
>>>>>>
>>>>>>Internal state:
>>>>>>
>>>>>>- Record: `{ key, state, lockedUntil,
attempts, updatedAt }`
>>>>>>- Receipts: separate `Map<string, unknown>`
>>>>>>
>>>>>>State transitions:
>>>>>>
>>>>>>- `locked -> succeeded` (fn returns)
>>>>>>- `locked -> unknown` (fn throws)
>>>>>>- `unknown -> succeeded` (reconcile returns
>>>>>>receipt)
>>>>>>- `unknown -> failed` (reconcile returns null)
>>>>>>- `unknown -> unknown` (reconcile throws)
>>>>>>
>>>>>>Open questions for you:
>>>>>>
>>>>>>1.  What is `store`? Just a KV interface
>>>>>>like `{ get, set, delete }`? Or does it
>>>>>>need atomic CAS for lease safety?
>>>>>>2.  Does `defineScope` take the schema or
>>>>>>does `from`? If `from`, all scopes on
>>>>>>that instance share one schema.
>>>>>>3.  `execute` returns the receipt -- is that
>>>>>>the raw return of `fn()`, or wrapped?
>>>>>>
>>>>>>rafa
>>>>>>this api is trash. can we think through this step by step and
>>>>>>come up with something better? its just too hard to use, too many
>>>>>>things to remember.

>>>>>>>kai
>>>>>>>Fair. The three-step chain was
>>>>>>>over-engineered. Let me start from what
>>>>>>>the caller actually needs to provide:
>>>>>>>
>>>>>>>**Per app (once):** store
>>>>>>>**Per operation (once):** scope, keys,
>>>>>>>reconcile
>>>>>>>**Per call:** payload, side-effect fn
>>>>>>>
>>>>>>>So there are really two setup moments,
>>>>>>>not three. Collapse it:
>>>>>>>
>>>>>>>```ts
>>>>>>>// setup (once per operation type)
>>>>>>>const sendEmail = Idempoter.for({
>>>>>>>store,
>>>>>>>scope: "send-email",
>>>>>>>keys: ["to", "body"],
>>>>>>>reconcile: (key) => checkEmail(key),
>>>>>>>});
>>>>>>>
>>>>>>>// use (per call -- this is the hot path)
>>>>>>>await sendEmail.run(obj, () => send(obj));
>>>>>>>```
>>>>>>>
>>>>>>>One static factory, one options bag, one
>>>>>>>execution method. Two things to remember:
>>>>>>>`Idempoter.for(config)` and `.run(obj, fn)`.
>>>>>>>
>>>>>>>Schema is gone. If you need normalization,
>>>>>>>sort your own keys before calling. The
>>>>>>>kernel just picks the keys you listed
>>>>>>>and hashes them deterministically. Less
>>>>>>>magic, less to remember.
>>>>>>>
>>>>>>>If you want the throwaway pattern, that
>>>>>>>works too:
>>>>>>>
>>>>>>>```ts
>>>>>>>await Idempoter.for({
>>>>>>>store,
>>>>>>>scope: "send-email",
>>>>>>>keys: ["to", "body"],
>>>>>>>reconcile: checkEmail,
>>>>>>>}).run(obj, () => send(obj));
>>>>>>>```
>>>>>>>
>>>>>>>One expression. Build and execute inline.
>>>>>>>Instance is garbage collected immediately.
>>>>>>>
>>>>>>>Does this feel closer? Or still too much
>>>>>>>ceremony?
>>>>>>>
>>>>>>>rafa
>>>>>>>above we made some changes which affects this

>>>>>>>> kai
>>>>>>>> Right. With the Deno KV decision and the
>>>>>>>> updated chain, `Idempoter.for` with the
>>>>>>>> options bag is dead. The current API is:
>>>>>>>>
>>>>>>>> ```ts
>>>>>>>> // cold
>>>>>>>> const idm = Idempoter
>>>>>>>>   .from(schema, reconcile)
>>>>>>>>   .defineScope("send-email", ["to", "body"]);
>>>>>>>>
>>>>>>>> // hot
>>>>>>>> await idm.execute(obj, fn);
>>>>>>>> ```
>>>>>>>>
>>>>>>>> Store is internal (Deno KV). Schema
>>>>>>>> validates + canonicalizes. Reconcile is
>>>>>>>> the only callback. Two things to
>>>>>>>> remember: `from(schema, reconcile)` and
>>>>>>>> `execute(obj, fn)`. `defineScope` is the
>>>>>>>> bridge between config and execution.
>>>>>>>>
>>>>>>>> This supersedes the `Idempoter.for`
>>>>>>>> proposal. That thread can collapse.

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
