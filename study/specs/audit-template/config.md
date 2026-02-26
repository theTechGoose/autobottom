# AuditConfig Spec

The audit template. Defines what SHOULD happen when
an audit runs: which questions to ask, what input
data to collect, and what conditions skip questions.

AuditConfig is the configuration side. AuditInstance
(in the execution domain) is the runtime side that
records what DID happen.

---

## 1. AuditConfig (stored)

- uuid -- stable identifier, never changes across
  edits. This is the "audit type" identity.
- version -- integer, increments on each edit.
- configId -- composite key: `<uuid>:-:<version>`.
  This is the KV key and the value that
  AuditInstance.configId references.
- name -- display name for the audit type.
- fieldDefs[] -- FieldDef (embedded). Schema for
  input data required per audit. See fields.md.
- questionIds[] -- references to AuditQuestion.
  Ordered. This is the question sequence.
- skip[] -- SkipRule (embedded). Conditional logic
  that removes questions based on field values.
  See fields.md.

---

## 2. Versioning

Every edit to an AuditConfig creates a new version.
The uuid stays the same; the version increments;
the configId changes.

### Why composite keys

AuditInstance records which config version was used
at the time of execution. If the config is edited
after execution, the instance still points to the
exact version it ran against. This makes results
reproducible and auditable.

### Version lifecycle

```
v1: uuid-abc:-:1  (initial)
v2: uuid-abc:-:2  (question added)
v3: uuid-abc:-:3  (field removed)
```

Old versions are NOT deleted. They stay in KV so
AuditInstances referencing them can still resolve
the full config.

### What counts as an edit

Any change to the config body creates a new version:

- Adding/removing/reordering questions
- Changing fieldDefs
- Changing skip rules
- Changing name

The UUID never changes. Only the version increments.

---

## 3. Relationships

- **owns** AuditQuestion -- questionIds[] references
  stored AuditQuestion entities. Questions are
  independent stored entities so they can be shared
  or tested independently.
- **embeds** FieldDef[] -- input schema is part of
  the config, not a separate entity.
- **embeds** SkipRule[] -- skip logic is part of the
  config, not a separate entity.
- **referenced by** AuditInstance.configId -- the
  execution side points back to the exact config
  version used.

---

## 4. PipelineConfig (stored)

Controls how the execution pipeline behaves when
processing audits against this config.

- maxRetries -- retry limit for failed pipeline
  steps (transcription, question-asking).
- retryDelaySeconds -- delay between retries.

Separate from AuditConfig because pipeline behavior
is operational tuning, not audit definition. An admin
might change retry settings without wanting to bump
the audit config version.

---

## 5. Events

- audit.config.created
- audit.config.modified
- audit.config.deleted
- audit.config.versionPublished
- audit.config.schemaBreakingChange

A breaking change is: required FieldDef added
without default, FieldDef removed, or FieldDef
type changed. This can invalidate in-flight or
future AuditInstances that depend on field values.
