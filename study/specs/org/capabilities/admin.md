# Admin Capability Spec

Org-level user who manages teams, roles, users,
and infrastructure configuration for their
organization. Level 1 in the RoleDef hierarchy.

---

## 1. Scope

- Operates at the org root team and everything
  below it.
- Cannot see other orgs or platform-level config.
- Manages their org's team tree: create/edit/delete
  teams, assign leaders, add/remove members.

---

## 2. Capabilities (sidebar tabs)

- Dashboard (org-level metrics, customizable)
- Teams (create/edit/delete teams, manage tree)
- Users (create/edit/deactivate users, assign
  roles and teams)
- Roles (create/edit RoleDefs with capabilities
  and permissions)
- Provider Configs (fill in credentials per team
  using developer-defined schemas)
- Service Bindings (wire services to providers,
  configure fallback chains, set delegation)
- Event Configs (create/edit notification rules,
  install notification packs from marketplace)
- Reports (full access, create/share/manage)
- Dashboards (create/share/manage, set defaults
  per role)
- Gamification Settings (enable/disable, set
  thresholds per team)
- Audit Configs (create/edit/version audit
  templates, manage questions and skip rules)

---

## 3. Data Visibility

- Sees their org's root team and all descendant
  teams.
- Logging label filter: scoped to org teamIds.
- Reports: scoped to org data.
- Can see all users within the org regardless of
  team.

---

## 4. Key Responsibilities

- Onboard teams and users
- Configure provider credentials (API keys,
  endpoints) for the org
- Set up service bindings with fallback chains
- Define RoleDefs (which capabilities and
  permissions each role gets)
- Build and maintain audit configs (the templates
  that define what gets audited)
- Configure event-driven notifications (webhooks,
  emails, chat)
- Manage gamification settings per team
