# Provider Spec

Providers are adapters. They turn a code string
into execution inside a sandbox, reconcile the
result, and expose two methods: `send` (optimistic)
and `guaranteeSend` (pessimistic).

The provider owns an internal Idempoter instance.
The caller never touches the Idempoter directly.

---

## 1. Interface

```ts
class Provider {
  constructor(
    code: string,
    reconcile: Reconciler,
  ) {}

  send(payload: unknown): Promise<void>;
  guaranteeSend(payload: unknown): Promise<Receipt>;
}
```

- `code` -- the implementation as a string.
  Gets executed in a sandbox/worker.
- `reconcile` -- passed to the internal Idempoter
  on construction.

---

## 2. send(payload)

Fire-and-forget. Executes the code in a sandbox
with the payload. Returns immediately after the
worker completes. Does not reconcile.

Internally, the Idempoter wraps the sandbox call
via `execute`. If the worker succeeds, Idempoter
marks the key as succeeded with the receipt. If
it throws, Idempoter marks as unknown.

The caller gets a resolved promise (success) or
a rejected promise (worker error). No receipt
returned -- this is fire-and-forget.

---

## 3. guaranteeSend(payload)

Pessimistic send. Calls `send` under the hood,
then calls the reconciler to confirm the side
effect actually happened.

- If reconciler returns a receipt -- confirmed.
  Return the receipt.
- If reconciler returns null/undefined -- did not
  happen. Throw.
- If reconciler throws -- unknown. Throw.

This is the "I need proof" path. Use it when the
caller must know the side effect landed.

---

## 4. Idempoter Integration

The provider creates an internal Idempoter at
construction, passing in the reconciler. The
Idempoter handles idempotency keys, leases, and
state tracking.

### 4.1 mark(key, receipt?)

The Idempoter needs a `mark` method to update
state after reconciliation:

```ts
idm.mark(key, receipt);  // receipt exists -> succeeded
idm.mark(key);           // no receipt -> retryable
```

This may require updating the Idempoter spec.
Currently `execute` handles state transitions
internally. `mark` is an external mutation --
the provider telling the kernel "here's what
actually happened."

### 4.2 Flow

```
send(payload):
  1. sandbox executes code with payload
  2. worker returns -> idempoter marks succeeded
  3. worker throws  -> idempoter marks unknown
  4. return void

guaranteeSend(payload):
  1. send(payload)
  2. reconcile(key)
  3. receipt exists  -> idempoter.mark(key, receipt)
                        return receipt
  4. no receipt      -> idempoter.mark(key)
                        throw "not delivered"
```

---

## 5. Sandbox

The code string is executed in a worker/sandbox.
The provider turns `code => sandbox`, grabs the
return value and error from the worker, and lets
the Idempoter handle state from there.

Details of the sandbox (Deno workers, permissions,
resource limits) are out of scope for this spec.

---

## 6. Open Questions

- Does `mark` belong on the Idempoter public API
  or is it internal to the provider?
- Should `guaranteeSend` retry if reconcile says
  "not delivered", or just throw immediately?
- How does the provider generate the idempotency
  key? Does it use `defineScope` internally or
  build keys differently?
