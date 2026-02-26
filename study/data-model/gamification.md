# Gamification

---

## Player `stored` (per user)

| Field | Description |
| ----- | ----------- |
| `xp` | current balance, earned and spent (level computed from this) |
| `dayStreak` | consecutive active days |
| `avatar` | Avatar (embedded) |
| `inventory` | Inventory (embedded) |
| `eventBindings[]` | EventBinding -- chosen celebrations per event |
| `equippedBadgeId` | visible badge on profile |
| `equippedThemeId` | active ThemeDef, drives app colors |
| `equippedComboPackId` | active ComboPack for queue |
| `badgeProgress[]` | BadgeProgress -- tracking toward unearned badges |
| `earnedBadges[]` | EarnedBadge -- completed badges |

---

## Avatar `embedded`

| Field | Description |
| ----- | ----------- |
| `letter` | single character displayed in the bubble |
| `flair` | character shown after email (usually emoji) |
| `letterId` | equipped StoreItem (target: letter) |
| `frameId` | equipped StoreItem (target: frame) |
| `titleId` | equipped StoreItem (target: title) |
| `emailId` | equipped StoreItem (target: email) |
| `flairId` | equipped StoreItem (target: flair) |

---

## Inventory `embedded`

| Field | Description |
| ----- | ----------- |
| `ownedItemIds[]` | string -- all purchased StoreItem IDs |

---

## Effect `stored`

| Field | Description |
| ----- | ----------- |
| `name` | display name |
| `css` | static CSS with inline knob functions |
| `js` | sandboxed `(element, create, knobs) => element` |

Knob functions: `knobs.number(label, opts)`, `knobs.color(label, opts)`,
`knobs.string(label, opts)`, `knobs.url(label, opts)`.

Signature: `(label: string, options: Record<string, string | number | boolean>)`.

JS runs via Proxy on real element -- no document, no window, no upward DOM traversal.

---

## StoreItem `stored`

| Field | Description |
| ----- | ----------- |
| `name` | display name |
| `price` | XP cost |
| `icon` | store listing icon |
| `target` | letter \| frame \| title \| email \| flair |
| `color` | CSS color or gradient |
| `weight` | light \| regular \| medium \| bold |
| `rarity` | common \| normal \| rare \| epic \| legendary \| limited \| unique |
| `effects[]` | AppliedEffect (embedded) |

**Weight mapping:** light = 3px / 300, regular = 4px / 400, medium = 5px / 500, bold = 6px / 700

---

## AppliedEffect `embedded`

| Field | Description |
| ----- | ----------- |
| `effectId` | which Effect |
| `values` | `Record<string, string | number | boolean>` -- filled-in knob values |

---

## EventBinding `embedded`

| Field | Description |
| ----- | ----------- |
| `eventType` | which event triggers this |
| `gifUrl` | celebration gif to play |

---

## ThemeDef `stored`

| Field | Description |
| ----- | ----------- |
| `name` | display name |
| `price` | XP cost |
| `primary` | hex |
| `secondary` | hex |
| `accent` | hex |
| `success` | hex |
| `warning` | hex |
| `error` | hex |
| `info` | hex |
| `background` | hex |
| `surface` | hex |
| `foreground` | hex |
| `muted` | hex |
| `border` | hex |

---

## ComboPack `stored`

| Field | Description |
| ----- | ----------- |
| `name` | display name |
| `price` | XP cost |
| `icon` | store listing icon |
| `rarity` | common \| normal \| rare \| epic \| legendary \| limited \| unique |
| `consumers[]` | ComboConsumerDef -- run simultaneously on floating letters |

---

## ComboConsumerDef `embedded`

| Field | Description |
| ----- | ----------- |
| `onDrop` | ComboTier -- fires when combo ends |
| `tiers[]` | ComboTier -- per combo level, clamped to last |

---

## ComboTier `embedded`

| Field | Description |
| ----- | ----------- |
| `effect` | AppliedEffect -- visual manipulation of element |
| `soundUrl` | audio to play |

---

## BadgeDef `stored`

| Field | Description |
| ----- | ----------- |
| `name` | display name |
| `icon` | badge icon |
| `description` | what the badge is for |
| `xpReward` | XP granted when earned |
| `threshold` | target count to earn |
| `increment` | expression evaluated per event, default 1 (e.g. `fields.wgsRevenue`) |
| `filter[]` | BadgeCriteria -- conditions applied to each event |

---

## BadgeCriteria `embedded`

| Field | Description |
| ----- | ----------- |
| `source` | field \| result |
| `key` | FieldDef key (source: field) or "score" (source: result) |
| `operator` | === \| !== \| >= \| <= \| > \| < |
| `value` | comparison value |
| `chain` | and \| or |

---

## BadgeProgress `embedded`

| Field | Description |
| ----- | ----------- |
| `badgeDefId` | which badge |
| `count` | matching events so far |

---

## EarnedBadge `embedded`

| Field | Description |
| ----- | ----------- |
| `badgeDefId` | which badge |
| `earnedAt` | when it was earned |

---

## GamificationSettings `stored`

| Field | Description |
| ----- | ----------- |
| `teamId` | root team = global default, other = team override |
| `enabled` | feature toggle |
| `threshold` | score threshold |
| `comboTimeoutMs` | combo window |

**Resolution:** set by team lead, resolves up team hierarchy.
