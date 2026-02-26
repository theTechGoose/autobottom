# Reports

---

## Report `stored`

| Field | Description |
| ----- | ----------- |
| `type` | one of ReportType names |
| `query` | ReportQuery (embedded) |
| `options` | ReportOptions (embedded) |
| `properties` | ReportProperties (embedded) -- varies by ReportType |
| `folderId` | references ReportFolder |
| `ownerId` | creator email |

**Relationships:**
- belongs to ReportFolder (folderId)
- owned by User (ownerId)

---

## ReportType `enum`

```
table | chart | calendar | summary | timeline
```

---

## ReportQuery `embedded`

| Field | Description |
| ----- | ----------- |
| `filter` | FilterGroup (embedded) |
| `sortBy[]` | SortCriterion (embedded) |
| `groupBy[]` | GroupCriterion (embedded) |
| `formulaFields[]` | FormulaField (embedded) |

---

## FormulaField `embedded`

| Field | Description |
| ----- | ----------- |
| `key` | unique identifier within the report |
| `label` | display name |
| `expression` | expression language string |

---

## FilterGroup `embedded`

| Field | Description |
| ----- | ----------- |
| `conjunction` | AND/OR |
| `conditions[]` | FilterCondition (embedded) |

---

## FilterCondition `embedded`

| Field | Description |
| ----- | ----------- |
| `fieldKey` | column to filter |
| `operator` | comparison op |
| `value` | filter value |

---

## SortCriterion `embedded`

| Field | Description |
| ----- | ----------- |
| `fieldKey` | column to sort |
| `order` | asc/desc |

---

## GroupCriterion `embedded`

| Field | Description |
| ----- | ----------- |
| `fieldKey` | column to group |
| `grouping` | grouping method |

---

## ReportOptions `embedded`

| Field | Description |
| ----- | ----------- |
| `rowHeight` | row pixel height |
| `columnHeaderText` | header label override |
| `groupDisplay` | how groups render |
| `colorMethod` | cell coloring strategy |

---

## ReportProperties `embedded`

Varies by ReportType.

---

## TableProperties `embedded`

| Field | Description |
| ----- | ----------- |
| `columnProperties[]` | per-column config |

---

## ChartProperties `embedded`

| Field | Description |
| ----- | ----------- |
| `chartType` | bar/line/pie |
| `dataSources[]` | data series |
| `categories` | x-axis grouping |
| `goal` | target line value |

---

## CalendarProperties `embedded`

| Field | Description |
| ----- | ----------- |
| `startDateField` | event start |
| `endDateField` | event end |

---

## TimelineProperties `embedded`

| Field | Description |
| ----- | ----------- |
| `startingField` | start date |
| `endingField` | end date |
| `milestoneField` | milestone marker |

---

## SummaryProperties `embedded`

| Field | Description |
| ----- | ----------- |
| `summarize[]` | fields to aggregate |
| `summaryFormulas[]` | aggregation formulas |
| `crosstabs` | pivot config |

---

## ReportFolder `stored`

| Field | Description |
| ----- | ----------- |
| `name` | folder name |
| `isDefault` | system default flag |
| `createdBy` | owner email |

**Relationships:**
- owns * Report
