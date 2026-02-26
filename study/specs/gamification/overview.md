# Gamification Overview

XP-driven reward system for agents. Agents earn XP
from audit performance, spend it in the store on
cosmetics, and progress toward badges. Visual
feedback (effects, combos, celebrations) makes
the audit queue engaging.

---

## Core Loop

```
audit resolved
  -> score meets threshold?
    -> XP earned
      -> level up?
      -> badge progress?
      -> streak maintained?
```

XP is the single currency. Everything flows
through it: earning comes from audit scores,
spending happens in the store, level is computed
from the balance.

---

## Feature Toggle

Gamification is opt-in per team via
GamificationSettings. See settings.md. The setting
cascades up the team tree -- a parent team can
enable it for all children, a child team can
override if the parent allows delegation.

---

## Specs

| File        | Covers                              |
| ----------- | ----------------------------------- |
| player.md   | Player, Avatar, Inventory,          |
|             | EventBinding, XP, levels, streaks   |
| store.md    | StoreItem, Effect, AppliedEffect,   |
|             | ThemeDef, purchasing, equipping     |
| combos.md   | ComboPack, ComboConsumerDef,        |
|             | ComboTier, tier escalation          |
| badges.md   | BadgeDef, BadgeCriteria,            |
|             | BadgeProgress, EarnedBadge          |
| settings.md | GamificationSettings, team cascade  |

---

## Events

### Player
- player.xpEarned
- player.xpSpent
- player.levelUp
- player.streakIncremented
- player.streakBroken

### Badge
- badge.earned
- badge.progressUpdated

### Store
- store.itemPurchased
- store.themeEquipped
- store.comboPackEquipped

### Broadcast (org-wide, visible to everyone)
- broadcast.saleCompleted
- broadcast.perfectScore
- broadcast.levelUp
