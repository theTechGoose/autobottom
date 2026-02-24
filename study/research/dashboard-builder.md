# Dashboard Builder Spec

Feature spec for user-customizable dashboards and the app navigation model.

---

## 1. Navigation Model

### 1.1 Sidebar

The sidebar is the primary navigation. It uses a collapsed/expanded pattern:

**Collapsed state** (default):
- A thin vertical accent line (3-4px wide) on the left edge of the viewport
- Subtle glow effect (box-shadow with the accent color)
- Always visible, does not take layout space from the main content

**Expanded state** (on hover):
- Slides out to full width (~240px) over the main content
- Shows the user's role tabs grouped by capability
- Each tab is a clickable nav item with an icon + label
- Active tab is highlighted
- Retracts when the cursor leaves the sidebar area

```
Collapsed:        Expanded (on hover):
                  +------------------------+
|                 |  [icon] Dashboard      | <-- always first tab
|  (3px glow)     |  [icon] Review Queue   | <-- from capabilities
|                 |  [icon] Appeals        |
|                 |  [icon] Reports        |
|                 +------------------------+
```

### 1.2 Tabs

A user's role determines which **tabs** they see. Every role always has a
**Dashboard** tab as the first item. The remaining tabs come from the role's
capabilities.

Each capability maps to exactly one tab (a functional view / route):

| Capability | Tab Label | View |
|-----------|-----------|------|
| (always) | Dashboard | Customizable widget page (this spec) |
| `review-queue` | Review Queue | Pending reviews workflow |
| `appeals` | Appeals | Judge appeal queue |
| `manager-queue` | Manager Queue | Remediation workflow |
| `reports` | Reports | Report builder & saved reports |
| `team-stats` | Team Stats | Team performance metrics |
| `my-audits` | My Audits | Agent's own audit history |
| `my-stats` | My Stats | Agent's personal metrics |
| `admin-panel` | Admin | System administration |
| `team-management` | Teams | Team & user management |
| `config` | Config | Pipeline & webhook settings |

So a **judge** with capabilities `[review-queue, appeals, reports]` sees:

```
Dashboard  |  Review Queue  |  Appeals  |  Reports
```

The **Dashboard** tab is what this spec covers. The other tabs are fixed
functional views (queues, reports, config screens, etc.).

### 1.3 Role -> Tab Mapping

| Role | Tabs |
|------|------|
| `admin` | Dashboard, Admin, Teams, Config, Reports, Review Queue, Appeals, Manager Queue |
| `judge` | Dashboard, Review Queue, Appeals, Reports |
| `analyst` | Dashboard, Review Queue, Reports |
| `supervisor` | Dashboard, Manager Queue, Team Stats, Reports |
| `agent` | Dashboard, My Audits, My Stats |

---

## 2. Dashboard Tab

The **Dashboard** tab is the customizable home view. Users can place widgets
(reports, text blocks, buttons, search, etc.) in a drag-and-drop grid layout.
Each user gets one dashboard per role. The dashboard is scoped to the user's
role, not per-capability.

### 2.1 Page

```typescript
interface DashboardPage {
  id: string;
  userId: string | null;   // null = system default
  role: string;            // Which role this dashboard belongs to
  name: string;            // Display name (e.g. "My Dashboard")
  widgets: WidgetSlot[];   // Ordered list of placed widgets
  createdAt: string;
  updatedAt: string;
}
```

### 2.2 Widget Slot

A widget placed on a page. Describes **what** widget, **where** on the grid,
and **how** it is configured.

```typescript
interface WidgetSlot {
  id: string;              // Unique within the page
  type: WidgetType;
  title: string;           // User-editable header
  column: 1 | 2;          // Grid column (1 = left, 2 = right)
  order: number;           // Sort order within the column
  span: 1 | 2;            // 1 = half width, 2 = full width
  config: WidgetConfig;    // Type-specific configuration
}
```

### 2.3 Grid Layout

