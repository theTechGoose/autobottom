# Roles Spec

RoleDef is the configurable blueprint that defines
what a user can see and do. Admins create RoleDefs
for their org. The system ships default names
(developer, admin, supervisor, judge, analyst,
agent) but admins can create custom ones.

---

## 1. Entity

```
RoleDef (stored)
  name            e.g. developer, admin, supervisor,
                  judge, analyst, agent
  level           0 = developer, 1 = admin,
                  higher = less access
  capabilities[]  sidebar tabs / routes
  permissions[]   team IDs (data scope)
  isActive        default true, false = soft-deleted
```

Belongs to the root team (the org). One set of
RoleDefs per org.

---

## 2. Level System

Level is a number. Lower = more access.

- 0: developer (platform-level, above all orgs)
- 1: admin (org-level)
- 2+: team-level (supervisor, judge, analyst, agent)

The level drives two things:
1. **Visibility** -- you see yourself + anyone with
   a higher level number.
2. **Hierarchy** -- lower level can manage higher
   level (admin manages supervisors, supervisors
   manage agents).

Peers at the same level cannot see each other.

---

## 3. Capabilities

capabilities[] is a list of strings that map to
sidebar tabs and routes. The sidebar shows
"Dashboard" (always present) + whatever is in
capabilities[].

Capabilities are the "what can you do" axis.
Examples: audit-review, coaching, reports,
dashboards, teams, users, roles, providers,
marketplace, appeals, gamification, event-configs,
logging, impersonation.

See capabilities/ directory for what each default
role gets.

---

## 4. Permissions

permissions[] is a list of team IDs that define
the user's data scope. Every data query is filtered
to these team IDs (and their descendants).

Permissions are the "what can you see" axis.

- Developer: all teams (or omitted, meaning
  unscoped).
- Admin: their org root team (sees all descendants).
- Team-level roles: their team + any explicitly
  listed descendant teams.

---

## 5. Caching to UserRecord

RoleDef fields are cached on UserRecord for fast
access:

```
UserRecord
  roleId          -> RoleDef ID
  role            -> RoleDef.name (cached)
  level           -> RoleDef.level (cached)
  capabilities[]  -> RoleDef.capabilities[] (cached)
  permissions[]   -> RoleDef.permissions[] (cached)
```

When a RoleDef is modified, all UserRecords
referencing that roleId must have their cached
fields updated. This is a fan-out write triggered
by role.modified.

---

## 6. Caching to Session

Session also snapshots these fields at login time.
A RoleDef change does NOT invalidate existing
sessions -- the user sees the old capabilities
until their session expires (TTL 24h) or they
re-login.

---

## 7. Custom Roles

Admins can create RoleDefs beyond the defaults.
A custom role is just a RoleDef with a custom name,
a chosen level, and a specific set of capabilities
and permissions. The system treats it identically
to a default role.

---

## 8. Events

- role.created
- role.modified
- role.deleted
