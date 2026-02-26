# Dashboards & Navigation

---

## Sidebar `computed`

The sidebar is a thin glowing accent line (3-4px) on the left edge. On hover it
expands to show role-driven tabs.

| Field | Description |
| ----- | ----------- |
| `collapsed` | thin glowing accent line (3-4px) |
| `expanded` | slides out on hover, shows role tabs |
| `tabs` | Dashboard (always) + capability-driven tabs |

---

## DashboardPage `stored`

Per user per role, shareable (copy-on-write from defaults).

| Field | Description |
| ----- | ----------- |
| `ownerId` | null = system default, string = user-created |
| `role` | which role's home tab |
| `name` | user-given name |
| `widgets[]` | WidgetSlot (embedded) |
| `sharedWith[]` | emails (works if recipient has permissions) |

---

## WidgetSlot `embedded`

| Field | Description |
| ----- | ----------- |
| `id` | unique within the dashboard |
| `type` | one of WidgetType names |
| `title` | display label |
| `column` | grid column |
| `order` | sort position |
| `span` | columns wide |
| `config` | WidgetConfig (embedded) |

---

## WidgetType `enum`

```
report | text | button-bar | link-bar | search | reports-list | embed
```
