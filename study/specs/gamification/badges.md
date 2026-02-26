# Badges Spec

Achievement system. Badges are defined with
criteria and thresholds, then tracked per player
as events come in. Earning a badge grants XP and
a displayable profile item.

---

## 1. BadgeDef (stored)

```
BadgeDef
  name         display name
  icon         badge icon
  description  what the badge is for
  xpReward     XP granted when earned
  threshold    target count to earn
  increment    expression evaluated per event,
               default 1 (e.g. fields.wgsRevenue)
  filter[]     BadgeCriteria (embedded)
  isActive     default true
```

BadgeDefs are created by admins (or installed from
marketplace). They define what it takes to earn a
badge.

---

## 2. Earning Flow

On each qualifying event (typically
audit.instance.resolved):

1. Evaluate filter[] against the event. All
   criteria must pass for the event to count.
2. Evaluate increment expression against the event
   context. Default is 1 (each event counts as 1).
   Custom increments let badges track cumulative
   values (e.g. total revenue across audits).
3. Add the increment value to the player's
   BadgeProgress.count for this badgeDefId.
4. Fire badge.progressUpdated.
5. If count >= threshold, move from badgeProgress[]
   to earnedBadges[] with current timestamp.
6. Grant xpReward to player (player.xpEarned).
7. Fire badge.earned.

---

## 3. BadgeCriteria (embedded)

```
BadgeCriteria
  source     field | result
  key        FieldDef key (source: field) or
             "score" (source: result)
  operator   === | !== | >= | <= | > | <
  value      comparison value
  chain      and | or
```

Criteria filter which events count toward the
badge. Each criterion checks a value from the
event's context.

### Source Types

- **field** -- checks a value from the audit's
  fieldValues (keyed by FieldDef.key). Example:
  `source: field, key: "department", operator: ===,
  value: "sales"` -- only counts audits from the
  sales department.
- **result** -- checks the audit result. Currently
  only `key: "score"` is supported. Example:
  `source: result, key: "score", operator: >=,
  value: 90` -- only counts audits with score >= 90.

### Chaining

Multiple criteria are combined via the chain
field:

- **and** -- this criterion AND the next must pass.
- **or** -- this criterion OR the next must pass.

Evaluation is left-to-right. All criteria with
chain: and form a group that must all pass. An or
starts a new group.

---

## 4. Increment Expression

The increment field is an expression (see
expressions.md) evaluated in the event context.
It determines how much to add to the progress
count per qualifying event.

- Default: `1` (each event adds 1)
- Custom: `fields.wgsRevenue` (adds the revenue
  value from the audit's fieldValues)
- Custom: `fields.callDuration / 60` (adds
  minutes)

This enables badges like "Accumulate $50,000 in
revenue" (threshold: 50000, increment:
fields.wgsRevenue) or "Handle 100 sales calls"
(threshold: 100, increment: 1).

---

## 5. BadgeProgress (embedded on Player)

```
BadgeProgress
  badgeDefId   which badge
  count        accumulated increment value so far
```

Tracks progress toward unearned badges. Updated
on each qualifying event. When count >= threshold,
the entry is removed from badgeProgress[] and an
EarnedBadge entry is added to earnedBadges[].

---

## 6. EarnedBadge (embedded on Player)

```
EarnedBadge
  badgeDefId   which badge
  earnedAt     timestamp when earned
```

Permanent record. Once earned, a badge stays in
earnedBadges[] forever. The player can equip one
earned badge as their profile badge via
player.equippedBadgeId.

---

## 7. Events

- badge.progressUpdated
- badge.earned
