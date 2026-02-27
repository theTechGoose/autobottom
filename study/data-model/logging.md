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

---

## Pipeline Statistics

Rolling pipeline metrics tracked alongside logs.
Developers can add pipeline stat widgets to their
dashboard.

| Metric | Description |
| ------ | ----------- |
| `active` | currently processing instances |
| `completed` | successfully finished (24h rolling) |
| `error` | pipeline failures (24h rolling) |
| `retry` | retry attempts (24h rolling) |

These replace the current in-KV stats tracking
with log-based metrics. Developers query Loki
for pipeline health views.

---

## LLM Token Usage

Per-function token metering for cost attribution.

| Field | Description |
| ----- | ----------- |
| `function` | which LLM call (audit-questions, feedback, diarization, summarization) |
| `model` | LLM model used |
| `promptTokens` | input tokens |
| `completionTokens` | output tokens |
| `totalTokens` | prompt + completion |
| `timestamp` | when the call was made |

Token usage is logged as structured entries and
queryable via the developer dashboard. Supports
time-range aggregation and per-function breakdown.
The developer capability includes a token usage
dashboard widget.
