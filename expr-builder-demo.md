# QEL Expression Builder -- Implementation Log

## What Was Built

A complete rewrite of `expr-builder-demo.html` from a V1 flat OR-of-ANDs
`+:` / `&|!` syntax to a V2 natural language question builder where
non-technical managers type plain English and the system auto-detects
everything.

Backend: `serve.ts` -- Deno server on port 8787 that serves static files
and provides `/classify` and (planned) `/compile` endpoints via direct
Anthropic API calls to Haiku.

## Architecture

### Unified Atom Model

Two atom kinds: `ask` (LLM evaluates against transcript) and `field`
(pre-known value from audit record).

```
AskAtom
  displayText    what the user typed (shown in UI)
  promptText     rewritten for LLM (negation stripped)
  returnType     boolean | number | string (auto-detected)
  negated        bool (auto-detected from phrasing)
  cmp?           comparator (only when returnType != boolean)
  value?         comparison target (only when cmp present)
  rawInput       original text for dissolve round-trip

FieldAtom
  key            FieldDef.key (the {{variable}} name)
  cmp            comparator (always present)
  value          comparison target
  negated        bool
```

Comparators: `= != > >= < <= contains startsWith`

NL aliases: `is`, `is not`, `at least`, `at most`, `more than`,
`less than`, `starts with`

### Expression AST

Recursive tree replacing V1's flat OR-of-ANDs.

```
ExprNode = AskNode | FieldNode | AndNode | OrNode

AskNode    { op: "ask", displayText, promptText, returnType, cmp?, value?, negated? }
FieldNode  { op: "field", key, cmp, value, negated? }
AndNode    { op: "and", exprs: ExprNode[] }
OrNode     { op: "or", exprs: ExprNode[] }
```

Precedence: parentheses > AND > OR. Parsed by recursive descent
(`pOr -> pAnd -> pAtom`).

### Evaluation Pipeline

Field-first short-circuit: within AND/OR nodes, evaluate free nodes
(fields) first. If short-circuit triggers, skip costly LLM ask nodes.

Eval trace stored as recursive tree with result, rawAnswer, skipped flags.

---

## NL Detection Engine

All detection runs at commit time (Enter key).

### Return Type Detection

Two-phase: heuristic narrows as far as possible, defers to Haiku for
genuinely ambiguous cases.

`detectReturnType(text)` returns `{ type, confident, candidates? }`.

| Priority | Pattern | Result |
|----------|---------|--------|
| 1 | `NUMBER_STARTERS` (how many/much/long/often, what number/score, rate, scale) | CERTAIN('number') |
| 2 | `BOOLEAN_STARTERS` (was/were/is/are/did/does/do/has/have/had/can/could/will/would/should) | checks sub-patterns below |
| 2a | + `CHOICE_TAIL` (X or Y? at end, Y != "not", up to 3 words per side) | CERTAIN('string') |
| 2b | + `POLITE_STRING_RE` (can/could you describe/explain/tell/list/...) | CERTAIN('string') |
| 2c | + `POLITE_BOOL_RE` (can/could you confirm/verify/check/...) | CERTAIN('boolean') |
| 2d | + `POLITE_ANY_RE` (can/could you + any verb) | AMBIGUOUS('string', ['string','boolean']) |
| 2e | + `OR_PRESENT` (or + word, not "or not") | AMBIGUOUS('boolean', ['boolean','string']) |
| 2f | + none of above | CERTAIN('boolean') |
| 3 | `STRING_STARTERS` (what/which/who/where/when/describe/list/name/identify) | CERTAIN('string') |
| 4 | no match | AMBIGUOUS('boolean', ['boolean','string']) |

When AMBIGUOUS, chip enters pending state with pulsing purple border.
`requestLLMResolve` fires `POST /classify` to Haiku. On response,
`resolvePendingChip` updates type, re-renders, flashes.

### Negation Detection

Patterns (word-boundary, apostrophe-tolerant):

- **Contractions**: wasn't/weren't/isn't/aren't/didn't/doesn't/don't/
  hasn't/haven't/hadn't/can't/couldn't/won't/wouldn't/shouldn't/cannot
