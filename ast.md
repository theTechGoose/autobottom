# V1 Question Parsing AST -- Complete Reference

Everything known about the compound question AST system as it exists
in the V1 codebase. This document consolidates all references from the
study directory and rough-draft codebase snapshot.

---

## 1. Purpose

The AST system parses compound questions into a boolean logic tree.
A single "question" authored in Question Lab can contain multiple
sub-questions joined by AND (`&`), OR (`|`), and NOT (`!`) operators.
The AST is evaluated after each sub-question is individually answered
by the LLM, producing a single pass/fail result for the compound
expression.

The primary use case is the `autoYesExp` field on questions: a boolean
expression that, when evaluated to true, causes the question to be
auto-answered "Yes" without sending it to the LLM. This is used for
conditional question skipping based on record field values.

---

## 2. Syntax

Source: `providers/question-expr.ts`

### Prefix

Compound questions are identified by a `+:` prefix on the question
text. Questions without this prefix are treated as simple (single)
questions.

### Operators

| Operator | Meaning | Example |
| -------- | ------- | ------- |
| `\|`     | OR      | `+:Was greeting used \| Was name mentioned` |
| `&`      | AND     | `+:Was greeting used & Was closing used` |
| `!`      | NOT     | `+:!Was the agent rude` |

### Evaluation Model: OR-of-ANDs

The AST uses a two-level structure: an array of AND-groups, OR'd
together. This is equivalent to Disjunctive Normal Form (DNF):

```
(A & B & !C) | (D & E) | (F)
```

Parsed into:

```
[
  [A, B, !C],   // AND group 1
  [D, E],       // AND group 2
  [F]           // AND group 3
]
```

The `|` operator separates AND-groups. The `&` operator joins
sub-questions within a group. The `!` operator negates an individual
sub-question (flips its answer).

---

## 3. TypeScript Interfaces

Source: `types/mod.ts` (from rough-draft-state-2.24.md)

### AST Node

```typescript
interface IQuestionAstNode {
  question: string;  // Individual sub-question text
  flip: boolean;     // Negate the answer (! operator)
}
```

### AST Results (evaluation output)

```typescript
interface IAstResults {
  ast?: IQuestionAstNode[][];       // OR-of-ANDs boolean logic tree
  raw?: Array<Array<IAnsweredQuestion>>;  // LLM answers per node
  notResults?: Array<Array<boolean>>;     // After NOT applied
  andResults?: Array<boolean>;            // Each AND-group result
  orResult?: boolean;                     // Final compound result
}
```

### Evaluation chain

```
ast          -> the parsed tree (IQuestionAstNode[][])
raw          -> each sub-question answered by LLM
notResults   -> flip applied where flip=true
andResults   -> AND reduction per group
orResult     -> OR reduction across groups (final answer)
```

---

## 4. Question Pipeline Stages

Questions evolve through three stages on the `AuditFinding` entity.
AST evaluation happens at the transition from Stage 1 to Stage 2.

### Stage 1: Seed (template)

```typescript
interface IQuestionSeed {
  header: string;       // Display label
  unpopulated: string;  // Template text with {{fieldId}} placeholders
  populated: string;    // Text with QuickBase record values filled in
  autoYesExp: string;   // Auto-yes boolean expression
}
```

Stored as `AuditFinding.unpopulatedQuestions[]`.

### Stage 2: Populated (AST evaluated)

```typescript
interface IQuestion extends IQuestionSeed {
  astResults: IAstResults;
  resolvedAst?: IQuestionAstNode[];  // Flattened nodes for LLM
  autoYesVal: boolean;               // true = skip LLM, answer "Yes"
  autoYesMsg: string;                // Reason for auto-yes
}
```

Stored as `AuditFinding.populatedQuestions[]`.

At this stage:
- `{{fieldId}}` placeholders are replaced with record values
- The `autoYesExp` is parsed into the AST
- If `autoYesVal` is true, the question skips the LLM entirely

### Stage 3: Answered (LLM response)

```typescript
interface IAnsweredQuestion extends IQuestion {
  answer: string;    // "Yes" or "No"
  thinking: string;  // LLM reasoning chain
  defense: string;   // LLM defense of its answer
  snippet?: string;  // RAG-retrieved transcript context
}
```

Stored as `AuditFinding.answeredQuestions[]`.

---

## 5. Where It Runs in the Pipeline

Source: rough-draft-state-2.24.md, section 13 (Pipeline State Machine)

The audit pipeline is a QStash-driven step chain:

