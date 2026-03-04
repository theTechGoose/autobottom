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

```REDO_THIS:
- **expression supoprt**: each question defines a set of fields it depends on as just names. when the user types a question in the format of field operator value or value operator field it then makes it an expresion. this means that the user must add a name and a description. the llm then extracts the variable from the text at runtime and runs the expression.

love the idea basically we are increasing the accuracy of the llm by breaking down operations for categories where we have information. for example maritalStatus: 'married' we know this
in the question we just need to extract maritalStatus as a variable and compare recordMaritalStatus equals callMaritalStatus

we can have many operators not just the standard > < !, chains and even array operators such as includes etc... the order of the variableExtraction operator value should be interchangeable so value operator variableExtraction should also be valid.
```

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

```REDO_THIS:

**Live-Test mode ** as you edit the question the question is ran with the test case. debounced at a configurable time to debounce to save costs. only apply the debounce to questions where an llm is involved. if its anything else where the cost is small just run it at a 250ms debounce.
```

```REDO_THIS:
**Compound Question** allow a user to zoom into a fragment of a compount question example <fragment1> and <fragment2> and see where it is failing. this way the user knows where they need to make their edits


questions are divided in the test and an indicator shows which ones failed and which ones did not that way you can see which fragment is broken and gear your edits towards that.

```

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

```REDO_THIS:
## Question lifecycle

**Draft** -> **Active** -> **Archived**. Active questions are locked;
clone version to draft to change. Activation snapshots the version. Shadow mode available for
silent evaluation before going live. Export/import as JSON.
so you have the following flow
prodVersion: xyz
drafts: [
xyz,
bbx,
bbc
etc..
]
history: [
...

]

the one that gets promoted is the one that the user selects to be promoted. drafts are just that. drafts.

here is what we do:
user is on a question designated as prod. says damn. this question sucks starts editing the question. under the hood the app creates a new version and saves it as a draft. user can then
promote this version to prod.

if you need more clariication ask. this is very important
```

```REDO_THIS:
## Persistence

Auto-save, save version to ui every second, in local storage. if change is detected then save in server. if history saved in ui with server fallback. if user navigates away from the question page, the app will check for unsaved history on load meaning that ANYWHERE in the app. (server + local fallback). No save button. Navigation guard if auto-save failed.
question-scoped undo/redo.

i dont want a landmine but i do want the app so have a robust undo system that even if the user gets off of this computer and goes somewhere else the undo history is still available. and that if they close out the browser the undo history is still available and saved next time the app sees it. make sense?
```

```REDO_THIS:

## Locks

add an option to kick the current user after a 30 second delay.
yep the lock scoped to questionid means that there could be 3 users talking instead of 2. thats good

Support multiple editors however questions are locked.
if a user tries to open a locked question it opens a chat dialog between them. so they can coordinate. nothing fancy just simple db scoped as locks:<questionId>:<userId1>:<userId2> this way the comunication is really fucking simple.
```

---

## Open questions

1. **Subset scoping.** Can field filters scope a subset of conditions? Start global-only,
   observe need.
2. **Autocomplete.** Should the input suggest completions from transcripts and patterns?
   Needs prototyping.
3. **Conditional dependencies.** "Only check upsell if call > 3 minutes." New concept --
   needs exploration.
