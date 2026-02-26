# QuickBase Webhooks - Feature Study

Source: MRG CRM > Master Reservations > Settings > Webhooks

---

## Overview

Webhooks in QuickBase are table-level automations that fire HTTP requests to external endpoints when records in that table are created, modified, or deleted. They follow a **When → AND (field filter) → AND (condition filter) → Then (HTTP action)** pattern.

---

## List View

- Shows all webhooks for a table in a grid: **Name**, **Details** (trigger summary), **Owner**, **Active** status
- Bulk actions: Activate, Deactivate, Delete (via checkbox selection)
- Per-row actions: Copy webhook, Delete webhook, Toggle active/inactive
- Search bar to filter webhooks by name
- "View error history" link for debugging failed deliveries
- "New Webhook" button to create

---

## Webhook Configuration (Edit View)

### 1. Identity

| Field       | Type     | Notes                              |
|-------------|----------|------------------------------------|
| Name        | text     | Display name for the webhook       |
| Description | text     | Freeform description of what it does |

### 2. Trigger Event ("When")

A single dropdown scoped to the current table. Options:

| Option                         | Fires on                    |
|--------------------------------|-----------------------------|
| modified                       | Record update only           |
| added                          | Record create only           |
| deleted                        | Record delete only           |
| modified or added              | Update or create             |
| modified or deleted            | Update or delete             |
| added or deleted               | Create or delete             |
| modified, added or deleted     | Any change                   |

Key detail: the trigger is always scoped to a **single table**. You pick which table when you navigate to its settings.

### 3. Field Change Filter ("AND when")

Narrows the trigger to specific field changes. Two modes:

- **Any field changes** -- fires on any modification to the record
- **Any of the following fields change** -- presents checkboxes for every field in the table. Only fires if at least one of the checked fields was part of the change.

This is useful for targeting specific data changes (e.g., only fire when "Email Address" changes, not when "Notes" changes).

### 4. Condition Filter ("AND after the change")

A condition builder that evaluates the record's state **after** the change. Only fires the webhook if all/any conditions pass.

**Conjunction:** `all` (AND) or `any` (OR) of the conditions must be true.

**Each condition has:**

| Part          | Description                                                |
|---------------|------------------------------------------------------------|
| Field         | Dropdown of all table fields                               |
| Operator      | Comparison operator (see below)                            |
| Value source  | "the value" (literal) or "the value in the field" (another field reference) |
| Value         | The literal value or field to compare against              |

**Available operators:**

- String: `contains`, `does not contain`, `is equal to`, `is not equal to`, `starts with`, `does not start with`, `wildcard match`, `does not wildcard match`
- Date: `is after`, `is on or after`, `is before`, `is on or before`
- Numeric: `is less than`, `is less than or equal`, `is greater than`, `is greater than or equal`

Conditions can be chained with `and` (additional rows added to the condition group).

### 5. HTTP Action ("Then")

The actual request configuration:

| Field          | Type      | Options / Notes                                              |
|----------------|-----------|--------------------------------------------------------------|
| Endpoint URL   | text      | Full URL to POST/GET/etc to                                  |
| HTTP method    | dropdown  | `POST`, `GET`, `PUT`, `PATCH`, `DELETE`                      |
| Message format | dropdown  | `XML`, `JSON`, `RAW`                                         |
| Message header | key-value | Multiple header pairs, add/remove rows                       |
| Message body   | text      | Freeform body with **field token interpolation**              |

**Field token interpolation:** The message body supports `[Field Name]` tokens that get replaced with the record's actual values at fire time. Example:
```json
{"DBID":"[Reservation ID#]","emailToVerify":"[Email Address]"}
```

### 6. Owner

- Dropdown of app users
- The webhook executes with the **owner's permissions** to determine access to QuickBase data
- Any admin can edit or copy webhooks (credentials visible to all admins)

---

## Observed Real Webhooks (5 total on Master Reservations)

| Name                                  | Trigger              | Field Filter         | Endpoint                                    |
|---------------------------------------|----------------------|----------------------|---------------------------------------------|
| Email Modification - send to Kickbox 2| modified or added    | Email Address        | Cloud Function (verifyEmailForCRM)           |
| Phone Updates                         | modified             | (specific fields)    | (external endpoint)                          |
| Magical Mike                          | modified, added, deleted | (specific fields) | (external endpoint)                          |
| Trust Pilot 2                         | added                | (none specified)     | (external endpoint)                          |
| Phone Updates copy                    | modified             | (specific fields)    | (external endpoint)                          |

---

## Key Takeaways for Auto-Bot

1. **Table-scoped**: Each webhook belongs to one table/entity type. In our case, this maps to audit configs or specific entity types.
2. **Trigger + Filter + Condition = When**: Three layers of filtering before the action fires. The trigger is the event type, the field filter narrows to specific field changes, and the condition filter checks post-change state.
3. **Field token interpolation in body**: The message body is a template with `[Field Name]` placeholders. This is powerful for constructing payloads from record data.
4. **Owner-based permissions**: Webhook runs as a specific user. Important for data access scoping.
5. **Error history**: Built-in error tracking for failed webhook deliveries.
6. **Active/Inactive toggle**: Webhooks can be deactivated without deleting them.
7. **Copy support**: Quick duplication of webhook configs.
8. **Condition builder operators are rich**: Supports string, date, and numeric comparisons plus wildcard matching and cross-field comparisons ("the value in the field").
