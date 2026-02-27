# Testing & Seed Data Spec

Testing strategy for the platform, including
integration tests, Question Lab tests, and
seed data for development and demo purposes.

---

## 1. Integration Tests

End-to-end tests that exercise the full audit
pipeline from submission to resolution.

### Single Audit Test

Submits one audit with a known recording and
configuration, runs the complete pipeline, and
verifies:

- Recording was downloaded and stored
- Transcription completed
- Questions were populated
- LLM answered all questions
- Feedback was generated
- Finding status reached "finished"

### Question Lab Test

Validates Question Lab configuration end-to-end:

- Creates a QLConfig with questions
- Runs test cases against transcript snippets
- Verifies LLM answers match expected results
- Tests version history and restore

---

## 2. Seed Data

Pre-built dataset for development and demo
environments. Contains realistic audit findings
with full pipeline output.

### Contents

- 100+ sample AuditFinding records
- Raw and diarized transcripts
- Answered questions with LLM reasoning
- Feedback cards
- Gamification state (XP, badges, streaks)
- Store items and cosmetics
- Sound packs

### Usage

Seed data is loaded via admin endpoint. It
populates an org with enough data to demonstrate
all platform features without running actual
audits.

---

## 3. Review Seed Data

Test data specifically for the review workflow:

- Findings with "No" answers ready for review
- Pre-populated review queue items
- Decision history for leaderboard testing
