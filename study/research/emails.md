# QuickBase Email Notifications - Feature Study

Source: MRG CRM > Master Reservations > Settings > Notifications, subscriptions & reminders

---

## Overview

Email notifications in QuickBase are table-level automations that send emails when records are created, modified, or deleted. They share the same trigger/filter model as webhooks but instead of firing an HTTP request, they compose and send an email. The feature is called "Notifications, subscriptions & reminders" in the UI.

---

## List View

- Grid columns: **Name**, **Details** (trigger summary), **Type** (Notification), **Owner**, **To**, **Owner=To**, **Active**
- 33 email notifications on this table
- "Show" filter dropdown: "All Emails" (likely can filter by type)
- Bulk actions: Activate, Deactivate, Change Owner, Delete
- Per-row: Active toggle, Delete button
- Search bar to filter by name
- "+ New Email" button to create

---

## Email Notification Configuration (Edit View)

### 1. Permission Type

Displayed at the top. Value: "Open" with a warning: "Some restricted fields will be mailed out."

### 2. Identity

| Field             | Type     | Notes                              |
|-------------------|----------|------------------------------------|
| Notification name | text     | Display name                       |

### 3. Notify Whom (Recipients)

A dropdown with three categories of recipient options:

**Category 1: Static email list**
- "A specific list of email addresses..." -- followed by a textarea for entering emails

**Category 2: Conditional per-user**
- `user@domain.com when user@domain.com is listed in the field: [Field Name]`
- Only sends to that user when their email appears in the specified field on the record
- This is per-app-user, so every user with access appears as an option

**Category 3: Dynamic from field**
- `The email address listed in the field: [Field Name]`
- Sends to whatever email address is in the specified field of the record being changed
- Only email-type fields appear as options (e.g., "Email Address", "Email Address Formula", "trimmed email")

### 4. Trigger Event ("Notification when")

Same dropdown as webhooks:

| Option                         | Fires on                    |
|--------------------------------|-----------------------------|
| modified                       | Record update only           |
| added                          | Record create only           |
| deleted                        | Record delete only           |
| modified or added              | Update or create             |
| modified or deleted            | Update or delete             |
| added or deleted               | Create or delete             |
| modified, added or deleted     | Any change                   |

### 5. Field Change Filter ("AND when")

Identical to webhooks:
- **Any field changes** -- fires on any modification
- **Any of the following fields change** -- checkboxes for every table field

### 6. Condition Filter ("AND after the change")

Same condition builder as webhooks with some additional date-specific features:

**Conjunction:** `all` (AND) or `any` (OR)

**Operators (string):** contains, does not contain, is equal to, is not equal to, starts with, does not start with, wildcard match, does not wildcard match

**Operators (date):** is after, is on or after, is before, is on or before

**Operators (numeric):** is less than, is less than or equal, is greater than, is greater than or equal

**Operators (checkbox):** is equal to / is not equal to (with checked/unchecked values)

**Value sources:**
- "the value" (literal)
- "the value in the field" (cross-field comparison)

**Relative date values** (additional to webhooks):
- "the date" (absolute date picker)
- "day(s) in the past", "yesterday", "today", "tomorrow", "day(s) from now"
- Relative periods: "the previous / the current / the next" + "day / week / month / quarter / fiscal quarter"

### 7. Email Contents

**Message type** dropdown:
- **Default** -- uses a system-generated layout showing the record's fields
- **Custom message** -- fully custom HTML email

**Tabs:**
- **Single record version** -- template used when one record triggers the notification
- **Multiple record version** -- template used when bulk operations (e.g., import) trigger the notification for many records at once

**Subject:**
- Text field with field token interpolation via a dropdown that lists every table field
- Tokens inserted as `[Field Name]` and resolve to record values at send time

**Custom message body:**
- Rich text editor (WYSIWYG) with full formatting toolbar:
  - Format, Font, Size dropdowns
  - Bold, Italic, Underline, Strikethrough, Text transform
  - Text color, Background color
  - Lists (ordered, unordered), Indentation
  - Alignment (left, center, right, justify)
  - Links, Images, Tables, Emoji, Special characters, Code view
  - "Source" button to edit raw HTML
- Supports field token interpolation in the body, same `[Field Name]` syntax
- "Tips on creating a custom email message" help link

**Add template:**
- Dropdown: "Basic template", "Action link example"
- "Insert" button to populate the editor with a starter template

**Data form:**
- "Form to use when including a copy of Reservation:" -- dropdown of available forms
- When the email includes a record copy, this controls which form layout is used

**Message format:**
- HTML (radio, default)
- Plain text only (radio)

**Custom message options:**
- "When a field is blank, insert the word 'empty':" -- Yes (default) / No

