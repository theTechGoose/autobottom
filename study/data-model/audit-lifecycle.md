# Audit Lifecycle

---

## Pipeline Flow

```
AuditConfig + Field Data
        |
        v
AuditInstance (pending)
        |
        v
transcribe -> populate questions -> ask (RAG + LLM)
        |
        v
results.push(origin: llm)
        |
        v
   +-----------+-----------------+
   |           |                 |
all "Yes"   has "No"        appeal filed
   |           |                 |
resolved    results.push      appeal-pending
            (origin: reviewer)   |
               |              results.push
            resolved          (origin: judge)
               |                 |
         ManagerQueueItem     resolved
                                 |
                           ManagerQueueItem
```

---

## Status Transitions

```
pending
  |
  v
transcribing
  |
  v
populating-questions
  |
  v
asking-questions
  |
  v
resolved  <--  (all paths end here)
  ^
  |
appeal-pending  (if appeal filed before resolution)
```

`retrying` can occur at any pipeline step on transient failure.
