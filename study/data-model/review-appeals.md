# Review & Appeals

---

## AppealRecord `stored`

| Field | Description |
| ----- | ----------- |
| `auditId` | audit instance being appealed |
| `findingId` | disputed finding |
| `filedByEmail` | person who filed the appeal |
| `notes` | reason for the appeal |
| `status` | one of AppealStatus names |
| `judgeEmail` | judge who resolved the appeal |
| `auditorEmail` | original auditor |

---

## AppealStatus `enum`

```
pending | resolved
```
