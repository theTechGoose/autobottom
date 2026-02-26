# Dashboard Pages Spec

DashboardPage is the stored entity that defines
what a user sees when they click the Dashboard tab.
Each user gets one dashboard per role, seeded from
system defaults.

---

## 1. DashboardPage Entity

| Field          | Type              | Description                                      |
| -------------- | ----------------- | ------------------------------------------------ |
| id             | string            | unique identifier                                |
| ownerId        | string \| null    | null = system default, string = user-created      |
| role           | string            | which role this dashboard belongs to              |
| name           | string            | user-given display name                          |
| widgets[]      | WidgetSlot[]      | ordered widget layout                            |
| sharedWith[]   | string[]          | emails of users this is shared with              |
| isActive       | boolean           | soft-delete flag (default true)                  |

---

## 2. System Defaults

Admins create default dashboards per role. These
have `ownerId = null` and act as templates.

When a user first lands on the Dashboard tab and
has no personal dashboard for their role:

1. Find the system default DashboardPage where
   `role` matches the user's role and
   `ownerId = null`.
2. Deep-clone it into a new DashboardPage with
   `ownerId` set to the user's email.
3. The user now owns their copy and can edit it
   freely.

This is copy-on-first-access, not copy-on-write.
The clone happens once. After that, changes to
the system default do not propagate to existing
user copies.

If no system default exists for a role, the user
gets an empty dashboard with zero widgets.

---

## 3. Sharing

A user can share their dashboard with other users
by adding emails to `sharedWith[]`.

### Rules

- The recipient must have permissions that overlap
  with the data the dashboard's widgets reference.
  If a widget queries data the recipient cannot
  see, that widget renders empty or shows a
  permissions notice -- it does not leak data.
- Sharing creates a read-only view for the
  recipient. They see the sharer's layout and
  widgets but cannot edit them.
- If the recipient wants to customize a shared
  dashboard, they clone it (same copy-on-first-
  access pattern), and now own their copy.
- Removing an email from `sharedWith[]` revokes
  access immediately. Cloned copies remain
  unaffected.

### Visibility

Shared dashboards appear in the recipient's
dashboard list with a "shared by {email}"
indicator. They are separate from the user's own
dashboards.

---

## 4. Multiple Dashboards

A user can create additional dashboards beyond
the default one. Each has a unique name. The user
picks which dashboard to view from a switcher in
the dashboard header.

There is no limit on the number of dashboards per
user. The first one in the list (or the one
matching their role default) is the landing page.

---

## 5. Events

Dashboard mutations fire events via the existing
event system:

- `dashboard.created` -- new dashboard
- `dashboard.modified` -- widget added/removed/
  reordered, name changed
- `dashboard.shared` -- sharedWith[] changed
- `dashboard.deleted` -- soft-deleted

Event payloads include: dashboard ID, owner email,
role, and the specific change (for modified).

---

## 6. Permissions

- Users can create, edit, and delete their own
  dashboards.
- Admins can create and edit system defaults
  (ownerId = null) for any role in their org.
- Admins can view any user's dashboard within
  their org (read-only unless they clone it).
- Developers can view and manage dashboards across
  all orgs via impersonation.