### 8. Advanced Options

**Operations:**
- Only when single records change (e.g., Add, Edit)
- Only when multiple records change (e.g., Import)
- For either type of change (default)

**From address:**
- notify@quickbase.com (default system sender)
- The application manager (currently: manager's email)
- There is also a `fromUserInFieldSel` dropdown to select a user field on the record (e.g., "Last Modified By", "Reservation Owner") -- the from address dynamically comes from that field's value

### 9. Owner

- Shows the current owner with a "(Change)" link
- Transfer ownership dropdown lists all app users
- The notification executes with the owner's permissions for data access

---

## Key Differences from Webhooks

| Aspect              | Webhooks                          | Email Notifications                     |
|---------------------|-----------------------------------|-----------------------------------------|
| Action              | HTTP request to endpoint          | Send email                              |
| Recipient           | Endpoint URL (single)             | Multiple recipient modes (static, conditional, dynamic from field) |
| Body                | Plain text with field tokens      | Rich HTML editor with full formatting + field tokens |
| Templates           | None                              | Single record + Multiple record versions, starter templates |
| Format              | JSON / XML / RAW                  | HTML / Plain text                       |
| Bulk handling       | N/A                               | Single vs Multiple record differentiation |
| From address        | N/A                               | System, app manager, or dynamic from field |
| Relative dates      | Not observed                      | Full relative date conditions (yesterday, today, previous week, etc.) |

---

## Key Takeaways for Auto-Bot

1. **Three recipient modes**: Static list, conditional per-user (send only if user's email is in a field), and dynamic from-field. The conditional mode is particularly interesting -- it allows "send to the manager of this record" type logic.

2. **Single vs Multiple record templates**: When a bulk operation triggers many notifications, there's a separate template that aggregates multiple records into one email instead of spamming individual emails. Important for batch audit operations.

3. **Rich HTML email builder**: Full WYSIWYG editor with source mode for power users. Field tokens (`[Field Name]`) resolve to record values at send time. Starter templates available.

4. **Relative date conditions**: The condition builder has rich relative date support (yesterday, today, previous/current/next week/month/quarter) that webhooks don't seem to expose as prominently. Useful for time-based notification rules like "only notify when Date Created is not today" (deduplicate).

5. **From address flexibility**: Can be a system address, the app manager, or dynamically pulled from a user field on the record. Enables "from: your manager" type personalization.

6. **Operations filter**: Can restrict to single-record changes only (manual edits) or bulk changes only (imports), or both. Prevents notification spam during bulk imports.

7. **Blank field handling**: Option to insert "empty" when a field token resolves to blank, or leave it out entirely. Small but important UX detail for email readability.

8. **Preview button**: The edit page has a Preview button to see the rendered email before saving. Essential for testing custom HTML templates.

9. **Shared trigger model**: The When + AND when (field filter) + AND after the change (condition filter) pattern is identical to webhooks. This suggests a shared "automation trigger" abstraction that both features build on.

---

## Auto-Bot Requirements (beyond QuickBase)

These are features we want that QuickBase does not have.

### Scheduled Sending (Cadence)

Emails are not only event-triggered -- they can also be scheduled:

| Cadence  | Config needed              | Notes                          |
|----------|----------------------------|--------------------------------|
| Daily    | time (HH:MM)              | Fires every day at that time   |
| Weekly   | day of week + time         | Fires on that day each week    |
| Monthly  | day of month + time        | Fires on that day each month   |
| Yearly   | month + time               | Always fires on the 1st of that month |

### Report Embedding

The email body can inline a Report from the app's report builder. This means a scheduled email can contain a rendered report (table, chart, summary, etc.) directly in the message body. The report is evaluated at send time with current data.

### Interpolation System

The email body (subject and message) supports an interpolation system for dynamic content:

**Field tokens:** `[Field Name]` -- resolves to a value from the current context (record, audit, user, etc.)

**LLM function:** `llm(prompt, ...context)` -- calls the LLM at send time with the given prompt and context values, interpolates the generated text into the email. Examples:
- `llm("summarize this agent's performance this week", [Agent Name], [Weekly Score], [Failed Questions])`
- `llm("write a coaching tip for improving on", [Weakest Category])`

This enables AI-generated personalized content in scheduled emails -- summaries, coaching tips, trend analysis -- without manual authoring.

### Open Questions

- What context is available to interpolation? Just audit fields, or also computed values like scores, averages, streaks?
- Should `llm()` results be cached or regenerated every send?
- Can a single email combine both a custom message body AND an inlined report, or is it one or the other?
- How do we handle `llm()` failures at send time -- skip the section, insert a fallback, or fail the send?
