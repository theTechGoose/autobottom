# Gamification Settings Spec

Per-team configuration that controls whether
gamification is active and how it behaves.

---

## 1. GamificationSettings (stored)

```
GamificationSettings
  teamId          root team = global default,
                  other = team override
  enabled         feature toggle (boolean)
  threshold       score threshold for XP earning
  comboTimeoutMs  combo window in milliseconds
  isActive        default true
```

---

## 2. Team Cascade

Settings resolve up the team hierarchy, same
pattern as providers and service bindings.

```
child team -> parent team -> org root -> platform
```

The root team's settings are the org-wide default.
A child team can override if the parent allows
delegation. First match walking up the tree wins.

Set by the team lead (Team.leaderId).

---

## 3. Feature Toggle

When `enabled` is false for a team, all
gamification features are hidden for users in that
team:

- Store is inaccessible
- XP is not earned or displayed
- Badges do not progress
- Combos do not activate
- Avatar customization is hidden
- Celebrations do not play

Existing Player data is preserved. Re-enabling
restores everything.

---

## 4. Score Threshold

`threshold` is the minimum audit score required
for XP to be awarded. An audit that scores below
the threshold does not earn XP but still counts
toward streak and badge progress.

Example: threshold = 80 means the agent must score
80 or above on an audit to earn XP from it.

---

## 5. Combo Timeout

`comboTimeoutMs` is the time window between audits
that maintains the combo streak. If the agent does
not complete another audit within this window, the
combo drops (onDrop fires) and resets to idle.

Shorter timeout = harder to maintain combos but
more intense. Longer timeout = more forgiving.

---

## 6. Personal Overrides

In addition to the team cascade, individual judges
and reviewers can override gamification settings
for their personal experience. The resolution
order is:

```
personal override -> team cascade
```

Personal overrides are stored per user (keyed by
email under the org's gamification namespace).
They can adjust:

- threshold (personal score bar)
- comboTimeoutMs (personal combo window)
- enabled (opt out personally)
- sounds (personal sound preferences)

This allows, for example, a competitive reviewer
to set a tighter combo timeout while the team
default stays forgiving.
