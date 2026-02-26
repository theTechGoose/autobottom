# AuditQuestion Spec

Questions are the core unit of an audit. Each
question defines what to ask, what answer to expect,
how to validate the answer, and how to retrieve
context via RAG.

---

## 1. AuditQuestion (stored)

- questionText -- the prompt shown to the LLM (and
  to human reviewers). Plain text with optional
  expression interpolation for field values.
- header -- display template for the UI. Can differ
  from questionText (e.g. shorter, formatted).
- expectedAnswer -- the correct answer. Used to
  score the LLM's response. Combined with
  questionType to determine pass/fail.
- questionType -- references a QuestionType by name.
  Determines how the answer is parsed and validated.
- testIds[] -- references to QuestionTest entities.
  Sample inputs for verifying question logic before
  going live.
- ragParams -- RagRetrieveParams (embedded). Controls
  how RAG retrieval works for this specific question.

### Relationships

- belongs to AuditConfig (via AuditConfig.questionIds[])
- owns QuestionTest (via testIds[])
- references QuestionType (by name)

---

## 2. QuestionType (stored)

Defines how an answer value is parsed, validated,
and represented. Stored as a separate entity so
types are reusable across questions and configs.

- name -- type identifier (e.g. "yes-no", "score-1-5",
  "free-text", "numeric").
- regex -- validation pattern. The raw answer string
  must match this regex to be considered valid input.
- parser -- how to coerce the raw string into a typed
  value: "bool" | "int" | "float" | "string".
- schema -- JSON Schema representation of this type's
  value. Used for downstream validation and
  serialization.

### How parsing works

```
raw answer string
  -> regex check (reject if no match)
  -> parser coercion (string -> typed value)
  -> schema validation (typed value -> valid/invalid)
```

The regex is the first gate. Parser coercion is
mechanical (e.g. "true" -> true for bool). Schema
validation catches edge cases the regex might miss
(e.g. numeric range constraints).

### Examples

| name       | regex         | parser | schema type    |
| ---------- | ------------- | ------ | -------------- |
| yes-no     | ^(yes\|no)$   | bool   | { type: bool } |
| score-1-5  | ^[1-5]$       | int    | { min:1, max:5 } |
| free-text  | .+            | string | { type: string } |
| percentage | ^[0-9]{1,3}$  | float  | { min:0, max:100 } |

---

## 3. QuestionTest (stored)

Sample inputs for verifying a question's logic
before deploying the config. Developers/admins can
run tests to confirm the LLM + RAG pipeline produces
expected answers for known transcripts.

- snippet -- transcript excerpt. The test input.
- expected -- expected result for this snippet.
  Compared against the actual LLM answer using the
  question's expectedAnswer and questionType.
- lastResult -- most recent pass/fail. Updated each
  time the test runs.
- lastAnswer -- most recent answer the LLM produced.
  Stored for debugging when tests fail.

### Workflow

1. Admin writes a question with an expected answer.
2. Admin adds test cases: known transcript snippets
   paired with known correct answers.
3. Admin runs tests. The pipeline processes each
   snippet through RAG + LLM for that question.
4. Results are compared against expected. Pass/fail
   is recorded.

Tests are not blocking -- a config can be published
with failing tests. They are a quality tool, not a
gate.

### Events

- audit.question.created
- audit.question.modified
- audit.question.deleted
- audit.question.testPassed
- audit.question.testFailed

---

## 4. RagRetrieveParams (embedded)

Per-question RAG retrieval settings. Embedded in
AuditQuestion. Controls how the vector search
retrieves context documents before the LLM answers.

- query -- search text. Can use expression
  interpolation (e.g. `{{questionText}}`).
- topK -- max number of results to retrieve.
- keep -- minimum relevance score threshold.
  Documents below this score are discarded.
- mmrLambda -- diversity weight for Maximal Marginal
  Relevance. 0 = pure diversity, 1 = pure relevance.
- hybridAlpha -- balance between keyword search and
  semantic search. 0 = pure keyword, 1 = pure
  semantic.
- rerank -- boolean. Whether to apply a re-ranking
  model after initial retrieval.

### Why per-question

Different questions need different retrieval
strategies. A compliance question might need high
precision (high keep threshold, rerank on). A
general behavior question might need broader
recall (lower keep, higher topK). Embedding these
params in the question gives admins fine-grained
control without a separate configuration entity.
