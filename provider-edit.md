# Providers & Services -- Rethink

Current design: Provider (catalog + execution kernel),
ProviderConfig (admin creds per team), ServiceBinding
(service -> provider chain), IdempotencyRecord, and
CommunicationProvider (runtime interface in events).

---

## Provider is doing too many jobs

Provider is simultaneously a catalog entry (type, name,
configSchema) and an execution kernel (code, send,
guaranteeSend, Idempoter). Catalog is slow-moving
metadata. Execution is runtime behavior that needs
versioning, sandboxing, hot-reload. You can't swap
execution logic without touching the catalog. You can't
run two impls side by side for migration. The `code`
field as a sandboxed string has no versioning, no
rollback, no diff.

> Split into **Provider** and **Adapter**.
>
> **Provider** stays as the catalog: type, name,
> configSchema. Admin-facing, rarely changes. This is
> "OpenAI exists and needs an API key."
>
> **Adapter** is a versioned execution unit owned by
> a Provider. Fields: providerId, version (semver),
> code, status (draft | active | deprecated). Only
> one Adapter per Provider can be `active` at a time.
> ProviderConfig resolves through Provider to the
> active Adapter at call time.
>
> This gives you: side-by-side migration (pin a
> ProviderConfig to a specific Adapter version),
> rollback (reactivate the old Adapter), and diffable
> history (each version is a separate record).
>
> For V1: skip Adapter entirely. Ship with hardcoded
> adapters (one per provider type). Add the Adapter
> entity later when custom code becomes real. The
> Provider entity doesn't change either way.
>
>>rafa
>>im confused about the Providers configSchema in general why is it using fielddef
>>what purpose does this serve? Also having an enum type really limits what
>>developers can do in the future, what do you think about changing type property to
>>a string called 'category' instead?
>>provider really what it does is provide an external function, what do you think
>>about being more explicit with what everything brings to the table, change
>>the name property on provider to displayName. add a displayImageUrl as a string
>>and a exposedMethodName: string and an exposedMethodDescription: string.
>>this way these are composable. also i think this might be outdated. please
>>read /Users/raphaelcastro/Documents/programming/autobottom/study/specs/idempoter.md
>>and /Users/raphaelcastro/Documents/programming/autobottom/study/specs/provider.md
>>>
>>>Read both specs. You're right, the data model
>>>entity and the runtime class are out of sync.
>>>provider.md defines a class that takes
>>>`(code, reconcile)` and exposes `send` /
>>>`guaranteeSend`. The data model bolted catalog
>>>fields (type, name, configSchema) on top. Two
>>>different things sharing one name.
>>>
>>>**configSchema / FieldDef:** configSchema exists
>>>so the admin UI can render a dynamic form for
>>>any provider without hardcoding. FieldDef comes
>>>from the audit template system. But Idempoter
>>>already uses JSON Schema for its own schema
>>>validation. I'd drop FieldDef here and use JSON
>>>Schema instead -- it's standard, tooling exists,
>>>and the Idempoter already proves it works on
>>>this platform. configSchema becomes a JSON Schema
>>>object that describes what the admin fills in.
>>>
>>>**category instead of type:** Agree fully. The
>>>runtime doesn't dispatch on category -- it's
>>>pure UI grouping. A free-form string means
>>>developers can create providers for anything
>>>without a platform release. No enum.
>>>
>>>**displayName, displayImageUrl:** Yes. Explicit
>>>UI metadata is better than overloading `name`.
>>>
>>>**exposedMethodName + exposedMethodDescription:**
>>>This is the strongest point. Right now `send`
>>>is meaningless -- send what? to where? Making
>>>the provider self-describing with a named
>>>method turns it from a black box into a
>>>composable unit. "This provider exposes
>>>`transcribe`: converts audio to text." Consumers
>>>discover capabilities without reading code.
>>>
>>>One pushback: is one method per provider enough?
>>>What about S3 needing both upload and download?
>>>I think the answer is yes, one method, because
>>>`send` vs `guaranteeSend` are just reliability
>>>levels of the SAME operation. If you need
>>>upload and download, that's two providers.
>>>Keeps the interface dead simple and composable.
>>>
>>>So the revised Provider stored entity:
>>>
>>>```
>>>Provider (stored, defined by developer)
>>>  category: string       -- UI grouping
>>>  displayName: string    -- "OpenAI GPT-4"
>>>  displayImageUrl: string -- logo/icon
>>>  exposedMethodName: string -- "transcribe"
>>>  exposedMethodDescription: string
>>>  configSchema: JSONSchema -- admin form def
>>>```
>>>
>>>The runtime class (provider.md) stays as-is:
>>>`(code, reconcile) -> send / guaranteeSend`.
>>>The stored entity is the catalog card. The
>>>runtime class is the execution engine. They
>>>link by ID, not by being the same object.

