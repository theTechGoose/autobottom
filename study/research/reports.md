# Reports Feature Specification

Custom reports for the Auto-Bot audit application. Inspired by QuickBase's
reports system, adapted for the audit domain.

---

## 1. Core Concepts

A **report** is a saved, named view of audit findings. Each report defines
which columns are visible, how data is filtered, and how it is sorted/grouped.
Reports are identified by a unique `reportId` and belong to the current user
within an organization.

### 1.1 Report Types

When creating a new report, the user picks one of these types:

| Type         | Description                                                                         |
| ------------ | ----------------------------------------------------------------------------------- |
| **Table**    | Spreadsheet-style report with rows and columns (default / most common)              |
| **Chart**    | Pie, bar, line and other chart visualizations                                       |
| **Calendar** | Date fields (e.g. audit dates, arrival/departure) displayed on a calendar layout    |
| **Summary**  | Group and total your data (pivot-table style -- e.g. findings by status by office)  |
| **Timeline** | Start and end dates rendered on a Gantt-style timeline (e.g. audit pipeline stages) |

---

## 2. Reports Panel (Report Picker)

Accessed by clicking the **"Reports"** button in the navigation area. Opens as
a dialog/overlay.

### 2.1 Layout

```
+------------------------------------------------------+
| [Search reports___________]            [+ New report] |
+---------------------------+--------------------------+
| Left column               | Right column             |
|                           |                          |
| Recents (N)               | Folders                  |
|   Report A                |   v General (N)          |
|   Report B                |   > Data Analysis (N)    |
|                           |   > Weekly Reviews (N)   |
|                           |   ...                    |
+---------------------------+--------------------------+
```

### 2.2 Left Column -- Recents

- **Recents section** -- shows recently viewed reports (with count)
- Each report entry is a link; hovering reveals a **"More actions"** button (...)
- Opening a report adds it to Recents automatically
- Recents are independent of folder organization

### 2.3 Right Column -- Folders

- Reports are organized into **named folders**
- Each folder is collapsible and shows its report count, e.g. `General (12)`
- Each folder header has a **"More actions"** button for folder-level operations
- A default folder named **General** is created automatically
- Users may create custom folders (e.g. `Data Analysis`, `Weekly Reviews`, `Office Reports`)

### 2.4 Search

- Text input at the top: `Search reports`
- Filters the report list in real time as the user types (searches across all folders)

### 2.5 New Report Button

- Primary button: **"+ New report"**
- Opens the **Create Report** dialog (see Section 3)

### 2.6 Per-Report Actions

Each report in the list has a "More actions" button (...) with:

- Open
- Rename
- Duplicate
- Move to folder
- Delete

---

## 3. Create Report Dialog

Modal dialog titled **"Create report"**.

### 3.1 Layout

- Report **name** text input at the top
- **Folder** dropdown to choose which folder the report belongs to (defaults to General)
- Report type selector -- 5 cards in a grid:
  - Row 1: Table | Chart
  - Row 2: Calendar | Summary
  - Row 3: Timeline
- Each option is a radio-style card showing an icon, name, and description
- Footer: **"Cancel"** button + **"Create"** button (disabled until a type is selected and name is provided)

### 3.2 Flow

1. User enters a report name
2. User selects a folder (or keeps default General)
3. User selects a report type (card highlights)
4. User clicks "Create"
5. System creates the report and navigates to its customize page

---

## 4. Report View (Display Mode)

The main page shown when a user opens/runs a report.

### 4.1 Page Structure

```
+------------------------------------------------------------------+
| [H1: Report Name]              [CSV] [Print] [Edit] [... More]  |
+------------------------------------------------------------------+
| Status bar: "N findings where [filter summary link]"             |
+------------------------------------------------------------------+
| Column Header Row (sortable)                                     |
|   [Col A ^] [Col B] [Col C] ...                                 |
+------------------------------------------------------------------+
| Data rows                                                        |
|   row 1                                                          |
|   row 2                                                          |
|   ...                                                            |
+------------------------------------------------------------------+
| Footer (totals/averages row if configured)                       |
+------------------------------------------------------------------+
```

