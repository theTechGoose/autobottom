# Auth Spec

UserRecord is the stored identity. Session is the
auth state snapshot. Together they handle login,
access control, and session lifecycle.

---

## 1. UserRecord

```
UserRecord (stored)
  email           identifier (from memberEmails[])
  passwordHash    hashed password
  teamId          assigned team
  roleId          assigned RoleDef
  role            cached from RoleDef
  level           cached from RoleDef
  capabilities[]  cached from RoleDef
  permissions[]   cached from RoleDef
  isActive        default true, false = soft-deleted
```

Belongs to exactly one Team (teamId). References
exactly one RoleDef (roleId). Role fields are
cached for fast reads -- see roles.md section 5.

---

## 2. Session

```
Session (stored, TTL 24h)
  email           user email
  rootTeamId      org-level team
  teamId          user's team
  role            role name
  level           access level
  capabilities[]  allowed sidebar tabs
  permissions[]   allowed team scopes
```

Created on successful login. Expires after 24
hours. Contains a full snapshot of the user's
auth state at login time -- no joins needed to
check access.

---

## 3. Login Flow

1. User submits email + password.
2. Look up UserRecord by email.
3. Verify password against passwordHash.
4. If valid, create Session with fields copied
   from UserRecord (email, teamId, role, level,
   capabilities, permissions) + rootTeamId
   (resolved by walking up the team tree to the
   root).
5. Return session token.
6. Fires user.login event on success,
   user.loginFailed on failure.

---

## 4. Session Lifecycle

- **Created:** on login (session.created event).
- **Active:** every request includes session token.
  Middleware reads Session from KV, extracts
  capabilities and permissions for access control.
- **Expired:** TTL 24h. After expiry, KV auto-
  deletes the record (session.expired event).
  User must re-login.

No session refresh or sliding window. Fixed 24h
TTL.

---

## 5. Access Control

Two checks on every request:

1. **Capability check:** does the session's
   capabilities[] include the route/tab being
   accessed? If not, 403.
2. **Permission check:** does the session's
   permissions[] include the team ID of the data
   being accessed? If not, 403.

Both are array-contains checks against the
session. No database lookups during request
handling.

---

## 6. Visibility

Computed at read time, not stored.

- You see yourself + anyone with a higher level
  number (less access) within your permissions[].
- Peers at the same level cannot see each other.

This means:
- Level 0 (developer) sees everyone.
- Level 1 (admin) sees level 2+ in their org.
- Level 2 (supervisor) sees level 3+ in their
  permissions scope.
- Highest level (agent) sees only themselves.

Visibility is enforced by filtering query results
on level and team membership. The filter is:
`user.level > session.level AND user.teamId IN
session.permissions[]` (plus self).

---

## 7. Password Management

- Passwords are hashed before storage (passwordHash
  on UserRecord).
- Password changes fire user.passwordChanged event.
- No password reset flow specified yet.

---

## 8. Deactivation

Soft-delete via isActive flag on UserRecord.

- Deactivation fires user.deactivated.
- Reactivation fires user.reactivated.
- Deactivated users cannot log in (login check
  includes isActive).
- Existing sessions for deactivated users are not
  forcibly killed -- they expire naturally at TTL.

---

## 9. Impersonation (Developer Only)

Developer picks an admin below them and enters
their context. The session switches to the admin's
scope (rootTeamId, capabilities, permissions from
the target admin's RoleDef). Nested impersonation
supports "go back up" to return to the developer's
original session.

---

## 10. Events

- user.created
- user.modified
- user.deactivated
- user.reactivated
- user.passwordChanged
- user.login
- user.loginFailed
- session.created
- session.expired
