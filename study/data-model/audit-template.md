# Audit Template

> What SHOULD happen

---

## AuditConfig `stored`

A reusable audit blueprint.

| Field | Description |
| ----- | ----------- |
| `uuid` | stable identifier, never changes |
| `version` | increments on each edit |
| `configId` | composite key: `<uuid>:-:<version>` |
| `name` | display name |
| `fieldDefs[]` | FieldDef -- schema for input data required per audit |
| `questionIds[]` | references AuditQuestion |
| `skip[]` | SkipRule (embedded) |

**Relationships:**
- owns * AuditQuestion

---

## AuditQuestion `stored`

| Field | Description |
| ----- | ----------- |
| `questionText` | the question prompt |
| `header` | display template |
| `expectedAnswer` | correct answer |
| `questionType` | one of QuestionType names |
| `testIds[]` | references QuestionTest -- sample inputs to verify question logic |
| `ragParams` | RagRetrieveParams -- RAG retrieval settings for this question |

**Relationships:**
- belongs to AuditConfig
- owns * QuestionTest

---

## QuestionType `stored`

| Field | Description |
| ----- | ----------- |
| `name` | type identifier |
| `regex` | validation pattern for accepted input |
| `parser` | "bool" \| "int" \| "float" \| "string" |
| `schema` | JSON Schema representation of this type's value |

---

## QuestionTest `stored`

| Field | Description |
| ----- | ----------- |
| `snippet` | transcript excerpt |
| `expected` | expected result |
| `lastResult` | most recent pass/fail |
| `lastAnswer` | most recent answer |

---

## FieldDef `embedded`

| Field | Description |
| ----- | ----------- |
| `key` | unique identifier |
| `label` | display name |
| `type` | input type |
| `required` | mandatory flag |
| `default?` | fallback value |
| `options?` | allowed values |

---

## SkipRule `embedded`

| Field | Description |
| ----- | ----------- |
| `questionId` | question to skip |
| `expression` | condition to evaluate |
| `message` | reason shown when skipped |

---

## PipelineConfig `stored`

| Field | Description |
| ----- | ----------- |
| `maxRetries` | retry limit |
| `retryDelaySeconds` | delay between retries |

---

## RagRetrieveParams `embedded`

| Field | Description |
| ----- | ----------- |
| `query` | search text |
| `topK` | max results |
| `keep` | min score threshold |
| `mmrLambda` | diversity weight |
| `hybridAlpha` | keyword vs semantic balance |
| `rerank` | re-ranking enabled |
