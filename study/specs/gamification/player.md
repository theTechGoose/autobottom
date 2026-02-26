# Player Spec

The per-user gamification profile. One Player per
UserRecord. Tracks XP, streaks, avatar config,
inventory, equipped items, badge progress, and
celebration bindings.

---

## 1. Player (stored, per user)

```
Player
  xp                   current balance (earned - spent)
  dayStreak            consecutive active days
  avatar               Avatar (embedded)
  inventory            Inventory (embedded)
  eventBindings[]      EventBinding (embedded)
  equippedBadgeId      visible badge on profile
  equippedThemeId      active ThemeDef, drives app colors
  equippedComboPackId  active ComboPack for queue
  badgeProgress[]      BadgeProgress (embedded)
  earnedBadges[]       EarnedBadge (embedded)
  isActive             default true
```

---

## 2. XP

XP is both earned and spent. The stored value is
the current balance, not a lifetime total.

- **Earning:** audit score meets the
  GamificationSettings threshold. Amount is
  determined by the scoring system (not specified
  here). Fires player.xpEarned.
- **Spending:** purchasing StoreItems, ThemeDefs,
  or ComboPacks from the store. Deducted from
  balance. Fires player.xpSpent.

---

## 3. Levels

Level is computed from XP, not stored. The formula
derives the level from the current XP balance.
When the computed level increases, fires
player.levelUp. Level can also decrease if XP
drops below the threshold after spending.

---

## 4. Day Streak

Consecutive active days. An "active day" is any
day the agent has at least one audit resolved.

- Each new active day increments dayStreak and
  fires player.streakIncremented.
- A missed day resets dayStreak to 0 and fires
  player.streakBroken.

---

## 5. Avatar (embedded)

Visual identity shown across the app.

```
Avatar
  letter     single character in the avatar bubble
  flair      character shown after email (emoji)
  letterId   equipped StoreItem (target: letter)
  frameId    equipped StoreItem (target: frame)
  titleId    equipped StoreItem (target: title)
  emailId    equipped StoreItem (target: email)
  flairId    equipped StoreItem (target: flair)
```

Each slot (letter, frame, title, email, flair)
references a StoreItem ID from the player's
inventory. Equipping an item sets the corresponding
ID. Unequipping sets it to null.

The `letter` and `flair` values are the actual
display content derived from the equipped item.

---

## 6. Inventory (embedded)

```
Inventory
  ownedItemIds[]   all purchased StoreItem IDs
```

Flat list of everything the player has bought.
Purchasing adds to this list (one-time, no
duplicates). Equipping reads from this list.

---

## 7. Event Bindings (embedded)

```
EventBinding
  eventType   which event triggers this
  gifUrl      celebration gif to play
```

Players choose which celebration GIF plays for
specific events (level up, perfect score, badge
earned, etc.). When the event fires and matches
a binding, the client plays the GIF as an overlay.

---

## 8. Equipped Items

Three top-level equip slots on Player:

- **equippedBadgeId** -- visible badge displayed
  on the player's profile. Must be in
  earnedBadges[].
- **equippedThemeId** -- active ThemeDef that
  drives the app's color scheme for this user.
  Must be in inventory.
- **equippedComboPackId** -- active ComboPack
  used during queue processing. Must be in
  inventory.

Equipping fires store.themeEquipped or
store.comboPackEquipped respectively.

---

## 9. Badge State

Two arrays track badge lifecycle:

- **badgeProgress[]** -- BadgeProgress (embedded).
  Tracking toward unearned badges. Each entry has
  badgeDefId + count. Updated on each qualifying
  event (badge.progressUpdated).
- **earnedBadges[]** -- EarnedBadge (embedded).
  Completed badges. Each entry has badgeDefId +
  earnedAt. Moved from progress to earned when
  count reaches threshold (badge.earned).

See badges.md for the full badge system.
