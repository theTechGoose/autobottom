# Store Spec

Purchasable cosmetics: avatar items, themes, and
the visual effect system that powers them.

---

## 1. StoreItem (stored)

```
StoreItem
  name        display name
  price       XP cost
  icon        store listing icon
  target      letter | frame | title | email | flair
  color       CSS color or gradient
  weight      light | regular | medium | bold
  rarity      common | normal | rare | epic |
              legendary | limited | unique
  effects[]   AppliedEffect (embedded)
  isActive    default true
```

Each StoreItem targets one avatar slot. The target
determines where the item is equipped on the
Avatar.

### Weight Mapping

| Weight  | Border | Font Weight |
| ------- | ------ | ----------- |
| light   | 3px    | 300         |
| regular | 4px    | 400         |
| medium  | 5px    | 500         |
| bold    | 6px    | 700         |

### Rarity

Rarity is cosmetic metadata -- it drives visual
presentation in the store (border glow, label
color) but has no mechanical effect on gameplay.
Limited and unique rarities imply scarcity
(limited = time-gated, unique = one-of-a-kind).

---

## 2. Purchasing

1. Player selects item in store.
2. Check: player.xp >= item.price.
3. Deduct price from player.xp (player.xpSpent).
4. Add item ID to player.inventory.ownedItemIds[].
5. Fires store.itemPurchased.

Items are purchased once. No duplicates in
inventory. Repurchasing an owned item is blocked.

---

## 3. Equipping

Equipping sets the StoreItem ID on the
corresponding Avatar slot:

- target: letter -> avatar.letterId
- target: frame -> avatar.frameId
- target: title -> avatar.titleId
- target: email -> avatar.emailId
- target: flair -> avatar.flairId

Only items in the player's inventory can be
equipped. Equipping a new item in the same slot
replaces the old one.

---

## 4. Effect (stored)

The visual effect primitive. Effects manipulate
DOM elements via sandboxed CSS and JS. Used by
StoreItems and ComboPacks.

```
Effect
  name   display name
  css    static CSS with inline knob functions
  js     sandboxed (element, create, knobs) => element
```

### Knob Functions

Effects are parameterized via knobs. Knob
functions are called inside the CSS/JS to provide
configurable values:

- knobs.number(label, opts)
- knobs.color(label, opts)
- knobs.string(label, opts)
- knobs.url(label, opts)

Signature: `(label: string, options: Record<string,
string | number | boolean>)`

### Sandbox

JS runs via Proxy on the real DOM element. No
document, no window, no upward DOM traversal.
The `create` helper builds child elements. This
is the same sandbox model used by marketplace
items (see marketplace.md).

---

## 5. AppliedEffect (embedded)

An Effect with its knobs filled in. This is how
effects are attached to StoreItems and ComboTiers.

```
AppliedEffect
  effectId   which Effect
  values     Record<string, string | number | boolean>
             filled-in knob values
```

The values map corresponds to the knob labels
defined in the Effect's CSS/JS. At render time,
the effect engine evaluates the CSS/JS with these
values injected into the knob functions.

---

## 6. ThemeDef (stored)

Full color scheme for the app. Purchased and
equipped like store items but tracked separately
(equippedThemeId on Player, not an Avatar slot).

```
ThemeDef
  name         display name
  price        XP cost
  primary      hex
  secondary    hex
  accent       hex
  success      hex
  warning      hex
  error        hex
  info         hex
  background   hex
  surface      hex
  foreground   hex
  muted        hex
  border       hex
  isActive     default true
```

Equipping a theme overrides the app's CSS custom
properties for that user. Fires
store.themeEquipped.

---

## 7. Events

- store.itemPurchased
- store.themeEquipped
- store.comboPackEquipped
