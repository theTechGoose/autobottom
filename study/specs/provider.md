# Provider Spec

Providers are adapters. They turn a code string
into execution inside a sandbox and expose two
methods: `send` (optimistic) and `guaranteeSend`
(pessimistic).

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

  send(payload: unknown): Promise<CodeReturn>;
  guaranteeSend(
    payload: unknown,
  ): Promise<{ receipt: Receipt; result: CodeReturn }>;
}
```

- `code` -- the implementation as a string.
  Gets executed in a sandbox/worker.
- `reconcile` -- passed to the internal Idempoter
  on construction.

---

## 2. send(payload)

Fire-and-forget. Executes the code in a sandbox
with the payload. Returns the worker's return
value. Does not reconcile.

Internally, the Idempoter wraps the sandbox call
via `execute`. If the worker succeeds, Idempoter
marks the key as unknown (not yet reconciled).
If it throws, Idempoter marks as unknown.

The caller gets a resolved promise with the code
return value, or a rejected promise on worker
error. No receipt -- this is fire-and-forget.

---

## 3. guaranteeSend(payload)

Pessimistic send. Calls `send` under the hood,
then calls the reconciler to confirm the side
effect actually happened.

- Reconciler returns receipt -- confirmed.
  Calls `idempoter.mark(key, receipt)`.
  Returns `{ receipt, result }`.
- Reconciler returns null/undefined -- did not
  happen. Calls `idempoter.mark(key)` (retryable).
  Throws.
- Reconciler throws -- unknown. Throws.

Does not retry. Retry logic is the caller's
responsibility.

---

## 4. Idempoter Integration

The provider creates an internal Idempoter at
construction, passing in the reconciler.

### Key generation

The idempotency key is derived from the code
string and the payload:

```
sha256(code + canonicalize(payload))
```

The code string IS the scope -- it uniquely
identifies the operation. The provider builds
raw keys and calls `idempoter.execute(key, fn)`
directly, bypassing `defineScope`.

### Flow

```
send(payload):
  1. key = hash(code + payload)
  2. idempoter.execute(key, () => sandbox(code, payload))
  3. worker returns -> idempoter marks unknown
  4. return worker result

guaranteeSend(payload):
  1. result = send(payload)
  2. receipt = reconcile(key)
  3. receipt exists -> idempoter.mark(key, receipt)
                       return { receipt, result }
  4. no receipt    -> idempoter.mark(key)
                       throw
```

---

## 5. Sandbox

The code string is executed in a worker/sandbox.
The provider turns `code => sandbox`, grabs the
return value and error from the worker, and lets
the Idempoter handle state from there.

Details of the sandbox (Deno workers, permissions,
resource limits) are out of scope for this spec.
