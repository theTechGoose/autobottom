# Review & Appeals

---

## AppealRecord `stored`

| Field | Description |
| ----- | ----------- |
| `auditId` | audit instance being appealed |
| `findingId` | disputed finding |
| `appealType` | redo \| different-recording \| additional-recording \| upload-recording |
| `filedByEmail` | person who filed the appeal |
| `notes` | reason for the appeal |
| `status` | one of AppealStatus names |
| `judgeEmail` | judge who resolved the appeal |
| `auditorEmail` | original auditor |
| `appealSourceFindingId` | original finding (if re-audit appeal) |

---

## ReviewChecklist `stored`

| Field | Description |
| ----- | ----------- |
| `auditId` | AuditInstance being reviewed |
| `items[]` | one per question needing review |
| `items[].questionId` | which question |
| `items[].claimedBy` | reviewer email (null = unclaimed) |
| `items[].lockedUntil` | claim expiry timestamp (30-min TTL) |
| `items[].decision` | confirm \| flip \| null |
| `items[].decidedBy` | reviewer email who decided |
| `items[].decidedAt` | decision timestamp |

Created when LLM result has "No" answers. Archived
(soft-deleted) after all items are decided and
consolidated into `results.push(origin: reviewer)`.

---

## AppealChecklist `stored`

| Field | Description |
| ----- | ----------- |
| `appealId` | AppealRecord being judged |
| `auditId` | AuditInstance under appeal |
| `items[]` | one per question under appeal |
| `items[].questionId` | which question |
| `items[].claimedBy` | judge email (null = unclaimed) |
| `items[].lockedUntil` | claim expiry timestamp (30-min TTL) |
| `items[].decision` | uphold \| overturn \| null |
| `items[].decidedBy` | judge email who decided |
| `items[].decidedAt` | decision timestamp |

Created when appeal is filed. Archived
(soft-deleted) after all items are decided and
consolidated into `results.push(origin: judge)`.

---

## AppealStatus `enum`

```
pending | resolved
```
