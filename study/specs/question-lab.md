# Question Lab Spec

Developer/admin tool for building, testing, and
iterating on audit question configurations before
deploying them to production.

---

## 1. Purpose

Question Lab provides a sandbox for tuning
AuditConfig question sets. Users can:

- Create and manage question configurations
- Write and edit individual questions
- Run tests against transcript snippets
- Compare LLM answers to expected results
- Track question version history
- Restore previous question versions

This is the primary workflow for ensuring audit
questions produce accurate, reliable results
before they reach live audits.

---

## 2. QLConfig (stored)

A question configuration under development.

```
QLConfig
  name           display name
  questionIds[]  references to QLQuestion entities
  createdAt      creation timestamp
```

QLConfigs are independent from production
AuditConfigs. Once a QLConfig is validated, its
questions are promoted into an AuditConfig version.

---

## 3. QLQuestion (stored)

A single question being developed.

```
QLQuestion
  name          display name
  text          question text (with {{variable}}
                placeholders)
  configId      parent QLConfig
  autoYesExp    auto-yes expression (optional)
  versions[]    previous text versions (embedded)
  testIds[]     references to QLTest entities
```

### Version History

Every edit to `text` appends the previous value
to `versions[]`. Users can browse history and
restore any previous version.

---

## 4. QLTest (stored)

A test case for validating a question.

```
QLTest
  snippet       transcript excerpt to test against
  expected      expected answer (yes / no)
  lastResult    pass / fail (null until run)
  lastAnswer    LLM's actual answer
  lastThinking  LLM's reasoning
  lastDefense   LLM's defense of its answer
```

### Running Tests

1. User provides a transcript snippet and
   expected answer.
2. System runs the question against the snippet
   using the LLM service (same pipeline as
   production: RAG retrieval + LLM).
3. Result is compared to expected.
4. Pass/fail, actual answer, and LLM reasoning
   are stored on the test.

Tests are quality tools, not deployment gates.
A config can be promoted with failing tests
(the user is warned but not blocked).

---

## 5. Workflow

```
Create QLConfig
  |
  v
Add questions (QLQuestion)
  |
  v
Write test cases (QLTest) per question
  |
  v
Run tests -> iterate on question text
  |
  v
When satisfied, promote to AuditConfig version
```

---

## 6. Events

- audit.question.testPassed
- audit.question.testFailed
