# FieldDef & SkipRule Spec

Input schema and conditional skip logic for audit
configs. FieldDefs define what data is required per
audit. SkipRules define conditions under which
questions are skipped based on that data.

---

## 1. FieldDef (embedded in AuditConfig)

Defines a single input field that must be provided
when creating an AuditInstance.

- key -- unique identifier within the config. Used
  as the lookup key in AuditInstance.fieldValues.
- label -- display name shown in the UI.
- type -- input type (text, number, date, select,
  boolean, etc.).
- required -- mandatory flag. If true, the audit
  cannot be created without this field.
- default? -- fallback value if not provided. Only
  meaningful when required is false.
- options? -- allowed values. Used when type is
  select or similar constrained input. Array of
  valid values.

### Usage

FieldDefs serve two purposes:

1. **Input validation** -- when creating an
   AuditInstance, the provided fieldValues are
   validated against the config's fieldDefs.
   Required fields must be present. Values must
   match the declared type. Select fields must
   use one of the allowed options.

2. **Expression context** -- field values are
   available in expressions as `{{fields.key}}`.
   This feeds into question text interpolation,
   skip rule evaluation, badge criteria, and
   report filters.

### Examples

| key         | label          | type   | required |
| ----------- | -------------- | ------ | -------- |
| agentEmail  | Agent          | text   | true     |
| callType    | Call Type      | select | true     |
| department  | Department     | select | false    |
| callDate    | Call Date      | date   | true     |
| wgsRevenue  | WGS Revenue    | number | false    |

---

## 2. SkipRule (embedded in AuditConfig)

Conditional logic that removes a question from the
audit based on field values. Evaluated before the
pipeline asks questions.

- questionId -- which AuditQuestion to skip.
- expression -- condition to evaluate. Uses the
  expression language (see expressions.md). Has
  access to `{{fields.*}}` context.
- message -- reason shown when the question is
  skipped. Appears in AuditResult.skipped[] as
  SkippedEntry.message.

### Evaluation

Skip rules are evaluated after field values are
populated but before the question-asking phase.
For each skip rule:

1. Evaluate the expression against the current
   fieldValues.
2. If truthy, remove the question from the active
   question list.
3. Record a SkippedEntry with the question ID and
   the skip rule's message.

### Expression examples

```
{{fields.callType}} === 'inbound'
```
Skip this question for inbound calls.

```
{{fields.department}} === 'sales' AND {{fields.wgsRevenue}} > 0
```
Skip this question for sales calls with revenue.

```
{{fields.callType}} !== 'transfer'
```
Only ask this question for transfer calls.

### Ordering

Multiple skip rules can target the same question.
If ANY skip rule evaluates to true for a question,
the question is skipped. First matching rule's
message is used in the SkippedEntry.

Skip rules are evaluated in array order. This
matters only for which message is shown -- the
skip itself is a simple OR across all matching
rules.