### 4.2 Action Bar

Actions are inlined as buttons in the report header row:

- **Download CSV** -- exports report data
- **Print** -- opens browser print dialog
- **Edit report** -- opens the report customization page (Section 7)
- **More actions** (...) -- overflow menu for less common actions (Section 5)

### 4.3 Filter Summary Bar

- Shows: `N findings where [clickable filter summary]`
- The filter summary is a clickable button (e.g. `Status is "finished" AND`)
- Clicking it opens a **filter criteria popover** (Section 4.4)

### 4.4 Filter Criteria Popover

Displays all active filter conditions in a read-only table:

```
| (conjunction) | Field Name      | Condition                  |
|---------------|-----------------|----------------------------|
|               | Finding Status  | is "finished"              |
| and           | Office          | contains "GUNC"            |
| and           | Audit Date      | is after "2026-01-01"      |
| and           | Total Questions | is greater than 0          |
```

Each row shows:

- **Conjunction**: blank for first row, then `and` or `or`
- **Field name**: bold
- **Condition**: operator + value

### 4.5 Data Grid

- Column headers are clickable for sorting (shows sort direction indicator: ascending/descending arrow)
- Each column header has a **Column menu** button (Section 6)
- Rows display audit finding data
- Each row has a clickable link/icon to open the full audit finding detail
- Empty state: illustration + "No findings found"

---

## 5. More Actions Menu (Report-Level)

Opened via the **"..."** overflow button in the report header. Contains
less-frequent actions:

### 5.1 Save / Revert

| Item               | Behavior                                             |
| ------------------ | ---------------------------------------------------- |
| **Save report**    | Saves current state (disabled if no unsaved changes) |
| **Save report as** | Saves a copy with a new name                         |
| **Revert report**  | Reverts to last saved state (disabled if no changes) |

### 5.2 View Controls

| Item                  | Behavior                                    |
| --------------------- | ------------------------------------------- |
| **Enter full screen** | Expands report to fill the browser viewport |

### 5.3 Share

| Item          | Behavior                           |
| ------------- | ---------------------------------- |
| **Email**     | Opens email composition for report |
| **Copy link** | Copies the report URL to clipboard |

### 5.4 Data Operations

| Item                               | Behavior                                               |
| ---------------------------------- | ------------------------------------------------------ |
| **Find/replace in these findings** | Opens find/replace dialog scoped to report findings    |
| **Delete these findings**          | Bulk deletes all matching findings (with confirmation) |

### 5.5 Row Spacing (Radio Group)

| Item                  | Behavior                                        |
| --------------------- | ----------------------------------------------- |
| **Relaxed spacing**   | Larger row height                               |
| **Normal spacing**    | Default row height (checkmark indicates active) |
| **Condensed spacing** | Compact row height                              |

---

## 6. Column Menu

Opened by clicking the dropdown button on any column header in the data grid.

| Item                  | Behavior                                                               |
| --------------------- | ---------------------------------------------------------------------- |
| **Sort A to Z**       | Sorts findings by this column ascending                                |
| **Sort Z to A**       | Sorts findings by this column descending                               |
| **Group A to Z**      | Groups findings by this column's values, ascending                     |
| **Group Z to A**      | Groups findings by this column's values, descending                    |
| **Hide column**       | Removes this column from the current report view                       |
| **Show more columns** | Opens column picker to add additional columns                          |
| **Column properties** | Opens column-level display settings (width, alignment, label override) |

---

## 7. Report Customization Page

Full-page editor for report configuration. Accessed via "Edit report" button
or "Customize report" from the More Actions menu.

### 7.1 Page Header

```
+------------------------------------------------------------------+
| [< Back to report]                                               |
| Report Name                  [Save] [Preview] [Cancel] [Delete]  |
+------------------------------------------------------------------+
```

- **Back** link -- returns to report view without saving
- **Save** button (primary)
- **Preview** button -- runs the report with current settings in a new tab/overlay
- **Cancel** button -- discard changes and return to report view
- **Delete** button -- permanently delete the report (with confirmation dialog)

