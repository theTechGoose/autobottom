# Expression Language Spec

A mini formula engine (like Excel) usable
everywhere in the app. Used in email bodies,
subjects, badge increments, skip rules, webhook
templates, etc.

---

## 1. Syntax

- Variables: `{{currentUser}}`,
  `{{record.fieldName}}`
- Functions: `functionName(arg1, arg2)`
- Nesting:
  `llm('prompt', extractFailedQuestions(
    audits({{currentUser}}), 10))`
- Literals: strings `'...'`, numbers `10`

---

## 2. Context

Context depends on where the expression runs:

- Email/webhook/chat: `{{event}}`,
  `{{currentUser}}`, `{{record}}`, field values
- Badge increment: `{{fields.*}}`, `{{result}}`
- Skip rules: `{{fields.*}}`

---

## 3. Function Types

- **Data fetchers:** `audits(user)`,
  `appeals(user)`, `scores(user, configId)`
- **Transformers:**
  `extractFailedQuestions(audits, limit)`,
  `average()`, `count()`, `latest()`
- **AI:** `llm(prompt, ...context)`
- **Helpers:** string/math/date utilities
