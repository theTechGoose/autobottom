# ReportQuery Spec

The query engine that powers all report types.
Defines what data to fetch, how to filter it, how
to sort and group it, and how to compute derived
columns.

---

## 1. ReportQuery (embedded in Report)

- filter -- FilterGroup (embedded). Root filter
  node. Can be nested.
- sortBy[] -- SortCriterion (embedded). Ordered
  list of sort columns.
- groupBy[] -- GroupCriterion (embedded). Ordered
  list of grouping columns.
- formulaFields[] -- FormulaField (embedded).
  User-defined computed columns.

All four are optional. A report with no filter
returns all data within the viewer's permission
scope. No sort returns default order (creation
time desc). No groupBy returns flat rows.

---

## 2. FilterGroup (embedded)

Recursive filter structure. Supports nested
AND/OR logic.

- conjunction -- "AND" | "OR". How conditions in
  this group combine.
- conditions[] -- FilterCondition (embedded).
  Individual filter predicates. Can also contain
  nested FilterGroups for arbitrary depth.

### Nesting Example

```
AND
  |- status = "resolved"
  |- OR
       |- callType = "inbound"
       |- callType = "transfer"
```

This finds resolved audits where callType is
either inbound or transfer.

### Reuse

FilterGroup and FilterCondition are reused by
EventConfig.conditions. Same shape, same
evaluation logic. One implementation serves both
reports and event filtering.

---

## 3. FilterCondition (embedded)

A single predicate.

- fieldKey -- column to filter. Can be an
  AuditInstance field, a FieldDef key from
  fieldValues, a result field, or a FormulaField
  key.
- operator -- comparison operation.
- value -- the value to compare against. Type
  depends on the field.

### Operators

| Operator         | Types              | Description            |
| ---------------- | ------------------ | ---------------------- |
| equals           | all                | exact match            |
| notEquals        | all                | not exact match        |
| contains         | string             | substring match        |
| notContains      | string             | no substring match     |
| startsWith       | string             | prefix match           |
| endsWith         | string             | suffix match           |
| greaterThan      | number, date       | >                      |
| lessThan         | number, date       | <                      |
| greaterOrEqual   | number, date       | >=                     |
| lessOrEqual      | number, date       | <=                     |
| in               | all                | value in list          |
| notIn            | all                | value not in list      |
| isEmpty          | all                | null or empty string   |
| isNotEmpty       | all                | not null, not empty    |

Operators are strings, not symbols. The evaluation
engine maps them to comparisons at runtime.

---

## 4. SortCriterion (embedded)

- fieldKey -- column to sort by. Same field
  resolution as FilterCondition.
- order -- "asc" | "desc".

Multiple SortCriteria are applied in array order
(primary sort, secondary sort, etc.).

---

## 5. GroupCriterion (embedded)

- fieldKey -- column to group by.
- grouping -- grouping method. Determines how
  values are bucketed.

### Grouping Methods

| Method    | Description                              |
| --------- | ---------------------------------------- |
| exact     | one group per unique value               |
| date-day  | group by calendar day                    |
| date-week | group by calendar week                   |
| date-month| group by calendar month                  |
| range     | numeric ranges (e.g. 0-50, 51-100)      |

Groups are rendered differently per ReportType:
tables show grouped rows with subtotals, charts
use groups as categories, summaries aggregate
per group. See types.md.

---

## 6. FormulaField (embedded)

User-defined computed columns. Evaluated per row
at query time.

- key -- unique identifier within the report.
  Used like any other fieldKey in filters, sorts,
  and groups.
- label -- display name.
- expression -- expression language string (see
  expressions.md). Has access to the row's field
  values and result data.

### Examples

```
key: "passRate"
label: "Pass Rate"
expression: "count(answers, answer === expectedAnswer) / count(answers)"
```

```
key: "callDuration"
label: "Call Duration (min)"
expression: "{{fields.callEndTime}} - {{fields.callStartTime}}"
```

FormulaFields are evaluated after data is fetched
but before filters, sorts, and groups that
reference them. This means a FormulaField can be
used in a FilterCondition, SortCriterion, or
GroupCriterion within the same report.

### Marketplace

Marketplace can provide pre-built calculated field
definitions. These are installed as FormulaField
templates that users can add to their reports. See
marketplace.md.