### 7.2 Section: Basics

| Field                               | Type            | Description                                            |
| ----------------------------------- | --------------- | ------------------------------------------------------ |
| **Type**                            | Read-only label | e.g. "Table Report" (with icon). Set at creation time. |
| **Name**                            | Text input      | Report display name                                    |
| **Description**                     | Textarea        | Optional description of what this report shows         |
| **Folder**                          | Dropdown        | Which folder this report belongs to                    |
| **Show description on report page** | Checkbox        | Toggles description visibility on the report view      |

### 7.3 Section: Columns to Display

Controls which audit finding fields appear as columns in the report.

#### Column Selection Mode

- **Radio**: `Default columns` | `Custom columns`

#### Column Picker (when Custom is selected)

```
+----------------------------+     +-----------------------------+
| Available                  |     | Report Columns              |
| [Search columns_________]  |     | [Reset to defaults]         |
|                            |     |                             |
| Appeal Comment             | [>] | Finding Status              |  [^]
| Appeal Type                | [<] | Office                      |  [^top]
| Arrival Date               |     | Guest Name                  |  [v]
| Audit Date                 |     | Audit Date                  |  [v-bottom]
| Departure Date             |     |                             |
| Destination                |     |                             |
| Diarized Transcript        |     |                             |
| Employee / Activator       |     |                             |
| Feedback Heading           |     |                             |
| Finding Status             |     |                             |
| Guest Name                 |     |                             |
| Marital Status             |     |                             |
| Office                     |     |                             |
| Phone Number               |     |                             |
| Questions Answered         |     |                             |
| Questions Total            |     |                             |
| Recording ID               |     |                             |
| Related Destination        |     |                             |
| Resort Name                |     |                             |
| Room Types                 |     |                             |
| Spouse Name                |     |                             |
| Total Deposit Attached     |     |                             |
| Total MCC Attached         |     |                             |
| Total WGS Attached         |     |                             |
| ...                        |     |                             |
+----------------------------+     +-----------------------------+
```

- **Available list**: All audit finding fields, searchable, scrollable multi-select
- **Report Columns list**: Currently selected columns in display order
- **Arrow buttons**: `>` (add to report), `<` (remove from report)
- **Reorder buttons**: `^` (move up), `^^` (move to top), `v` (move down), `vv` (move to bottom)
- **"Reset to defaults"** button: resets to the default column set

### 7.4 Section: Filters

Two sub-sections: **Initial** and **Dynamic**.

#### 7.4.1 Initial Filters

Defines the result set when the report is first loaded.

- **Radio**: `Show all findings` | `Filter findings`

When "Filter" is selected:

```
Show findings where
  [all v] of these conditions are true

  | [Field dropdown       v] | [Operator dropdown    v] | [Value input         v] |
  | and [Field dropdown   v] | [Operator dropdown    v] | [Value input         v] |
  | and [Field dropdown   v] | [Operator dropdown    v] | [Value input         v] |
```

Example with audit-specific fields:

```
  | Finding Status             | is                       | finished              |
  | and Office                 | contains                 | GUNC                  |
  | and Questions Answered     | is greater than          | 0                     |
  | and Audit Date             | is after                 | 2026-01-01            |
```

- **Conjunction selector**: `all` / `any` (AND vs OR logic)
- Each condition row has:
  - **Conjunction**: first row implicit, subsequent rows show `and`/`or`
  - **Field**: dropdown of all audit finding fields
  - **Operator**: context-sensitive dropdown based on field type (see Section 9)
  - **Value**: input/dropdown matching the field type
- **"+ Add condition"** button to add another filter row
- **"x"** button on each row to remove a condition

#### 7.4.2 Dynamic Filters

Defines how end users can refine/search the report at view time.

- **Radio**: `Custom` | `None`
- When "None" is selected: "(Dynamic filters won't be turned on in this report)"
- **Checkbox**: `Allow users to search using the Quick Search field.`

When "Custom" is selected, the same field/operator/value picker appears to
define which fields are available as dynamic filter controls on the report view.

### 7.5 Section: Sorting & Grouping

