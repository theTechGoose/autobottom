# ReportType & Properties Spec

Each report has a type that determines how data is
visualized. The type selects which properties shape
is used and how the query results render.

---

## 1. ReportType (enum)

| Type     | Description                              |
| -------- | ---------------------------------------- |
| table    | rows and columns, spreadsheet-like       |
| chart    | bar, line, or pie visualization          |
| calendar | date-based event view                    |
| summary  | aggregated metrics with optional pivots  |
| timeline | horizontal time-based track view         |

Marketplace can add new ReportTypes. Installed
types appear alongside built-in types in the report
creation UI. See marketplace.md.

---

## 2. ReportOptions (embedded, shared by all types)

Display settings that apply regardless of type.

- rowHeight -- row pixel height (primarily for
  table, but used by calendar/timeline for event
  height).
- columnHeaderText -- header label override. Map
  of fieldKey to custom display label. Lets users
  rename columns without changing the underlying
  field.
- groupDisplay -- how groups render visually.
  Options: "collapse" (accordion, collapsed by
  default), "expand" (accordion, expanded by
  default), "flat" (no accordion, subtotal rows
  inline).
- colorMethod -- cell coloring strategy. Options:
  "none" (no coloring), "conditional" (rules-based
  per cell), "heatmap" (gradient across value
  range), "status" (color by status field value).

---

## 3. ReportProperties (varies by type)

The properties field on Report holds type-specific
config. The shape depends on Report.type. Only one
properties shape is populated per report.

---

### TableProperties

For type = "table". The default and most common
report type.

- columnProperties[] -- per-column configuration.
  Array of objects, one per visible column.

ColumnProperty:

| Field     | Type    | Description                    |
| --------- | ------- | ------------------------------ |
| fieldKey  | string  | which column                   |
| visible   | boolean | show/hide toggle               |
| width     | number  | column width in pixels         |
| frozen    | boolean | pin to left on horizontal scroll|
| format    | string  | display format (date format,   |
|           |         | number precision, etc.)        |

Column order is determined by array position.
Users reorder columns via drag-and-drop, which
rearranges the array.

---

### ChartProperties

For type = "chart".

- chartType -- "bar" | "line" | "pie". The
  visualization variant.
- dataSources[] -- data series to plot. Each
  series defines which field provides the values.
- categories -- field used for x-axis grouping.
  The x-axis labels come from unique values of
  this field (or from GroupCriterion if groupBy
  is used in the query).
- goal -- target line value. Renders a horizontal
  reference line at this value. Null = no goal
  line.

DataSource:

| Field     | Type   | Description                     |
| --------- | ------ | ------------------------------- |
| fieldKey  | string | value field to aggregate        |
| aggregate | string | sum \| avg \| count \| min \| max |
| label     | string | series label in legend          |
| color     | string | series color (hex or theme ref) |

Multiple dataSources overlay on the same chart
(e.g. two lines on a line chart, stacked bars).

---

### CalendarProperties

For type = "calendar". Shows data as events on a
calendar grid.

- startDateField -- fieldKey for event start date.
- endDateField -- fieldKey for event end date.
  If null, events are single-day (point events).

Each row in the query result becomes a calendar
event. The event label comes from a configurable
display field (first non-date column by default).
Events span from startDateField to endDateField.

Calendar supports month, week, and day views.
Default view is month.

---

### TimelineProperties

For type = "timeline". Horizontal track view
showing items across a time range (Gantt-like).

- startingField -- fieldKey for the start date.
- endingField -- fieldKey for the end date.
- milestoneField -- fieldKey for milestone markers.
  If a row's milestoneField is truthy, it renders
  as a diamond marker instead of a bar.

Each row becomes a horizontal bar from
startingField to endingField. Rows are grouped
vertically by the first GroupCriterion in the
query (if any), otherwise listed flat.

---

### SummaryProperties

For type = "summary". Aggregated metrics, optional
pivot tables.

- summarize[] -- fields to aggregate. Array of
  field keys that will be summarized.
- summaryFormulas[] -- aggregation formulas applied
  to each summarize field.
- crosstabs -- pivot configuration. Null = no
  pivot.

SummaryFormula:

| Field     | Type   | Description                     |
| --------- | ------ | ------------------------------- |
| fieldKey  | string | which summarize field           |
| formula   | string | sum \| avg \| count \| min \| max \| median \| stddev |
| label     | string | display label for the result    |

Crosstabs:

| Field       | Type   | Description                   |
| ----------- | ------ | ----------------------------- |
| rowField    | string | field for row headers         |
| columnField | string | field for column headers       |
| valueField  | string | field to aggregate in cells   |
| formula     | string | aggregation formula for cells |

When crosstabs is set, the summary renders as a
pivot table: rows from rowField, columns from
columnField, cell values from applying formula to
valueField. Useful for cross-referencing two
dimensions (e.g. agents vs audit configs, teams vs
months).

---

## 4. Evaluation Order

When a report renders:

1. Fetch data within viewer's permission scope.
2. Evaluate FormulaFields per row.
3. Apply FilterGroup (including filters on
   FormulaFields).
4. Apply SortCriteria.
5. Apply GroupCriteria.
6. Pass grouped/sorted data to the type-specific
   renderer with its properties and options.

This order means FormulaFields are available to
all downstream operations, and filters apply before
grouping.