## ProviderConfig type is redundant

ProviderConfig has `type` AND `providerId`. The type
is already on Provider. If they disagree, you have
corrupt data with no winner.

> Drop `type` from ProviderConfig. Derive it from
> Provider at read time. If you need to query
> ProviderConfigs by type without joining, add a
> secondary KV index keyed by
> `[teamId, providerType]` -- that's a read
> optimization, not a field on the entity.
>
> Write-time validation: when creating a
> ProviderConfig, assert
> `provider.type === expectedType` if the caller
> specifies one. But don't store it.
>
>>rafa
>>agreed but this depends on the provider class redesign. lets nail that down
>>first and THEN work on this. you are forced to comment here due to the prompt
>>i think this is an imperfection in the revise command. add this at the bottom
>>of the revise command as a comment with 'ways to improve this prompt section'
>>instruct the prompt specifcally to ignore this section
>>you can find it at ~/.claude/commands as it regards to this can you find a
>>workaround so you will not ruin the flow by collapsing this due to the rules
>>of /revise? fuck everything below this point is moot until you address
>>the provider point i made
>>>
>>>Agreed. This and everything below is blocked on
>>>the Provider redesign. Marking sections 3-6 as
>>>deferred -- won't touch them until Provider
>>>lands.
>>>
>>>Updated the revise command with a deferred
>>>section mechanism. See bottom of the command
>>>file.

## ServiceBinding is underspecified [DEFERRED]

The `service` field is a free-form string. Typo in
"audit-questions" vs "audit_questions" and the binding
silently does nothing. The fallback chain is a flat
array with no weights or canary routing. `delegateTo[]`
appears on both ProviderConfig and ServiceBinding --
two delegation mechanisms for the same hierarchy with
no conflict resolution.

> **Service registry.** Define a `ServiceDef` --
> either a stored entity or a hardcoded enum. Each
> entry declares: name (slug), expected provider
> type, payload contract (TS interface or JSON
> schema), failure policy (failover | circuit-break
> | none). ServiceBinding validates against
> ServiceDef at write time. Unknown service names
> are rejected.
>
> **Delegation.** Kill `delegateTo[]` on
> ProviderConfig. ProviderConfig is just credentials
> -- it has no opinion about who can override it.
> Delegation lives only on ServiceBinding. One
> mechanism, one place, one answer.
>
> **Fallback chain.** Keep it simple for V1 -- the
> ordered array is fine. Weights and canary routing
> are premature. But add a `failurePolicy` field
> on ServiceBinding (from ServiceDef defaults,
> overridable): `failover` (try next on 5xx),
> `circuit-break` (open after N failures, skip
> provider for cooldown period), `none` (fail
> immediately). This covers the real difference
> between queue (must not silently fail) and email
> (retry is fine).

## CommunicationProvider is orphaned [DEFERRED]

