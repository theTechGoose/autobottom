# Sidebar Navigation Spec

The sidebar is the primary navigation surface. It is
computed at login from the user's session and never
stored as its own entity.

---

## 1. Visual States

Two states: collapsed and expanded. Default state
is collapsed.

### Collapsed

- Thin vertical accent line (3-4px wide) on the
  left edge of the viewport.
- Color comes from the user's equipped ThemeDef
  accent value. Falls back to app default accent.
- No icons, no text. Just the glowing line.
- Hovering the line triggers expansion.

### Expanded

- Slides out from the left edge over the page
  content. Does not push content -- it overlays.
- Shows the tab list derived from capabilities.
- Clicking outside or moving the cursor away
  collapses it back to the line.

---

## 2. Tab List

Tabs are derived from `session.capabilities[]`,
which is cached from the user's RoleDef at login.

### Resolution

1. Read `session.capabilities[]`.
2. Each capability string maps to a sidebar tab.
   The mapping is a static lookup -- capability
   name to tab label and route.
3. "Dashboard" is always present regardless of
   capabilities. It is the first tab and the
   default landing route.
4. Remaining tabs appear in the order defined by
   the capabilities array.

### Per-Role Tabs

Different roles see different tabs. Examples from
existing capability specs:

- **Agent**: Dashboard, Queue (audit queue),
  Appeals, Store, Profile
- **Supervisor**: Dashboard, Team Audits,
  Coaching, Reports
- **Analyst**: Dashboard, Reports, Audit Configs
- **Judge**: Dashboard, Appeals Queue
- **Admin**: Dashboard, Teams, Users, Roles,
  Provider Configs, Service Bindings, Event
  Configs, Reports, Dashboards, Gamification
  Settings, Audit Configs
- **Developer**: Dashboard, Providers, Services,
  Marketplace, Logging, Impersonation

The exact tab list per role is defined in the
RoleDef's capabilities array. The examples above
are defaults -- admins can customize which
capabilities each role gets.

---

## 3. Active Tab Indicator

The currently active tab is visually highlighted
in the expanded sidebar. The accent color from
the user's equipped ThemeDef drives the highlight.

When the user navigates to a route that belongs
to a tab, that tab becomes active. Routes are
prefix-matched: `/reports/123` activates the
"Reports" tab.

---

## 4. No Persistence

The sidebar has no stored state. It is rebuilt
from the session on every page load. There is no
"sidebar config" entity -- the capabilities array
is the config.

If the user's role changes (admin updates their
RoleDef), the sidebar updates on their next login
when the session is rebuilt.

---

## 5. Mobile / Narrow Viewport

On narrow viewports the collapsed line remains.
Tapping it opens the sidebar as a full-height
overlay. Tapping outside dismisses it. Same tab
list, same behavior.
