# Dashboard Widgets Spec

Widgets are the building blocks of a dashboard
page. Each widget occupies a slot in a responsive
grid and renders a specific type of content.

---

## 1. WidgetSlot (embedded in DashboardPage)

| Field  | Type         | Description                        |
| ------ | ------------ | ---------------------------------- |
| id     | string       | unique within the dashboard        |
| type   | WidgetType   | which widget to render             |
| title  | string       | display label above the widget     |
| column | number       | grid column (0-indexed)            |
| order  | number       | sort position within the column    |
| span   | number       | how many columns wide (default 1)  |
| config | WidgetConfig | type-specific configuration        |

---

## 2. Grid Layout

The dashboard uses a column-based grid. Default
is 3 columns on desktop. Widgets are placed by
column index and sorted by order within each
column.

- `column` determines horizontal placement.
- `order` determines vertical stacking within
  that column. Lower number = higher on page.
- `span` lets a widget stretch across multiple
  columns. A span of 2 in column 0 covers
  columns 0-1.
- On narrow viewports, columns stack vertically.
  All widgets become single-column, ordered by
  column then order.

Users reorder widgets via drag-and-drop. This
updates the `column` and `order` values on the
affected WidgetSlots.

---

## 3. WidgetType (enum)

| Type         | Description                                |
| ------------ | ------------------------------------------ |
| report       | embedded report visualization              |
| text         | static or dynamic text block               |
| button-bar   | row of action buttons                      |
| link-bar     | row of navigation links                    |
| search       | search input scoped to a data source       |
| reports-list | browsable list of saved reports            |
| embed        | iframe or external content embed           |

Marketplace can add new WidgetTypes. Installed
widget types appear in the widget picker alongside
built-in types. See marketplace.md for the
sandboxing model.

---

## 4. WidgetConfig (per type)

Each WidgetType has its own config shape. The
config object is freeform -- validated by the
widget renderer, not by the dashboard system.

### report

| Field    | Type   | Description                      |
| -------- | ------ | -------------------------------- |
| reportId | string | which saved Report to embed      |
| height   | number | fixed height in pixels (optional)|

Renders the referenced Report inline. The report
respects the viewer's permissions -- if the user
cannot access the report's data scope, the widget
shows a permissions notice.

### text

| Field   | Type   | Description                       |
| ------- | ------ | --------------------------------- |
| content | string | markdown or plain text            |
| dynamic | boolean| if true, content supports         |
|         |        | expression interpolation          |

Static text for announcements, instructions, or
notes. When `dynamic` is true, expressions like
`{{ user.email }}` or `{{ query(...) }}` are
evaluated at render time using the expression
engine (see expressions.md).

### button-bar

| Field     | Type             | Description              |
| --------- | ---------------- | ------------------------ |
| buttons[] | ButtonDef[]      | action buttons           |

ButtonDef:

| Field  | Type   | Description                        |
| ------ | ------ | ---------------------------------- |
| label  | string | button text                        |
| action | string | route to navigate to, or event     |
|        |        | to fire                            |
| style  | string | primary \| secondary \| danger     |

Quick-action buttons. Clicking navigates to a
route or fires a client-side event (e.g. open a
modal, start an audit).

### link-bar

| Field   | Type          | Description                 |
| ------- | ------------- | --------------------------- |
| links[] | LinkDef[]     | navigation links            |

LinkDef:

| Field | Type   | Description                         |
| ----- | ------ | ----------------------------------- |
| label | string | link text                           |
| url   | string | internal route or external URL      |
| icon  | string | optional icon identifier            |

Horizontal row of links for quick navigation.
External URLs open in a new tab.

### search

| Field      | Type   | Description                    |
| ---------- | ------ | ------------------------------ |
| scope      | string | data source to search against  |
|            |        | (audits, users, reports, etc.) |
| placeholder| string | input placeholder text         |

Scoped search input. Submitting navigates to the
search results page for the given scope with the
query pre-filled.

### reports-list

| Field    | Type   | Description                      |
| -------- | ------ | -------------------------------- |
| folderId | string | which ReportFolder to list       |
|          |        | (optional, null = all reports)   |
| limit    | number | max reports to show (default 10) |

Shows a compact list of saved reports. Clicking
a report navigates to the full report view.

### embed

| Field  | Type   | Description                        |
| ------ | ------ | ---------------------------------- |
| src    | string | URL to embed in an iframe          |
| height | number | iframe height in pixels            |

Embeds external content. The iframe is sandboxed
(no scripts, no same-origin access). Admins
control which domains are allowed via a CSP
allowlist -- this is a platform-level setting,
not per-widget.

---

## 5. Adding Widgets

Users add widgets through a widget picker in the
dashboard editor. The picker shows all available
WidgetTypes (built-in + marketplace-installed).
Selecting a type creates a new WidgetSlot with
default config, placed at the bottom of the first
column.

The user then configures the widget inline: sets
the title, adjusts the config fields, and
drag-drops it to the desired position.

---

## 6. Widget Data Scoping

Widgets that reference data (report, search,
reports-list) are scoped to the viewer's
permissions. A widget never shows data the user
is not allowed to see.

If a shared dashboard contains a report widget
referencing data outside the viewer's scope, that
widget renders with a "no access" indicator. The
rest of the dashboard renders normally.
