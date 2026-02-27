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
- Impersonation (enter any admin context below,
  see impersonation details in section 5)
- Token Usage (LLM token metering dashboard,
  per-function cost attribution)

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
- Monitor LLM token usage and cost attribution
  per function (audit-questions, feedback,
  diarization, summarization)

---

## 5. Impersonation

Developers can assume the identity of any admin
user below them in the hierarchy.

### Impersonation Bar (UI Component)

A visual control bar at the top of the viewport
indicating active impersonation. Shows:

- Current impersonated user (email + role)
- "Exit impersonation" button to return to
  developer context
- Nested support: developer -> admin -> (navigate
  normally as admin). "Go back" returns to the
  developer view.

### resolveEffectiveAuth

Server-side mechanism that resolves the effective
authentication context. When impersonation is
active, the session carries both the real identity
(developer) and the effective identity (admin).
All permission checks use the effective identity.

---

## 6. API Documentation

The platform exposes an OpenAPI/Swagger spec:

- `GET /api/openapi.json` -- machine-readable spec
- `GET /docs` -- Swagger UI for interactive
  exploration
- Covers all public endpoints with request/response
  schemas
- Auto-generated from route definitions