#### 7.5.1 Group Display

- **Radio**: `Collapsed by default` | `Expanded by default`

#### 7.5.2 Sort & Group

- **Radio**: `Sort on the default field (Audit Date)` | `Sort or group on other fields`

When "Sort or group on other fields" is selected, multiple sort rows appear:

```
[sort from low to high by v] [Finding Status    v]
then [sort from high to low by v] [Audit Date        v]
then [sort from low to high by v] [Office            v]
then [sort from low to high by v] [Guest Name        v]
```

Each row:

- **Direction dropdown**: `sort from low to high by` | `sort from high to low by` | `group from A to Z by` | `group from Z to A by`
- **Field dropdown**: any audit finding field
- Prefix: `then` for 2nd row onward

Controls:

- **"+ Add sort level"** button: adds another sort criterion
- **"x"** button on each row: removes that sort criterion

### 7.6 Section: Options

| Option                              | Type       | Values / Description                                                                               |
| ----------------------------------- | ---------- | -------------------------------------------------------------------------------------------------- |
| **Default row height**              | Dropdown   | `Relaxed` / `Normal` / `Condensed`                                                                 |
| **Column header text**              | Radio      | `Truncate (show 1 line only)` / `Wrap (up to 3 lines)`                                             |
| **Hide totals & averages**          | Checkbox   | `Hide all totals and averages rows`                                                                |
| **Row actions**                     | Checkboxes | `Show view icon next to findings` (opens finding detail page)                                      |
| **Disable bulk delete of findings** | Checkbox   | Hides selection checkboxes so users cannot select and delete multiple findings                     |
| **Editing behavior**                | Radio      | `Allow inline editing` / `Do not allow inline editing` ("Users must open each finding to edit it") |

### 7.7 Section: Color-Coding

Applies row-level color highlighting based on field values.

#### Method

- **Radio**:
  - `No color-coding` (default)
  - `Assign colors to choices in [field dropdown]` -- maps field values to colors (e.g. Finding Status: "finished" = green, "retrying" = yellow, "no recording" = red)
  - `Use a formula` -- expression-driven color assignment

#### Appearance

- **Radio**:
  - `Pale colors - easier to read`
  - `Full colors - more noticeable`

---

## 8. Data Grid Behaviors

### 8.1 Sorting

- Click a column header to toggle sort direction
- Sort indicator arrow shown next to the active sort column (ascending/descending)
- Multiple sort levels configured via report customization (Section 7.5)

### 8.2 Column Resizing

- Column widths are adjustable by dragging column header borders

### 8.3 Inline Editing

- When enabled, clicking a cell enters edit mode directly in the grid
- Controlled by the "Editing behavior" option in report settings

### 8.4 Row Selection

- Checkbox column on the far left for bulk selection (unless disabled)
- Selected rows can be bulk-deleted

### 8.5 Row Actions

- View icon: opens the audit finding detail page
- Visibility controlled by "Row actions" options

### 8.6 Pagination / Scrolling

- Grid scrolls vertically for large result sets
- Totals/averages row may appear at bottom if configured

### 8.7 Empty State

- Shows an illustration and "No findings found" message when filters return zero results

---

## 9. Filter Operators Reference

Operators vary by field type:

### Text Fields

(Finding Status, Office, Guest Name, Destination, Resort Name, etc.)

- `is` / `is not`
- `is empty` / `is not empty`
- `contains` / `does not contain`
- `starts with` / `does not start with`

### Numeric Fields

(Questions Answered, Questions Total, Total MCC Attached, Total WGS Attached, Total Deposit Attached, etc.)

- `is` / `is not`
- `is less than` / `is greater than`
- `is less than or equal to` / `is greater than or equal to`

### Date Fields

(Audit Date, Arrival Date, Departure Date, Re-Audited At, etc.)

- `is before` / `is after`
- `is on or before` / `is on or after`
- `is during` (with range: `today`, `yesterday`, `this week`, `last 7 days`, `this month`, `last 30 days`, `this year`)

### Enum / Status Fields

(Finding Status, Appeal Type, etc.)