The dashboard uses a simple **2-column grid**:

```
+------- full width (span: 2) -------+
| Widget A                            |
+------------------+------------------+
| Widget B (col 1) | Widget C (col 2) |
+------------------+------------------+
| Widget D (col 1) | Widget E (col 2) |
+------------------+------------------+
+------- full width (span: 2) -------+
| Widget F                            |
+-------------------------------------+
```

- Widgets are placed in column 1 or column 2
- A widget with `span: 2` takes the full row
- Within a column, widgets are sorted by `order`
- Drag-and-drop reorders widgets (updates `order` and optionally `column`)

---

## 3. Widget Types

Seven widget types, adapted from QuickBase for the audit domain.

```typescript
type WidgetType =
  | "report"
  | "text"
  | "button-bar"
  | "link-bar"
  | "search"
  | "reports-list"
  | "embed";
```

### 3.1 Report (Chart or Table)

Embeds a saved report inline. Renders as a chart or data table depending on
the report's visualization type.

```typescript
interface ReportWidgetConfig {
  type: "report";
  reportId: string;        // FK -> Report.id
  height?: number;         // Override height in px (default: auto)
}
```

**QuickBase equivalent:** "Report or Chart" -- renders any saved report (table,
chart, summary, calendar) directly in the dashboard.

**Behavior:**
- Renders the report's chart or table inline
- Clicking the title navigates to the full report view
- Refreshes on page load (no live polling)

### 3.2 Text

A static rich-text block for notes, announcements, or instructions.

```typescript
interface TextWidgetConfig {
  type: "text";
  content: string;         // Markdown content
}
```

**QuickBase equivalent:** "Text" widget with WYSIWYG editor. We use markdown
instead.

### 3.3 Button Bar

A row of action buttons. Each button triggers a predefined action (navigate to
a page, start a new audit, open a form).

```typescript
interface ButtonBarWidgetConfig {
  type: "button-bar";
  buttons: DashboardButton[];
}

interface DashboardButton {
  label: string;
  action: ButtonAction;
  variant?: "primary" | "secondary" | "danger";
}

type ButtonAction =
  | { type: "navigate"; path: string }
  | { type: "create-instance"; configId: string }
  | { type: "external"; url: string };
```

**QuickBase equivalent:** "Button Bar" -- row of buttons that launch forms,
navigate, or trigger actions. QuickBase's "Create New Reservation" button is
analogous to our `create-instance` action.

### 3.4 Link Bar

A titled group of links organized under a heading. Good for navigation hubs
and quick-access collections.

```typescript
interface LinkBarWidgetConfig {
  type: "link-bar";
  links: DashboardLink[];
}

interface DashboardLink {
  label: string;
  target: LinkTarget;
}

type LinkTarget =
  | { type: "internal"; path: string }
  | { type: "report"; reportId: string }
  | { type: "external"; url: string };
```

