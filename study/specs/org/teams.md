# Teams Spec

The nestable organizational unit. Everything in the
app -- users, configs, data visibility -- is scoped
to teams.

---

## 1. Entity

```
Team (stored)
  parentId        null = root team (the org)
  name            display name
  slug            URL-safe identifier
  leaderId        team lead user
  memberEmails[]  team member emails
  isActive        default true, false = soft-deleted
```

---

## 2. Nesting

Teams form a tree. A root team (parentId: null)
represents the organization. Child teams nest
under parents to unlimited depth.

```
Org A (root, parentId: null)
  Sales
    Floor 1
    Floor 2
  QA
    Manual
    Automation
```

The developer team sits above all org root teams
in the hierarchy. It is the only team that spans
multiple orgs.

---

## 3. Root Team = The Org

There is no separate "Organization" entity. The
root team IS the org. RoleDefs belong to the root
team. All org-wide config (gamification settings,
default dashboards) is anchored to the root team.

---

## 4. Leader

Each team has a leaderId pointing to a user. The
leader is the team's point of authority for
cascading settings (gamification, delegation).
Changing the leader fires team.leaderChanged.

---

## 5. Members

memberEmails[] is the flat list of users on this
team. Users belong to exactly one team (via
UserRecord.teamId). Adding or removing a member
fires team.memberAdded / team.memberRemoved.

---

## 6. Tree Traversal

Multiple systems walk the team tree upward:

- **Provider resolution:** find ProviderConfig for
  a type, walking child -> parent -> root -> platform.
- **Service binding resolution:** same walk pattern.
- **Gamification settings:** resolve up the tree,
  first match wins.
- **Visibility:** walk down from the user's
  permissions[] to determine data scope.

Override is only allowed if the parent's
delegateTo[] includes the child team ID.

---

## 7. Cascading Config Pattern

```
child team -> parent team -> org root -> platform
```

All cascading entities (ProviderConfig,
ServiceBinding, GamificationSettings) follow this
pattern. Resolution is one function: given a
teamId, walk up, return first match. No caching,
no inheritance merging.

---

## 8. Events

- team.created
- team.modified
- team.deleted
- team.memberAdded
- team.memberRemoved
- team.leaderChanged