```
init -> transcribe -> transcribe-complete -> prepare -> ask-batch -> finalize -> cleanup
```

AST parsing and evaluation happen in the **prepare** step
(`/audit/step/prepare`):

1. Fetch questions from Question Lab or QuickBase
2. Populate `{{fieldId}}` placeholders with record field values
3. Parse compound questions (those with `+:` prefix) into AST
4. Evaluate `autoYesExp` -- if true, mark `autoYesVal = true`
5. Fan out non-auto-yes questions into batches for `ask-batch`

The **ask-batch** step (`/audit/step/ask-batch`) handles:

1. For compound questions: each `IQuestionAstNode` is sent to the
   LLM individually as a separate yes/no question
2. Results fill in `IAstResults.raw`
3. NOT/AND/OR reduction produces the final `orResult`
4. Fan-in via atomic counter -- when last batch completes, trigger
   finalize

---

## 6. Data Storage

### KV Keys (transient, during pipeline)

| Key Pattern | Value | Notes |
| ----------- | ----- | ----- |
| `[orgId, "audit-populated-questions", findingId, chunkIdx]` | JSON chunk | Backup of populated questions |
| `[orgId, "audit-answers", findingId, batchIdx, chunkIdx]` | JSON chunk | Per-batch answers |
| `[orgId, "audit-batches-remaining", findingId]` | number | Fan-in counter |
| `[orgId, "question-cache", auditId, hash]` | `{answer, thinking, defense}` | TTL: 10min |

### AuditFinding (persistent)

The three question arrays live directly on the `AuditFinding` entity:
- `unpopulatedQuestions: IQuestionSeed[]`
- `populatedQuestions: IQuestion[]`
- `answeredQuestions: IAnsweredQuestion[]`

---

## 7. V2 Data Model References

The V2 study keeps `AstResults` as an embedded entity on
`AnswerEntry.evaluation`:

| Field | Description |
| ----- | ----------- |
| `tree` | parsed AST |
| `raw` | unparsed expression |
| `notResults` | NOT clause results |
| `andResults` | AND clause results |
| `orResult` | final OR result |

This is referenced from `audit-execution.md` line 89:
`evaluation? | AstResults -- scoring result (llm only)`

---

## 8. Question Lab Integration

Source: `QLQuestion` entity

```typescript
interface QLQuestion {
  id: string;
  name: string;
  text: string;           // Question template (may include +: prefix)
  configId: string;       // FK -> QLConfig.id
  autoYesExp: string;     // The expression that feeds the AST
  versions: QLVersion[];  // Version history
  testIds: string[];      // FK[] -> QLTest.id
}
```

The `autoYesExp` on `QLQuestion` becomes the `autoYesExp` on
`IQuestionSeed` at runtime. The `+:` prefix in the question `text`
triggers compound parsing.

---

## 9. Known Gaps and Limitations

From the reconciliation reports:

1. **Not specified in study**: The compound question AST grammar is
   a code-only feature. The study's question model (`AuditQuestion`)
   has no equivalent to `autoYesExp` or the `+:` compound syntax.

2. **Study proposes replacement**: The study envisions a full
   expression language (`{{fields.*}}` context, function calls like
   `audits()`, `scores()`, `llm()`) which would supersede the AST.

3. **No formal grammar**: The `+:` / `&` / `|` / `!` syntax is
   implemented in `providers/question-expr.ts` but has no formal
   BNF or grammar specification.

4. **Flat precedence**: The OR-of-ANDs structure means `|` always
   has lower precedence than `&`. There is no grouping (parentheses)
   support.

5. **No nested expressions**: Sub-questions cannot themselves be
   compound. Each node in the AST is a simple yes/no question.

6. **autoYesExp vs SkipRule**: The V1 `autoYesExp` auto-answers
   "Yes". The V2 study proposes `SkipRule` which removes the
   question entirely (producing a `SkippedEntry` instead). These
   are different behaviors.

7. **V2 expression language status** (from reprt.md line 588):
   Listed as "Partial (AST) -> Yes (full engine)" -- categorized
   as a "Major expansion" for V2.

---

## 10. Source File Map

| File | What it contains |
| ---- | ---------------- |
| `providers/question-expr.ts` | AST parser and evaluator |
| `types/mod.ts` | IQuestionAstNode, IAstResults, IQuestion* interfaces |
| `steps/prepare.ts` | Pipeline step that triggers AST parsing |
| `steps/ask-batch.ts` | Pipeline step that evaluates sub-questions via LLM |
| `lib/kv.ts` | KV storage for question chunks and batch counters |
