# Store Spec

Purchasable cosmetics: avatar items, themes, and
the visual effect system that powers them.

---

## 1. StoreItem (stored)

```
StoreItem
  name        display name
  price       token cost (deducted from tokenBalance)
  icon        store listing icon
  type        letter | frame | title | email | flair |
              name_color | font | animation | theme
  color       CSS color or gradient
  weight      light | regular | medium | bold
  rarity      common | normal | rare | epic |
              legendary | limited | unique
  effects[]   AppliedEffect (embedded)
  isActive    default true
```

Each StoreItem has a type that determines how it
is equipped. Avatar slot items (letter, frame,
title, email, flair) are equipped on the Avatar.
Cosmetic items (name_color, font, animation) are
equipped as profile-level settings. Theme items
equip via equippedThemeId on Player (see also
ThemeDef for full color schemes).

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
2. Check: player.tokenBalance >= item.price.
3. Deduct price from player.tokenBalance
   (player.xpSpent). totalXp is unchanged.
4. Add item ID to player.inventory.ownedItemIds[].
5. Fires store.itemPurchased.

Items are purchased once. No duplicates in
inventory. Repurchasing an owned item is blocked.

---

## 3. Equipping

Equipping sets the StoreItem ID on the
corresponding slot:

### Avatar Slots

- type: letter -> avatar.letterId
- type: frame -> avatar.frameId
- type: title -> avatar.titleId
- type: email -> avatar.emailId
- type: flair -> avatar.flairId

### Profile Slots

- type: name_color -> player.equippedNameColor
- type: font -> player.equippedFont
- type: animation -> player.animBindings
- type: theme -> player.equippedThemeId
  (or use ThemeDef directly)

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
