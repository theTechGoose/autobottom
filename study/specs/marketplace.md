# Marketplace Spec

A plugin system where developers publish JSON
packages that can be installed into apps.
Everything is sandboxed.

---

## 1. Item Types

- Effects (visual manipulations for store
  items/combos)
- Functions (data operations for the expression
  engine)
- Themes (color schemes)
- Widgets (dashboard widget types)
- Report types (new report visualizations)
- Store items (avatar frames, letters, flairs,
  titles, combo packs)
- Badge definitions (community-made achievement
  templates)
- Email templates (starter layouts)
- Calculated fields (custom derived columns for
  reports)
- Validators (custom QuestionType parsers)
- Condition functions (reusable filter logic)

---

## 2. Shared Base Pattern

All marketplace items are sandboxed string
functions (same pattern as Effects):

- Effect: `(element, create, knobs) => element`
- Function: `(target, utils) => target`
  (same base class, different inputs)
- Exported as JSON, installed per app
- Developer builds it, publishes to marketplace,
  admins install it

---

## 3. Sandboxing

- No document/window/DOM access (Proxy-based,
  like Effects)
- Query utility available (scoped to user's
  permissions)
- Timeout on execution for slow code
- Open publishing is safe because sandbox is
  airtight