- `is` / `is not` (dropdown of valid values)
- `is any of` / `is none of` (multi-select)

Finding Status values: `pending`, `creating-job`, `pulling-record`, `getting-recording`, `transcribing`, `populating-questions`, `asking-questions`, `no recording`, `retrying`, `finished`

### Boolean Fields

- `is Yes` / `is No`

---

## 10. Report Sharing & Distribution

### 10.1 Email

Send the report results via email (from More Actions menu). Opens a compose
dialog with:

- **To** field (recipients)
- **Subject** (pre-filled with report name)
- **Body** (optional message)
- Attaches the report as CSV or renders it inline

### 10.2 Scheduled Reports

Schedule recurring email delivery of report results. Managed through the
admin settings area. Configuration:

| Field          | Type     | Values                                      |
| -------------- | -------- | ------------------------------------------- |
| **Report**     | Dropdown | Select which saved report to send           |
| **Recipients** | Text     | Comma-separated email addresses             |
| **Cadence**    | Dropdown | `daily` / `weekly` / `biweekly` / `monthly` |
| **Enabled**    | Toggle   | On/Off                                      |

### 10.3 Copy Link

Copies a direct URL to the report. URL format:

```
/org/{orgId}/reports/{reportId}
```

---

## 11. Report Organization

### 11.1 Folders

Reports are organized into folders displayed in the right column of the
Reports Panel.

- A default folder named **General** is created automatically
- Users may create custom folders (e.g. `Data Analysis`, `Weekly Reviews`, `Office Reports`)
- Each folder displays its report count
- Folders are collapsible (expand/collapse toggle)
- Folder-level "More actions" menu allows:
  - Rename folder
  - Delete folder
  - Create new folder
- If a folder is deleted, all contained reports are moved to **General**

### 11.2 Drag-and-Drop Organization

- Reports can be dragged between folders
- Dropping a report into a folder immediately moves it
- Reports within a folder are automatically sorted alphabetically by report name
- Manual report ordering within a folder is not supported
- Because ordering is automatic, a separate "organize mode" is not required

### 11.3 Recents

- The left column displays recently viewed reports for quick access
- Recent reports appear regardless of folder location
- Opening a report adds it to Recents
- Recents does not affect folder organization

---

## 12. URL Structure

Reports follow this URL pattern:

```
/org/{orgId}/reports/{reportId}
```

The customize/edit page:

```
/org/{orgId}/reports/{reportId}/edit
```

---

## 13. Data Model

