# Combo Packs Spec

Visual and audio feedback during audit queue
processing. Combos escalate as the agent processes
audits in succession, with effects intensifying
at each tier.

---

## 1. ComboPack (stored)

```
ComboPack
  name         display name
  price        XP cost
  icon         store listing icon
  rarity       common | normal | rare | epic |
               legendary | limited | unique
  consumers[]  ComboConsumerDef (embedded)
  isActive     default true
```

A ComboPack bundles one or more consumers that
run simultaneously on floating letter elements
during queue processing. Purchased from the store,
equipped via player.equippedComboPackId.

---

## 2. ComboConsumerDef (embedded)

```
ComboConsumerDef
  onDrop    ComboTier (embedded) - fires when combo ends
  tiers[]   ComboTier (embedded) - per combo level
```

Each consumer is an independent effect pipeline.
Multiple consumers in the same pack run in
parallel on the same element -- one might handle
color, another handles shake, another handles
sound.

### Tier Selection

The current combo count determines which tier is
active. tiers[] is indexed by combo level:

- Combo 1 -> tiers[0]
- Combo 2 -> tiers[1]
- Combo 3 -> tiers[2]
- Combo N (N > tiers.length) -> tiers[last]

When the combo count exceeds the number of defined
tiers, it clamps to the last tier. This means the
final tier represents the "max intensity" state.

### onDrop

When the combo timer expires (no new audit within
comboTimeoutMs), the onDrop tier fires as a
"cooldown" effect before returning to the idle
state. This gives visual closure to the combo
streak.

---

## 3. ComboTier (embedded)

```
ComboTier
  effect     AppliedEffect (embedded)
  soundUrl   audio to play
```

Each tier pairs a visual effect with an optional
sound. The effect is an AppliedEffect (see
store.md section 5) -- an Effect definition with
its knobs filled in.

As tiers escalate, the effects typically increase
in intensity: brighter colors, faster animations,
louder sounds, more particles, etc. This is
entirely determined by the Effect definitions and
their knob values -- the combo system just selects
which tier to activate.

---

## 4. Combo Lifecycle

```
idle
  -> audit resolved within timeout
    -> combo 1 (tiers[0])
      -> another audit within timeout
        -> combo 2 (tiers[1])
          -> another audit within timeout
            -> combo 3 (tiers[2])
              -> ...clamped to last tier
  -> timeout expires
    -> onDrop fires
      -> idle
```

The combo timeout (comboTimeoutMs) is configured
in GamificationSettings. See settings.md.

---

## 5. Floating Letters

Combo effects apply to "floating letter" elements
-- the visual elements that appear during queue
processing. The ComboPack's consumers each receive
the floating letter element and manipulate it
through their AppliedEffect.

Multiple consumers running simultaneously on the
same element is what creates layered visual
effects (e.g. a glow consumer + a shake consumer
+ a particle consumer all affecting the same
letter).

---

## 6. Events

- store.comboPackEquipped
