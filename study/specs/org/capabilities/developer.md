# Developer Capability Spec

Platform-level user whose team spans multiple orgs.
Level 0 in the RoleDef hierarchy.

---

## 1. Scope

- Team sits above all org root teams in the
  hierarchy. A developer at the bottom could exist
  but would only affect their own team.
- Can impersonate any admin below them and
  everything down the tree. Impersonation enters
  as admin and navigates normally from there.
  Nested impersonation supports "go back up" to
  return to the developer view.
- Every org starts with blank provider configs.
  Developer can impersonate admins to set these up.

---

## 2. Capabilities (sidebar tabs)

- Dashboard (app-wide stability/performance
  metrics)
- Providers (create/edit Provider definitions
  with configSchema)
- Services (view service registry, platform-level
  service bindings)
- Marketplace (build, publish, manage marketplace
  items)
- Logging (full Grafana access, all orgs, all
  labels)
- Teams (view/manage the full org tree)
- Impersonation (enter any admin context below)

---

## 3. Data Visibility

- Sees all orgs, all teams, all data.
- Logging label filter: none (all labels visible).
- Reports: can query across all orgs.

---

## 4. Key Responsibilities

- Define Provider schemas (what admins fill in)
- Publish marketplace items (effects, functions,
  themes, widgets, report types, store items,
  badges, email templates, calculated fields,
  validators, condition functions)
- Monitor app-wide health via logging and
  dashboard metrics
- Manage encryption keys for credential storage
- Handle platform-level service bindings and
  fallback configuration
