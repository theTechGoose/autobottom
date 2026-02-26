# Coaching

---

## CoachingRecord `stored`

| Field | Description |
| ----- | ----------- |
| `agentEmail` | agent being coached |
| `pending[]` | string -- audit IDs awaiting coaching |
| `completed[]` | CoachingAction -- resolved coaching items |

---

## CoachingAction `embedded`

| Field | Description |
| ----- | ----------- |
| `auditId` | audit instance that was addressed |
| `failedQuestionIds[]` | string -- questions the agent failed |
| `managerEmail` | manager who addressed it |
| `managerNotes` | manager's coaching feedback |
| `addressedAt` | when it was addressed |