Events has its own CommunicationProvider interface
(webhook, email, chat, sse) that "resolves creds via
ServiceBinding." But it's a runtime interface with no
formal link to Provider. Email and Chat duplicate
resolution logic. SSE isn't even an external provider.

> Absorb communication into the Provider system.
>
> - **webhook, email, chat** become Providers with
>   type = `communication`. Their configSchema
>   defines the creds (SMTP host, bot token, etc.).
>   EventConfig's `communicationType` becomes a
>   service name that resolves through
>   ServiceBinding like everything else.
> - **CommunicationProvider** as an interface stays
>   but moves from events.md to providers.md. It's
>   the runtime contract that Adapters for
>   communication-type Providers must implement.
> - **SSE** gets pulled out. It's not a provider,
>   it's a transport baked into the platform. The
>   SSE stream already exists for AppEvent /
>   BroadcastEvent. EventConfig with
>   communicationType = sse just pushes to that
>   stream directly -- no ServiceBinding, no creds,
>   no fallback chain. Model it as a built-in
>   delivery channel, not a provider.
>
> Net effect: EventConfig resolves email/chat/webhook
> through the same ServiceBinding machinery as
> audit-questions or file-storage. One resolution
> path. SSE is a special case handled inline.

## Services list is a grab bag [DEFERRED]

Services span LLM inference (audit-questions,
transcription), infrastructure (file-storage, queue),
and communication (email-sending, messaging,
notification-delivery). They have wildly different
reliability requirements, payload shapes, and failure
modes, but ServiceBinding treats them identically.

> This is solved by the ServiceDef proposal above.
> Each service declares its own failure policy and
> payload contract. ServiceBinding doesn't need to
> "know" about categories -- it just enforces
> whatever the ServiceDef says.
>
> One thing to reconsider: **notification-delivery**
> is not a real service. It's the act of EventConfig
> dispatching through a communication provider. If
> we unify CommunicationProvider into the Provider
> system (previous section), then
> notification-delivery disappears. EventConfig
> resolves to a communication service binding
> directly. The service list shrinks to things that
> are actually distinct: audit-questions,
> transcription, expression-eval, email-sending,
> file-storage, recordings, queue, messaging.
>
> **messaging** vs **email-sending** might also
> collapse. Both are "send a message to a person
> via a provider." The difference is the provider
> type (chat vs email). If ServiceBinding already
> resolves by service name to the right provider
> type, you could have one service called
> `direct-message` that resolves to either. But
> this might be too clever -- keeping them separate
> is clearer for admins configuring bindings.

## IdempotencyRecord is over-coupled [DEFERRED]

Key is `sha256(code + canonicalize(payload))`. Code
changes invalidate all idempotency keys. Can't replay
a failed payload against new code. Idempoter is owned
by Provider but payload comes from ServiceBinding
resolution -- ownership is split.

> Key on `sha256(providerId + canonicalize(payload))`
> instead. The provider identity is stable across
> code changes. A bug fix to the adapter doesn't
> break dedup. A failed payload can be retried
> against new code because the key is the same.
>
> Move Idempoter ownership from Provider to the
> resolution layer -- the thing that calls
> `send()` / `guaranteeSend()`. That's the service
> binding resolver. It creates the idempotency key,
> checks the record, calls the adapter, updates the
> record. Provider/Adapter is just the execution
> target, not the reliability wrapper.
>
> If we go with the Adapter split: the key could be
> `sha256(adapterId + version + payload)` to
> distinguish "same payload sent via v1 vs v2" when
> running side-by-side. But for V1 with hardcoded
> adapters, `providerId + payload` is enough.

---

## Open questions

1. Is the Adapter entity needed for V1, or do
   hardcoded adapters suffice until custom code is
   real?
2. How many providers per org realistically? If <10,
   the cascade/delegation machinery is overkill.
3. Should messaging and email-sending collapse into
   one service, or stay separate for admin clarity?
4. "Encryption key scoped at developer level" -- does
   that mean per-developer or per-org?
