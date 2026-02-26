# Teams, Roles & Auth

---

## Team `stored`

Nestable container. The root team (`parentId: null`) represents the organization.

| Field | Description |
| ----- | ----------- |
| `parentId` | null = root team (the org) |
| `name` | display name |
| `slug` | URL-safe identifier |
| `leaderId` | team lead user |
| `memberEmails[]` | team member emails |

**Relationships:**
- nestable: parent Team -> child Teams

---

## RoleDef `stored`

Roles are data, not code enums. Defined per root team.

| Field | Description |
| ----- | ----------- |
| `name` | e.g. developer, admin, judge, analyst, supervisor, agent |
| `level` | 0 = developer, 1 = admin, higher = less access |
| `capabilities[]` | sidebar tabs / routes |
| `permissions[]` | team IDs (data scope) |

**Relationships:**
- belongs to root Team

---

## UserRecord `stored`

| Field | Description |
| ----- | ----------- |
| `email` | identifier (from memberEmails[]) |
| `passwordHash` | hashed password |
| `teamId` | assigned team |
| `roleId` | assigned role |
| `role` | cached from RoleDef |
| `level` | cached from RoleDef |
| `capabilities[]` | cached from RoleDef |
| `permissions[]` | cached from RoleDef |

**Relationships:**
- belongs to Team
- references RoleDef (roleId)

---

## Visibility Rule `computed`

Determines what data a user can see within their permitted teams.

- see self + anyone with a higher level number
- peers (same level) cannot see each other

| Viewer (level) | Sees |
| -------------- | ---- |
| developer (0) | everyone |
| admin (1) | self + judges (2) + supervisors, analysts + agents |
| judge (2) | self + analysts + agents |
| supervisor (2) | self + agents |
| agent (3+) | self only |

---

## Session `stored` (TTL 24h)

| Field | Description |
| ----- | ----------- |
| `email` | user email |
| `rootTeamId` | org-level team |
| `teamId` | user's team |
| `role` | role name |
| `level` | access level |
| `capabilities[]` | allowed sidebar tabs |
| `permissions[]` | allowed team scopes |