- **Words**: not, never, without, none, neither, nothing, nobody, nowhere
- **Phrases**: fail(s/ed) to, no one

"or not" is explicitly excluded (protected with placeholder in rewrite).

Double negation: odd count = negated, even = affirmative.
`!` prefix is power-user override, counts as +1.

### Negation Rewrite Engine (`rewritePrompt`)

Produces clean `promptText` for the LLM:

1. Protect "or not" with null-byte placeholder
2. Contractions -> affirmative (wasn't->was, cannot->can, won't->will)
3. fail(s/ed) to -> removed
4. no one -> anyone
5. without -> with
6. nothing->anything, nobody->anybody, nowhere->anywhere
7. Standalone words removed (not, never, none, neither)
8. Restore "or not" placeholder
9. Clean whitespace

### `?` Delimiter

For typed asks, `?` separates question from comparator:
```
How many holds? <= 2         -> number ask, cmp: <=, value: 2
What greeting? contains hello -> string ask, cmp: contains
Was greeting used?           -> boolean ask, no comparator
```

### Smart Quote Normalization

`normQuotes()` at start of `parseRaw` converts smart quotes
(\u2018, \u2019, \u201A, \u201B, \u2032) to regular apostrophe.
Fixes preset data with curly quotes not matching regex patterns.

---

## Chip Input UX

### Commit triggers
- **Enter**: commits current text as chip
- **Space** after AND/OR: auto-commits operator
- **( / )**: auto-commits on type
- **Click chip**: dissolves to editable text in place
- **Backspace at boundary**: dissolves previous chip, eats one char
  BEFORE the `?` (keeps `?` anchored at end, cursor placed before it)

### Chip rendering

| Chip | Color | Display |
|------|-------|---------|
| Boolean ask | blue | `y/n "Was greeting used?"` |
| Negated ask | blue + red NOT badge | `NOT y/n "Was the agent rude?"` |
| Typed ask (num/str) | blue | `num How many holds? <= 2` |
| Pending ask | blue + pulse border | `... "Can you handle it?"` |
| Field | amber | `department is sales` |
| AND | indigo | `AND` |
| OR | green | `OR` |
| ( ) | gray | `(` `)` |

The `?` in chip display is rendered separately from `displayText` so
it's always visible next to the closing smart quote, not hidden by it.
If `displayText` has no `?`, none is shown.

### Detection feedback
- Tooltip on commit: shows detected type, negation, prompt rewrite
- Fades after 1.5s (3s for pending chips)
- Detection detail section below editor shows per-chip breakdown

### Validation warnings
Red text below editor for:
- Missing comparator on typed ask ("This expects a text answer. Add a comparator after ?")
- Unknown field key

---

## serve.ts Backend

```
Port: 8787
Static: serves files from cwd, / -> /expr-builder-demo.html
```

### POST /classify
- Input: `{ question: string, candidates: string[] }`
- Calls Anthropic API directly (no CLI shell-out)
- Model: `claude-haiku-4-5-20251001`, max_tokens: 4
- Returns: `{ type: string }` (one of the candidates)
- ~100ms avg response time

Key: reads `ANTHROPIC_API_KEY` from env. Stored in user's
`~/Documents/programming/new-dot-files/apps/zsh/conf.d/99-secrets.zsh`.

### Why not `claude` CLI?
Shelling out to `claude --model haiku -p` was the first approach but:
1. ~5.2s avg due to Node.js CLI boot overhead
2. Doesn't work inside Claude Code sessions (nesting detection)
Direct API call: ~155ms avg (33x speedup).

---

## Presets

Six presets in the `presets` object:

- `bool`: Simple boolean ask
- `negated`: AND with natural negation ("Wasn't")
- `strask`: String ask with "contains" comparator
- `numask`: Number ask with "<=" comparator
- `field`: Field variable with OR
- `mixed`: Full expression with field + parens + AND/OR + negated ask

All use regular apostrophes (not smart quotes) and include
`rawInput` for dissolve round-trips.

---

## Edge Cases Discovered and Fixed

### Choice detection
"Do you want chicken or pizza?" -- starts with "do" (boolean starter)
but is actually a choice question. Fixed with `CHOICE_TAIL` regex that
detects `X or Y?` at end (up to 3 words per side), excluding "or not".

