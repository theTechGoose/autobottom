# Data Model Proposal: Config/Instance Separation

Team discussion cache -- proposed restructuring of the audit data hierarchy.

---

## Current Problem

Config (template) and execution (instance) concerns are tangled together in a
single entity. This makes it hard to:

- Reuse audit configurations across multiple executions
- Query instance results independently of config definition
- Evolve questions/thresholds without affecting historical audit data

## Proposed Hierarchy

```
AuditConfig (template / blueprint)
  ├── AuditQuestion (what to ask -- belongs to a config)
  └── config-level settings (variables, thresholds, scoring rules, etc.)

AuditInstance (one specific audit execution)
  ├── references AuditConfig (which blueprint was used)
  ├── recording, transcript, guest info, reservation data, etc.
  └── AuditAnswer (one per AuditQuestion)
       └── the actual response/score for that question in this run
```

## Entity Breakdown

### AuditConfig

The blueprint. "Here's how we audit X type of call."

- Which questions to ask
- Scoring rules / thresholds
- Any configurable variables (consider: do these need their own entity, or
  are they just fields on config?)

### AuditQuestion

A question template belonging to a config.

- Question text
- Expected answer type (yes/no, text, scale, etc.)
- Scoring weight
- Order/sequence within the config

### AuditInstance

A specific execution of an audit against a specific recording/reservation.
This is roughly what `AuditFinding` is today.

- References which AuditConfig was used
- Recording, transcript, guest info, reservation details
- Pipeline status (pending, transcribing, finished, etc.)
- Feedback, appeals

### AuditAnswer

The result of evaluating one AuditQuestion in one AuditInstance.

- References AuditQuestion and AuditInstance
- The actual answer/response
- Score for this question
- Any AI-generated reasoning

## Key Principle

**AuditConfig + AuditQuestion = what SHOULD happen.**
**AuditInstance + AuditAnswer = what DID happen.**

## Open Questions

1. Do "variables" need their own entity, or are they just fields on
   AuditConfig? A separate entity only makes sense if variables are
   independently reusable across configs or have a many-to-many relationship.
2. How do we handle config versioning? If questions change, historical
   instances should still reference the version they were audited against.
3. Does the reports feature query across instances, configs, or both?
   (Likely both -- filter by config, aggregate across instances.)
