# Team Structure Overview

How teams, roles, auth, and capabilities fit
together. This is the index for the org domain.
Each section has a dedicated spec.

---

## Hierarchy

```
Developer (level 0, platform)
  |
  Admin (level 1, org root)
    |
    Supervisor / Judge / Analyst (level 2+, team)
      |
      Agent (highest level, team)
```

Lower level number = more access. Peers at the
same level cannot see each other. See auth.md
section 6 for visibility rules.

---

## Tree Shape

```
Platform
  Developer Team
    |
    Org A (root team)       Org B (root team)
    |                       |
    Sales    QA             Support
    |                       |
    Floor 1  Floor 2        Tier 1  Tier 2
```

Root team (parentId: null) = the org. No separate
org entity. See teams.md for nesting, traversal,
and cascading config.

---

## Specs

| File              | Covers                          |
| ----------------- | ------------------------------- |
| teams.md          | Team entity, nesting, tree      |
|                   | traversal, cascading config     |
| roles.md          | RoleDef entity, level system,   |
|                   | capabilities, permissions,      |
|                   | caching                         |
| auth.md           | UserRecord, Session, login,     |
|                   | access control, visibility,     |
|                   | impersonation                   |
| capabilities/*.md | What each default role can do   |
