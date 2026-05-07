/** Modal content: Pipeline settings. Native browser number-input spinners
 *  drive increment/decrement (no client JS); Save posts the form via HTMX.
 *
 *  Parallelism inputs are backed by /admin/queue-info (read) + /admin/set-
 *  queue-parallelism (write) — those push real values to QStash's per-queue
 *  parallelism setting, which is the only thing that actually caps in-flight
 *  audit messages. The legacy /admin/parallelism single-value endpoint is
 *  cosmetic and no longer surfaced here. */
import { define } from "../../../../lib/define.ts";
import { apiFetch } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import { Icon } from "../../../../components/Icons.tsx";

interface QueueInfoResponse {
  ok?: boolean;
  queues?: Array<{ queueName: string; parallelism?: number; messageCount?: number; paused?: boolean; error?: string }>;
}

const QUEUE_DEFS: Array<{ name: string; label: string; desc: string }> = [
  { name: "audit-transcribe", label: "Transcribe",     desc: "I/O-heavy — AssemblyAI pulls (1–100)" },
  { name: "audit-questions",  label: "Questions",      desc: "LLM-heavy — rate-limit sensitive (1–100)" },
  { name: "audit-cleanup",    label: "Cleanup",        desc: "Finalize + Quickbase write (1–100)" },
];

export const handler = define.handlers({
  async GET(ctx) {
    let config = { maxRetries: 3, retryDelaySeconds: 30 };
    let info: QueueInfoResponse = {};
    try { config = await apiFetch("/admin/pipeline-config", ctx.req); } catch {}
    try { info = await apiFetch<QueueInfoResponse>("/admin/queue-info", ctx.req); } catch {}

    const byName = new Map<string, { parallelism?: number; messageCount?: number; paused?: boolean }>();
    for (const q of info.queues ?? []) byName.set(q.queueName, q);

    const html = renderToString(
      <div>
        {/* Header */}
        <div class="pm-header">
          <div class="pm-icon">{Icon.settings(20)}</div>
          <div>
            <div class="modal-title" style="margin-bottom:2px;">Pipeline Settings</div>
            <div class="modal-sub" style="margin-bottom:0;">Per-queue QStash parallelism & retry policy</div>
          </div>
        </div>

        {/* Per-queue Parallelism (live from QStash) */}
        <div class="pm-section">
          <div class="pm-section-label">Concurrency (per queue)</div>
          {QUEUE_DEFS.map((q) => {
            const live = byName.get(q.name);
            const cur = typeof live?.parallelism === "number" ? live.parallelism : "";
            const msgs = typeof live?.messageCount === "number" ? live.messageCount : null;
            const paused = !!live?.paused;
            return (
              <div class="pm-field">
                <div class="pm-field-info">
                  <div class="pm-field-name">{q.label}</div>
                  <div class="pm-field-desc">
                    {q.desc}
                    <span style="margin-left:8px;color:var(--text-dim);">
                      {msgs === null ? "queue: —" : `queue: ${msgs}`}{paused ? " · paused" : ""}
                    </span>
                  </div>
                </div>
                <input
                  type="number"
                  class="pm-num-input"
                  name={`parallelism-${q.name}`}
                  data-queue={q.name}
                  min="1"
                  max="100"
                  step="1"
                  value={String(cur)}
                  placeholder="—"
                />
              </div>
            );
          })}
        </div>

        <div class="pm-divider"></div>

        {/* Queue Status */}
        <div class="pm-section">
          <div class="pm-section-label" style="display:flex;align-items:center;justify-content:space-between;">
            <span>Queue Status (Live from QStash)</span>
            <button class="sf-btn ghost" hx-get="/api/admin/modal/pipeline/queues" hx-target="#pm-queue-status" hx-swap="innerHTML" style="font-size:10px;padding:3px 10px;height:auto;">Check</button>
          </div>
          <div id="pm-queue-status" style="font-size:11px;color:var(--text-dim);padding:4px 0;">Click "Check" to read the live queue counts from QStash.</div>
        </div>

        <div class="pm-divider"></div>

        {/* Retry Policy */}
        <div class="pm-section">
          <div class="pm-section-label">Retry Policy</div>
          <div class="pm-field">
            <div class="pm-field-info">
              <div class="pm-field-name">Max Retries</div>
              <div class="pm-field-desc">Attempts before marking failed (0–50)</div>
            </div>
            <input type="number" class="pm-num-input" id="a-retries" name="maxRetries" min="0" max="50" step="1" value={String(config.maxRetries)} />
          </div>
          <div class="pm-field">
            <div class="pm-field-info">
              <div class="pm-field-name">Delay (seconds)</div>
              <div class="pm-field-desc">Wait between retry attempts (0–300)</div>
            </div>
            <input type="number" class="pm-num-input" id="a-retry-delay" name="retryDelaySeconds" min="0" max="300" step="1" value={String(config.retryDelaySeconds)} />
          </div>
        </div>

        {/* Actions */}
        <div class="modal-actions" style="padding:14px 28px 22px;">
          <button class="sf-btn secondary" data-close-modal="pipeline-modal">Cancel</button>
          <button class="sf-btn primary" hx-post="/api/admin/modal/pipeline/save" hx-include="[name^='parallelism-'], #a-retries, #a-retry-delay" hx-target="#pm-save-msg" hx-swap="innerHTML">Save</button>
          <span id="pm-save-msg"></span>
        </div>
      </div>
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
