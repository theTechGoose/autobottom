# Agent Capability Spec

The front-line user being audited. Agents are the
subjects of the audit process and the primary
consumers of the gamification system.

---

## 1. Scope

- Operates at their assigned team only.
- Highest level number (least access) in the
  hierarchy.
- Can only see themselves -- no visibility into
  peers, supervisors, judges, or analysts.

---

## 2. Capabilities (sidebar tabs)

- Dashboard (personal metrics, audit history,
  scores)
- Gamification (store, avatar customization,
  badges, themes, combo packs, event bindings)
- Appeals (file appeals on disputed findings)
- Messages (receive coaching notifications and
  direct messages)

---

## 3. Data Visibility

- Sees only their own data: their audits, their
  scores, their coaching records, their appeals.
- Cannot see other agents' data.
- No report creation or dashboard sharing.

---

## 4. Key Responsibilities

- Perform the work that gets audited (calls,
  interactions, etc.)
- Review their own audit results on the dashboard
- File appeals when they disagree with a finding
  (creates AppealRecord with notes)
- Receive and acknowledge coaching from supervisors
- Engage with gamification: earn XP, buy store
  items, equip avatars/themes/combo packs, earn
  badges, maintain streaks

---

## 5. Gamification Participation

- XP earned from audit scores meeting the
  GamificationSettings threshold
- XP spent in the store on StoreItems, ThemeDefs,
  ComboPacks
- Avatar customization: letter, frame, title,
  email display, flair
- Badges: progress tracked via BadgeProgress,
  earned when threshold met
- Combo packs: visual effects during audit queue
  processing
- Event bindings: choose celebration GIFs for
  events (level up, perfect score, etc.)
- Day streak: consecutive active days tracked