Based on the [QuickBase Report API](https://developer.quickbase.com/operation/getTableReports),
adapted for the audit app domain.

### 13.1 Report Entity (top-level)

Every report has these common fields regardless of type:

```
Report {
  id: string                      // unique report ID
  name: string                    // configured display name
  type: ReportType                // "table" | "chart" | "calendar" | "summary" | "timeline"
  description: string | null      // optional description

  // Ownership & organization
  ownerId: string                 // user ID of report owner
  orgId: string                   // owning organization
  folderId: string                // which folder this report belongs to

  // Query definition (executed when the report is run)
  query: ReportQuery

  // Type-specific configuration
  properties: ReportProperties    // varies by type (see 13.4)

  // Display options (app-specific, not in QB API)
  options: ReportOptions

  // Usage tracking
  usedLast: string                // ISO 8601 timestamp of last use
  usedCount: integer              // number of times report has been run

  // Timestamps
  createdAt: string               // ISO 8601
  updatedAt: string               // ISO 8601
}
```

### 13.2 ReportQuery

The query definition that gets executed when the report is run. Structure
varies slightly by report type.

```
ReportQuery {
  filter: string | null           // filter expression (see 13.2.1)

  // Columns (table, calendar, timeline only)
  fields: integer[]               // ordered list of field IDs to display
                                  // empty array = default fields

  // Sorting (table, timeline only)
  sortBy: SortCriterion[]

  // Grouping (table, timeline, summary only)
  groupBy: GroupCriterion[]

  // Calculated fields
  formulaFields: FormulaField[]
}
```

#### 13.2.1 Filter Expression

Filters use a structured expression format. Each condition specifies a field,
an operator, and a value:

```
FilterCondition {
  fieldId: integer                // field ID
  operator: string                // "CT" (contains), "EX" (is), "TV" (true value), etc.
  value: any                      // type depends on field
}
```

Conditions are joined by conjunction: `AND` (all conditions must match) or
`OR` (any condition must match).

#### 13.2.2 SortCriterion

```
SortCriterion {
  fieldId: integer                // field to sort by
  order: "ASC" | "DESC"          // sort direction
}
```

#### 13.2.3 GroupCriterion

```
GroupCriterion {
  fieldId: integer                // field to group by
  grouping: Grouping              // grouping strategy (see enum below)
}
```

**Grouping enum** (varies by field type):

| Category    | Values                                                                               |
| ----------- | ------------------------------------------------------------------------------------ |
| **General** | `equal-values`, `first-letter`, `first-word`                                         |
| **Date**    | `day`, `week`, `month`, `quarter`, `fiscal-quarter`, `year`, `fiscal-year`, `decade` |
| **Time**    | `second`, `minute`, `hour`, `time-of-day`                                            |
| **Numeric** | `.001`, `.01`, `.1`, `1`, `5`, `10`, `100`, `1000`, `10000`, `100000`, `1000000`     |

#### 13.2.4 FormulaField

Calculated formula fields available in the report:

```
FormulaField {
  id: integer                     // negative ID (e.g. -100)
  label: string                   // display label
  fieldType: FieldType            // result type
  formula: string                 // formula expression
  decimalPrecision: integer       // for numeric results
}
```

**FieldType enum**: `rich-text`, `text`, `numeric`, `currency`, `percent`,
`rating`, `date`, `timestamp`, `timeofday`, `duration`, `checkbox`, `phone`,
`email`, `user`, `multiuser`, `url`

### 13.3 ReportOptions

App-specific display settings (not part of the QB API, managed by our app):

```
ReportOptions {
  // Display
  rowHeight: "relaxed" | "normal" | "condensed"
  columnHeaderText: "truncate" | "wrap"
  groupDisplay: "collapsed" | "expanded"
  showDescription: boolean

  // Behavior
  hideTotals: boolean
  showViewIcon: boolean
  disableBulkDelete: boolean
  editingBehavior: "inline" | "no_inline"

  // Dynamic filters
  dynamicFilterMode: "custom" | "none"
  quickSearchEnabled: boolean

  // Color coding
  colorMethod: "none" | "field_choices" | "formula"
  colorField: string | null       // field key
  colorFormula: string | null
  colorAppearance: "pale" | "full"
}
```

### 13.4 Type-Specific Properties

The `properties` object varies by report type.

#### Table Properties

```
TableProperties {
  displayOnlyNewOrChangedRecords: boolean
  columnProperties: ColumnProperty[]
}
```

#### Calendar Properties

```
CalendarProperties {
  startDateField: integer         // field ID for event start date
  endDateFieldId: integer         // field ID for event end date
}
```

#### Timeline Properties

```
TimelineProperties {
  startDate: string | null        // earliest date to show (ISO YYYY-MM-DD)
  endDate: string | null          // latest date to show (ISO YYYY-MM-DD)
  startingFieldId: integer        // field ID for item start date
  endingFieldId: integer          // field ID for item end date
  milestoneFieldId: integer | null // field ID indicating milestone status
  sortByStartingField: boolean    // prioritize start field as first sort
  columnProperties: ColumnProperty[]
}
```

#### Summary Properties

```
SummaryProperties {
  summarize: SummarizeItem[]      // what to aggregate
  summaryVariables: SummaryVariable[]  // named variables for use in formulas
  summaryFormulas: SummaryFormula[]    // calculated summary fields
  sortBy: SummarySortCriterion[]
  crosstabs: GroupCriterion | null     // optional cross-tabulation
}
```

**SummarizeItem:**

```
SummarizeItem {
  type: "field-value" | "number-of-records" | "summary-formula"
  fieldId: integer | null         // required for field-value type
  aggregation: Aggregation | null // required for field-value type
  showAs: integer                 // 0=value, 1=% of column total,
                                  // 2=% of crosstab total, 3=running column total,
                                  // 4=running crosstab total
}
```

**Aggregation enum**: `AVG`, `SUM`, `MAX`, `MIN`, `STD-DEV`, `COUNT`, `DISTINCT-COUNT`

**SummaryVariable:**

```
SummaryVariable {
  fieldId: integer
  label: string                   // e.g. "Findings (total)"
  aggregation: Aggregation
}
```

**SummaryFormula:**

```
SummaryFormula {
  id: integer                     // negative ID (e.g. -301)
  label: string
  fieldType: FieldType
  formula: string                 // can reference summary variables by label
}
```

**SummarySortCriterion:**

```
SummarySortCriterion {
  order: "ASC" | "DESC"
  by: "summarization" | "groups"
  summarizationElementIndex: integer | null  // index into summarize array
}
```

#### Chart Properties

All chart sub-types (bar, pie, line, etc.) share this structure:

```
ChartProperties {
  chartType: ChartType            // specific chart visualization
  dataSources: ChartDataSource[]  // data series to plot
  categories: ChartCategory       // x-axis / grouping source
  series: object | null           // optional series breakdown
  dataLabel: string | null        // label for data values
  sortBy: ChartSortCriterion[]
  goal: ChartGoal | null          // optional goal line
}
```

**ChartType enum**: `bar`, `stacked-bar`, `horizontal-bar`,
`horizontal-stacked-bar`, `line`, `line-bar`, `area`, `pie`, `funnel`,
`scatter`, `bubble`, `waterfall`, `solid-gauge`

**ChartDataSource:**

```
ChartDataSource {
  type: "field-value" | "number-of-records"
  fieldId: integer | null
  aggregation: Aggregation | null
}
```

**ChartCategory:**

```
ChartCategory {
  fieldId: integer
  grouping: Grouping
  label: string | null
}
```

**ChartGoal:**

```
ChartGoal {
  label: string
  value: number
}
```

### 13.5 Shared Sub-Types

#### ColumnProperty

Per-column display overrides:

```
ColumnProperty {
  fieldId: integer
  labelOverride: string           // custom column header label
}
```

### 13.6 Folder Entity

```
Folder {
  id: string
  name: string
  orgId: string
  createdBy: string
  createdAt: string
  isDefault: boolean              // true for "General"
}
```

---

## 14. this could be anything and needs to be audit specific

These are the fields available for column selection, filtering, and sorting:

| Field Key              | Display Name           | Type   |
| ---------------------- | ---------------------- | ------ |
| `findingStatus`        | Finding Status         | enum   |
| `office`               | Office                 | text   |
| `guestName`            | Guest Name             | text   |
| `spouseName`           | Spouse Name            | text   |
| `phoneNumber`          | Phone Number           | text   |
| `alternateNumber`      | Alternate Number       | text   |
| `address`              | Address                | text   |
| `maritalStatus`        | Marital Status         | text   |
| `destination`          | Destination            | text   |
| `relatedDestination`   | Related Destination    | text   |
| `resortName`           | Resort Name            | text   |
| `roomTypes`            | Room Types             | text   |
| `arrivalDate`          | Arrival Date           | date   |
| `departureDate`        | Departure Date         | date   |
| `auditDate`            | Audit Date             | date   |
| `reAuditedAt`          | Re-Audited At          | date   |
| `recordingId`          | Recording ID           | text   |
| `employee`             | Employee / Activator   | text   |
| `questionsTotal`       | Questions Total        | number |
| `questionsAnswered`    | Questions Answered     | number |
| `feedbackHeading`      | Feedback Heading       | text   |
| `feedbackText`         | Feedback Text          | text   |
| `appealType`           | Appeal Type            | enum   |
| `appealComment`        | Appeal Comment         | text   |
| `totalMccAttached`     | Total MCC Attached     | number |
| `totalWgsAttached`     | Total WGS Attached     | number |
| `totalDepositAttached` | Total Deposit Attached | number |
