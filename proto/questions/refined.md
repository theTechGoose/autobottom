# Expression Builder -- UX Design

## Entering conditions

One input path handles everything. No mode switching, no separate buttons for types:

| User writes                            | System creates     |
| -------------------------------------- | ------------------ |
| "Was the greeting used?"               | boolean check      |
| "How many holds? no more than 2"       | number check, <= 2 |
| "The agent wasn't rude"                | negated boolean    |
| "Only for sales department"            | scope filter       |
| "Either X or Y"                        | OR group           |
| "Greeting was used and hold count < 3" | two AND'd checks   |

The system shows its parse in real-time as the user types, before they commit.

**Ambiguity:** if the parse is uncertain, the user must choose between interpretations
before committing. The system never guesses silently.

**Unintelligible input:** rejected with a rephrase prompt. Can't commit what the system
doesn't understand.

---

## Expressions

When structured data is available, conditions can use expressions instead of AI evaluation.
This trades LLM interpretation for deterministic comparison -- higher accuracy, zero cost.

**How it works.** Each question declares named fields it depends on (e.g., `maritalStatus`,
`holdCount`). When a user writes a condition in `field operator value` or `value operator field`
form, the system recognizes it as an expression. The user provides a name and description; at
runtime the LLM extracts the variable from the transcript and the expression evaluates
deterministically.

**Example:** A record says `maritalStatus: "married"`. The condition
`"caller's marital status equals married"` becomes the expression
`extractedMaritalStatus == recordMaritalStatus` -- the LLM only extracts, it doesn't judge.

**Operators:** `==`, `!=`, `>`, `<`, `>=`, `<=`, `includes`, `not includes`, and chainable
combinations (`&&`, `||`). Operand order is interchangeable --
`field operator value` and `value operator field` are both valid.

**Detection.** The parser identifies expressions by the presence of a declared field name
paired with a recognized operator. If the input looks like an expression but references an
undeclared field, the system prompts the user to declare it or rephrase as a boolean check.

## Structure rules

- **AND** is implicit. Conditions stack.
- **OR** is explicit. Created from "either...or..." language, or by grouping conditions.
  Group headers toggle between OR and AND.
- **NOT** preserves the user's phrasing. System detects negation internally.
- **Field checks** are scope filters ("when department is sales"), not pass/fail items.
  Multiple filters AND together.
- **Nesting** caps at one level deep. Deeper nesting is refused -- it signals a question
  design problem.

---

## Editing

- Conditions can be edited inline (full re-parse on confirm), reordered, deleted, grouped,
  and ungrouped.
- Every mutation is undoable.
- Deleting the last child of an OR group dissolves the group.
- **Structure guard:** if an edit makes a condition incompatible with its position (e.g.,
  turning an OR child into a scope filter), the system warns before committing.

---

## Inspection

Each condition has a hidden "understanding" the user can inspect on demand: type, negation,
evaluation text, and strategy (instant vs AI). All overridable. Defaults work -- inspection
is for trust-building, not configuration.

---

## testing

the user can save transcript fragments as test cases. the user can then set an expected outcome. the entire test suite can then be rerun and show which ones passed and which ones failed

**Live-test mode.** As the user edits a condition, saved test cases re-run automatically.
Debounce is strategy-dependent: expression and keyword conditions debounce at 250ms (cheap,
near-instant). AI conditions debounce at a user-configurable interval (default longer) since
each invocation costs money. Results update inline so the user sees the effect of their edit
without manually triggering a run.

**Compound question debugging.** When a condition contains multiple fragments
(e.g., `<fragment1> and <fragment2>`), test results break down per-fragment. Each fragment shows
a pass/fail indicator so the user can see exactly which piece is broken and focus their edits
there. The user can zoom into a single fragment to inspect its evaluation in isolation.

---

## Completeness signal

Conditions are auto-categorized (Opening, Process, Compliance, etc.). The system nudges
about uncovered categories and catches contradictions (opposite negations, conflicting
ranges, near-duplicates).

## Cost transparency

Each condition is labeled Instant or AI with plain-language explanations. A scorecard-level
summary shows the split and estimated per-call cost. Actuals replace estimates after a
test run.

---

## Condition versioning

Every edit saves the previous version automatically. Any version can be restored. Combined
with test cases: write v1, test, refine to v2, and if v3 regresses, restore v2.

## Question lifecycle

Three states: **Draft**, **Active** (prod), **Archived**.

A question has one active version and zero or more drafts:

```
activeVersion: "v3"
drafts: ["v4-experiment", "v4-shorter", "v5-rewrite"]
history: ["v1", "v2", "v3"]
```

**Editing flow.** The user opens an active question and starts editing. The moment they change
anything, the app forks a new draft automatically -- the active version is never mutated
directly. The user works on the draft, tests it, and when satisfied, promotes it to active.
Promotion snapshots the draft as the new active version and pushes the previous active version
into history.

Multiple drafts can exist simultaneously. They are independent experiments -- the user
explicitly chooses which one to promote. No automatic merging, no conflicts.

**Shadow mode.** A draft can be activated in shadow mode: it evaluates silently alongside the
current active version without affecting scores. Useful for validating changes on live traffic
before committing.

**Archival.** Deactivated questions move to Archived. Restorable.

**Export/import.** Questions export as JSON (version, conditions, test cases). Import creates
a new draft.

## Persistence

No save button. Everything auto-saves.

**Local layer.** Every edit writes to localStorage immediately (debounced at ~1s). This gives
instant undo/redo that survives page refreshes and browser crashes. Undo history is
question-scoped.

**Server layer.** When the local state diverges from the last-known server state, the app
syncs to the server. The server is the source of truth; localStorage is a fast local cache
and crash-recovery buffer.

**Undo history durability.** Undo history is persisted to the server alongside the draft, not
just kept in localStorage. If the user closes the browser, switches machines, or clears local
storage, the undo history is restored from the server on next load. localStorage is checked
first for speed; server is the fallback.

**Recovery on load.** When the question editor opens, the app checks localStorage for unsaved
changes. If found (e.g., the previous session crashed before syncing), it reconciles with the
server version and prompts the user to keep or discard the local changes.

**Navigation guard.** If auto-save to the server has failed and the user tries to navigate
away, a warning appears.

## Locks

Questions support one active editor at a time. The lock is scoped to the question, not to a
pair of users -- if three people try to edit, all three join the same coordination space.

**Lock key:** `locks:<questionId>`. Stores the current holder and a list of waiting users.

**Contention flow.** When a user opens a locked question, a chat dialog opens between them
and anyone else on that lock (holder + other waiters). Simple real-time chat scoped to the
lock -- no channels, no threads, just messages. Users coordinate who should be editing.

**Kick option.** A waiting user can request control. The current holder gets a 30-second
countdown to respond. If they don't, the lock transfers automatically. This handles the
walked-away-from-desk case without requiring a TTL that could interrupt active work.

---

## Open questions

1. **Subset scoping.** Can field filters scope a subset of conditions? Start global-only,
   observe need.
2. **Autocomplete.** Should the input suggest completions from transcripts and patterns?
   Needs prototyping.
3. **Conditional dependencies.** "Only check upsell if call > 3 minutes." New concept --
   needs exploration.