### Polite requests
"Can you describe..." -- starts with "can" (boolean) but intent is
string. Added `POLITE_STRING_RE` for describe/explain/tell/list/etc.
and `POLITE_BOOL_RE` for confirm/verify/check. Generic `POLITE_ANY_RE`
goes to AMBIGUOUS -> Haiku tiebreak.

### "or not" idiom
"Did they resolve it or not?" -- "not" was detected as negation,
"or" triggered choice detection. Fixed by:
1. Excluding "or not" from negation counting
2. `CHOICE_TAIL` has `(?!not\b)` lookahead
3. `rewritePrompt` protects "or not" with placeholder during rewrite

### Negative pronouns
nothing, nobody, nowhere, "no one" -- added to negation detection
and rewrite engine (nothing->anything, nobody->anybody, etc.)

### "cannot"
Missing from contraction patterns. Added to `CONTRACTION_RE` and
`CONTRACTION_MAP` (cannot->can).

### Multi-word choice options
"credit card or bank transfer?" -- original `CHOICE_TAIL` only
allowed single words. Extended to `(?:\w+\s+){0,2}\w+` per side.

### Smart quotes in presets
Presets used \u2019 (right single quotation mark) in "Wasn't" which
didn't match regex `'?`. Fixed with `normQuotes()` at parseRaw start.

### Backspace dissolve eating `?`
Old `dissolveBack` did `raw.slice(0, -1)` which ate the `?`.
Fixed: `raw.endsWith('?') ? raw.slice(0, -2) + '?' : raw.slice(0, -1)`
with cursor placed at `length - 1` (before the `?`).

### `?` display in chips
`chipInner` wraps displayText in smart quotes: `\u201C...\u201D`.
The `?` was invisible next to the closing `\u201D`. Fixed by
extracting `?` and rendering it separately outside the escaped text.

---

## Pending Feature: Expression Compiler

### The Idea

`?` becomes a meaningful syntactic marker:
- **With `?`** -> ask chip (blue) -- LLM evaluates at runtime
- **Without `?`** -> expr chip (yellow) -- compiled at BUILD TIME

Compilation pipeline (3 sequential Haiku calls, ~500ms total):

```
"agent mentioned promotion"
        |
        v  Step 1: Intent (100 tokens)
"Check whether the agent referenced a promotional offer"
        |
        v  Step 2: Strategy (10 tokens)
"keyword_any"
        |
        v  Step 3: Compile (200 tokens)
{ strategy: "keyword_any",
  params: ["promotion", "offer", "deal", "discount", "promo"] }
```

LLM cost paid once at form-build time. At eval time, keyword/regex
runs instantly and free.

### Strategies

| Strategy | Params | Eval cost | When to use |
|----------|--------|-----------|-------------|
| keyword_any | string[] | free | loose match, any synonym |
| keyword_all | string[] | free | all concepts must appear |
| regex | string | free | pattern matching |
| llm_eval | string (prompt) | LLM call | complex reasoning needed |

### Integration points

- `parseRaw`: text without `?` -> type `expr`, pending: true
- New `/compile` endpoint on serve.ts
- `requestExprCompile` / `resolveExprChip` (parallel to ask flow)
- `evalNode`: dispatch on strategy, run against mock transcript
- `isFree`: expr with non-llm_eval strategy is free (short-circuit)
- Yellow chip styling, strategy badges, trace rendering

### Design question explored and resolved

"Should text without `?` be a different block type?"

Initial thought: expression block (yellow) vs question block (blue).
But without the compiler, there's no functional difference -- both go
to the LLM. The compiler gives `?` real semantic power: it controls
whether the check is evaluated by LLM at runtime (expensive) or
compiled to cheap matching at build time (free).

Alternative explored and rejected: using no-`?` text as regex/keyword
directly without LLM compilation. Rejected because natural language
can't be reliably converted to regex rules-based -- "agent mentioned
promotion" needs to catch "I'd like to tell you about our current
offer" which requires LLM understanding.

### Status

Plan written, not yet implemented. See plan file at
`.claude/plans/shimmying-shimmying-squid.md` for full implementation
spec with line numbers and code changes.
