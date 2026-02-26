# Audit Execution

> What DID happen

---

## AuditInstance `stored`

A single audit execution against one recording.

| Field | Description |
| ----- | ----------- |
| `status` | InstanceStatus (enum) |
| `subjectEmail` | person being audited |
| `configId` | `<uuid>:-:<version>` of audit config used |
| `recordingUrl` | link to original recording |
| `transcript` | TranscriptData (embedded) |
| `fieldValues` | `Record<string, unknown>` -- actual values keyed by FieldDef.key |
| `results[]` | AuditResult (embedded) -- append-only, latest = current truth |

**Relationships:**
- references AuditConfig (configId)

---

## AuditResult `embedded`

Appended to `AuditInstance.results[]`. Each entry represents a scoring pass
(LLM, reviewer, or judge).

| Field | Description |
| ----- | ----------- |
| `origin` | one of ResultOrigin names |
| `author` | `autobot+ai@monsterrg.com` for LLM, user email for human |
| `timestamp` | when produced |
| `answers[]` | AnswerEntry -- non-skipped questions |
| `skipped[]` | SkippedEntry -- skipped questions |

---

## ResultOrigin `enum`

```
llm | reviewer | judge
```

---

## AnswerEntry `embedded`

| Field | Description |
| ----- | ----------- |
| `questionId` | references AuditQuestion |
| `answer` | value conforming to AuditQuestion.questionType |
| `notes` | llm: thinking + defense, human: their reasoning |
| `ragDocs[]` | RagDoc -- retrieved documents (llm only) |
| `evaluation?` | AstResults -- scoring result (llm only) |

---

## SkippedEntry `embedded`

| Field | Description |
| ----- | ----------- |
| `questionId` | references AuditQuestion |
| `message` | from SkipRule.message |

---

## InstanceStatus `enum`

```
pending | transcribing | populating-questions | asking-questions | resolved | appeal-pending | retrying
```

---

## TranscriptData `embedded`

| Field | Description |
| ----- | ----------- |
| `words[]` | TranscriptWord (embedded) |

---

## TranscriptWord `embedded`

| Field | Description |
| ----- | ----------- |
| `value` | the spoken word |
| `timestamp` | when spoken |

---

## AstResults `embedded`

Boolean logic evaluation for question scoring.

| Field | Description |
| ----- | ----------- |
| `tree` | parsed AST |
| `raw` | unparsed expression |
| `notResults` | NOT clause results |
| `andResults` | AND clause results |
| `orResult` | final OR result |

---

## RagDoc `embedded`

| Field | Description |
| ----- | ----------- |
| `id` | document ID |
| `score` | relevance score |
| `text` | document content |
| `metadata` | extra attributes |
