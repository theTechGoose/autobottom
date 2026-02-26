# Report & ReportFolder Spec

Reports are saved data views. A report combines a
query (what data to fetch, how to filter/sort/group
it) with a visualization type (table, chart,
calendar, summary, timeline) and display options.

---

## 1. Report (stored)

- type -- one of ReportType. Determines which
  visualization renders and which properties shape
  is used. See types.md.
- query -- ReportQuery (embedded). Defines what data
  the report operates on. See query.md.
- options -- ReportOptions (embedded). Display
  settings shared across all report types.
- properties -- ReportProperties (embedded). Type-
  specific visualization config. Shape varies by
  type. See types.md.
- folderId -- references ReportFolder. Which folder
  this report lives in.
- ownerId -- user email. Who created the report.

### Relationships

- belongs to ReportFolder (via folderId)
- owned by User (via ownerId)
- embeds ReportQuery, ReportOptions, ReportProperties

---

## 2. ReportFolder (stored)

Organizational container for reports. Flat
structure -- folders do not nest.

- name -- folder display name.
- isDefault -- system default flag. Default folders
  are created automatically and cannot be deleted.
  Users can create additional folders.
- createdBy -- email of the user who created the
  folder.

### Relationships

- owns Reports (via Report.folderId)

### Default Folders

Each org starts with a default folder (isDefault =
true). Reports created without specifying a folder
land here. Users and analysts can create additional
folders to organize reports by topic, team, or
cadence.

---

## 3. Ownership & Sharing

Reports follow the same ownership model as
dashboards:

- The creator (ownerId) has full edit access.
- Reports are scoped to the owner's permissions.
  The query runs against data the owner can see.
- When another user views a report, the data is
  re-scoped to the viewer's permissions. A report
  may show fewer rows for a viewer with narrower
  scope than the owner.
- Admins can view any report within their org.
- Developers can view reports across orgs via
  impersonation.

---

## 4. Data Source

Reports query AuditInstance data as their primary
source. The available columns come from:

- AuditInstance fields (status, subjectEmail,
  configId, recordingUrl)
- fieldValues (keyed by FieldDef.key from the
  AuditConfig)
- Latest AuditResult answers (question scores,
  pass/fail)
- Computed fields: overall score, pass rate, etc.
- FormulaFields defined in the query (user-created
  derived columns, see query.md)

The column set is dynamic because FieldDef keys
vary per AuditConfig. The report UI discovers
available columns from the referenced config's
fieldDefs and questionIds.

---

## 5. Events

- report.created
- report.modified
- report.deleted

Event payloads include: report ID, owner email,
report type, folder ID.

---

## 6. Scheduled Reports

Reports can be triggered on a schedule via the
`schedule.report` event in the EventConfig system.
An EventConfig with trigger `schedule.report` and
a cron-like schedule fires periodically, causing
the report to be generated and delivered through
the configured channel (email, webhook, chat).

No scheduling logic lives in the report entity.
The report is just a saved query -- EventConfig
handles when and where to deliver it.
