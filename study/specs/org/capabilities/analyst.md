# Analyst Capability Spec

Team-level user focused on data analysis,
reporting, and event-driven automation. Builds
the dashboards and reports that other roles
consume.

---

## 1. Scope

- Operates at their assigned team and descendant
  teams within their permissions[].
- Cannot see peers at the same level.
- Read-heavy role -- analysts observe and report
  but do not participate in the audit/review/appeal
  workflow directly.

---

## 2. Capabilities (sidebar tabs)

- Dashboard (analytics-focused, customizable)
- Reports (full CRUD: table, chart, calendar,
  summary, timeline)
- Report Folders (organize reports)
- Dashboards (create/customize/share)
- Event Configs (build notification rules, set up
  webhook/email/chat triggers)

---

## 3. Data Visibility

- Sees their team + descendant teams per
  permissions[].
- Can query audit instances, results, appeals,
  coaching records within scope.
- Cannot see other analysts, supervisors, or
  judges at the same level.

---

## 4. Key Responsibilities

- Build and maintain reports (filter, sort, group,
  formula fields)
- Create dashboards with widgets (report embeds,
  charts, text, button bars, link bars, search)
- Share dashboards and reports with others
  (sharedWith[] respects recipient permissions)
- Configure event-driven automations via
  EventConfig (trigger conditions, delivery
  channel, payload templates)
- Design scheduled reports (schedule.report event)