**QuickBase equivalent:** "Link Bar" -- titled list of bullet-separated links.
QuickBase uses these for grouped navigation (e.g. "Submit an IT / CRM Ticket
Request" with 5 links underneath).

### 3.5 Search

A search widget scoped to a specific entity type. Lets the user search from
the dashboard without navigating away.

```typescript
interface SearchWidgetConfig {
  type: "search";
  entity: SearchableEntity;
  fields: SearchField[];
  exactMatch?: boolean;     // Default false
}

type SearchableEntity = "instance" | "config" | "user" | "team";

interface SearchField {
  key: string;             // Field key to search on
  label: string;           // Display label
  helpText?: string;       // Placeholder / description
}
```

**QuickBase equivalent:** "Search" widget. QuickBase allows searching a table
by specific fields (Dear, Phone Number, Email Address, Reservation ID#) with
an "exact match" checkbox. Each field has a "Click to add help text" slot.

**Behavior:**
- Renders one text input per field
- Optional "Match search term exactly" checkbox
- Submitting opens results inline or navigates to search results page

### 3.6 Reports List

Displays a list of saved reports as clickable links, filtered by folder or
tag. Replaces the need to navigate to the reports section.

```typescript
interface ReportsListWidgetConfig {
  type: "reports-list";
  folderId?: string;       // Filter to a specific folder
  tags?: string[];         // Filter by report tags
  maxItems?: number;       // Limit displayed (default: 10)
}
```

**QuickBase equivalent:** "Reports List" -- renders a list of saved reports
grouped by table. In QuickBase, this shows reports like "Koya Gun Check",
"DNCed", "MW Stats" etc. as clickable links.

### 3.7 Embed

An embedded external resource (iframe). For third-party tools, documentation,
or external dashboards.

```typescript
interface EmbedWidgetConfig {
  type: "embed";
  url: string;             // Source URL
  height: number;          // Frame height in px
  sandbox?: string;        // iframe sandbox attribute
}
```

**QuickBase equivalent:** "Web Page" widget. Embeds any URL in an iframe.

---

## 4. Widget Configuration Union

All widget configs as a discriminated union:

```typescript
type WidgetConfig =
  | ReportWidgetConfig
  | TextWidgetConfig
  | ButtonBarWidgetConfig
  | LinkBarWidgetConfig
  | SearchWidgetConfig
  | ReportsListWidgetConfig
  | EmbedWidgetConfig;
```

---

## 5. Edit Mode UX

### 5.1 Entering Edit Mode

- Dashboard tab displays an **Edit** button (pencil icon) in the top-right
- Clicking it toggles edit mode
- Edit mode shows:
  - A **Page Name** text input at the top
  - A **widget toolbar** with 7 draggable widget type buttons (icons + labels)
  - Each placed widget gains a **control overlay** with edit/delete buttons
  - **Save** and **Cancel** buttons in the header

### 5.2 Widget Toolbar

Rendered as a horizontal bar below the page name input:

```
[ Report or Chart ] [ Text ] [ Button Bar ] [ Link Bar ] [ Search ] [ Reports List ] [ Embed ]
```

Each item is draggable. Dropping a widget type onto the grid creates a new
widget with default config and opens the config dialog.

### 5.3 Per-Widget Controls

When edit mode is active, each widget shows a floating toolbar:

| Control | Icon | Action |
|---------|------|--------|
| Edit | pencil | Opens config dialog for this widget |
| Delete | trash | Removes widget (with confirmation) |
| Drag handle | grip dots | Drag to reorder or move between columns |

### 5.4 Config Dialog

Clicking edit on a widget opens a modal dialog. The dialog content depends on
the widget type:

| Widget Type | Dialog Fields |
|-------------|---------------|
| Report | Title, Report picker (dropdown of saved reports), Height |
| Text | Title, Markdown editor |
| Button Bar | Title, Button list (label + action type + target for each) |
| Link Bar | Title, Link list (label + target type + destination for each) |
| Search | Title, Entity picker, Field list builder, Exact match toggle |
| Reports List | Title, Folder picker, Tag filter, Max items |
| Embed | Title, URL input, Height, Sandbox options |

Each dialog has **Save** and **Cancel** buttons.

### 5.5 Drag and Drop

- Widgets can be dragged vertically within a column to reorder
- Widgets can be dragged between columns to change placement
- Full-width widgets (span: 2) stay in their row position
- Dropping a widget between two others inserts it at that position
- All `order` values recalculate on drop

### 5.6 Save / Cancel

- **Save**: Persists the DashboardPage to KV, returns to view mode
- **Cancel**: Discards all unsaved changes, returns to view mode

---

## 6. Default Dashboards

Each role ships with a system-default dashboard. Users start with the default
and can customize from there.

| Role | Default Widgets |
|------|-----------------|
| `admin` | System stats (report), Team overview (text), User management (link-bar) |
| `judge` | Pending reviews (report), Recent decisions (report), Quick search (search) |
| `analyst` | My queue (report), Audit stats (report), Start audit (button-bar) |
| `supervisor` | Team performance (report), Remediation queue (report), Escalations (link-bar) |
| `agent` | My audits (report), Quick actions (button-bar), Announcements (text) |

Default dashboards have `ownerId: null` and cannot be edited directly. When a
user first customizes, the system clones the default into a user-owned copy.

---

## 7. Dashboard Sharing

Dashboards can be named and shared with other users. A shared dashboard works
as long as the recipient has the **permissions** (team scope) to access the
data the widgets reference.

- The owner shares by adding emails to `sharedWith`
- Recipients see the shared dashboard in their dashboard list
- Widgets referencing data the recipient can't access render as "No access"
  placeholders (the dashboard still loads, just with gaps)
- Recipients can clone a shared dashboard to make their own editable copy

---

## 8. Data Model Integration

### 8.1 DashboardPage Entity

```typescript
interface DashboardPage {
  id: string;
  ownerId: string | null;   // null = system default
  role: string;              // Which role's dashboard tab
  name: string;              // User-given name (e.g. "My QA Overview")
  widgets: WidgetSlot[];
  sharedWith: string[];      // Emails this dashboard is shared to
  createdAt: string;
  updatedAt: string;
}
```

### 8.2 KV Keys

```
[rootTeamId, "dashboard", "default", role]     -> DashboardPage (system default per role)
[rootTeamId, "dashboard", dashboardId]          -> DashboardPage (user-created)
[rootTeamId, "dashboard-active", userId]        -> string (active dashboard ID)
[rootTeamId, "dashboard-index", userId]         -> string[] (dashboard IDs owned by or shared to user)
```

**Read path:**
1. Look up user's active dashboard ID
2. Fetch that DashboardPage
3. If none set, fall back to role default
4. If no default exists, render empty dashboard with edit prompt

### 8.3 Relationship to Other Entities

- `DashboardPage.role` matches the user's cached role string
- `DashboardPage.sharedWith` contains user emails
- `ReportWidgetConfig.reportId` references `Report.id`
- `ReportsListWidgetConfig.folderId` references `ReportFolder.id`
- `SearchWidgetConfig.entity` determines which KV namespace to query
- `ButtonAction.configId` references `AuditConfig.id`

---

## 9. Permissions

| Action | Who |
|--------|-----|
| View dashboard tab | Any authenticated user (everyone has a Dashboard tab) |
| Edit own dashboard | Any authenticated user |
| Edit system defaults | Admin only |
| Share dashboard | Owner of the dashboard |
| Clone shared dashboard | Any recipient |
| Reset to default | Any user (deletes their active override) |
| View capability tabs | Users whose role includes that capability |

---

## 10. Technical Notes

### 10.1 Widget Data is Embedded

Widget slots are stored inline on the DashboardPage document, not as separate
KV entries. This keeps reads fast (single KV get per dashboard load) and
avoids fan-out.

### 10.2 Report Widget Rendering

Report widgets call the same rendering pipeline used in the Reports tab.
The report's data source, filters, and visualization type are all owned by the
Report entity -- the widget just references it by ID and renders inline.

### 10.3 Copy-on-Write for Customization

Users never modify system defaults. On first edit:
1. Clone the default DashboardPage
2. Set `ownerId` to the current user
3. Save as a new dashboard
4. Set as the user's active dashboard
5. All subsequent edits modify the user's copy

### 10.4 No Live Collaboration

Dashboard editing is single-user. No conflict resolution needed. Last write
wins if the same user edits from two tabs.

### 10.5 Sidebar Implementation Notes

- Collapsed state uses `position: fixed` with minimal width (3-4px)
- Glow uses `box-shadow: 0 0 8px 1px var(--accent)`
- Expanded state transitions with `width` animation (~200ms ease-out)
- Expanded sidebar overlays content (no layout shift)
- Active tab matches current route
- Sidebar z-index above main content, below modals
