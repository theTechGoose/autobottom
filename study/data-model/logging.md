# Logging

> External: Grafana Cloud

---

## Log Entry `computed` (structured JSON to stdout)

| Field | Description |
| ----- | ----------- |
| `timestamp` | when emitted |
| `level` | debug \| info \| warn \| error |
| `service` | which app function |
| `teamId` | scoping label |
| `orgId` | scoping label |
| `userId` | who triggered |
| `message` | log message |
| `data` | `Record<string, unknown>` |

---

## Infrastructure Notes

- **Backend:** managed Loki (storage + query) + Grafana (UI). One platform-level
  backend, NOT per-org.
- **Ingestion:** `waitUntil(fetch())` to Loki push API after response. Swap to
  OTel when Deno Deploy ships it.
- **Visibility:** label filtering on team tree. Developer = all, Admin = their
  org, User = their team.
- **Storage:** Loki handles hot/cold internally (ingesters -> S3 chunks). No
  custom code.
