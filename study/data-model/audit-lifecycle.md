# Audit Lifecycle

---

## Batch Flow

```
AuditBatch (pending)
  |
  v
For each record in batch:
  -> AuditInstance created (pending)
  -> Pipeline runs independently
  -> On completion, doneIds[] updated
  |
  v
All instances done -> AuditBatch (finished)
```

---

## Pipeline Flow

```
AuditConfig + Field Data (passed at audit time)
        |
        v
AuditInstance (pending)
        |
        v
init (download recording from recordings service)
        |
        v
transcribe -> transcribe-complete (diarize)
        |
        v
prepare (populate question templates with fields)
        |
        v
ask-batch (fan-out: parallel LLM + RAG batches)
        |
        v
finalize (aggregate answers, generate feedback)
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
         CoachingRecord       resolved
                                 |
                           CoachingRecord
```

---

## Status Transitions

```
pending
  |
  v
creating-job -> pulling-record -> getting-recording
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
appeal-pending  (if appeal filed after resolution)
```

`retrying` can occur at any pipeline step on
transient failure. `no-recording` is a terminal
failure state when recording cannot be acquired.
