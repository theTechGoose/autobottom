/** Modal content: Pipeline settings. Native browser number-input spinners
 *  drive increment/decrement (no client JS); Save posts the form via HTMX. */
import { define } from "../../../../lib/define.ts";
import { apiFetch } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import { Icon } from "../../../../components/Icons.tsx";

export const handler = define.handlers({
  async GET(ctx) {
    let config = { maxRetries: 3, retryDelaySeconds: 30 };
    let para = { parallelism: 5 };
    try { config = await apiFetch("/admin/pipeline-config", ctx.req); } catch {}
    try { para = await apiFetch("/admin/parallelism", ctx.req); } catch {}
    const html = renderToString(
      <div>
        {/* Header */}
        <div class="pm-header">
          <div class="pm-icon">{Icon.settings(20)}</div>
          <div>
            <div class="modal-title" style="margin-bottom:2px;">Pipeline Settings</div>
            <div class="modal-sub" style="margin-bottom:0;">Control concurrency and failure recovery</div>
          </div>
        </div>

        {/* Concurrency Section */}
        <div class="pm-section">
          <div class="pm-section-label">Concurrency</div>
          <div class="pm-field">
            <div class="pm-field-info">
              <div class="pm-field-name">Parallelism</div>
              <div class="pm-field-desc">Max concurrent audit operations (1–100)</div>
            </div>
            <input type="number" class="pm-num-input" id="a-parallelism" name="parallelism" min="1" max="100" step="1" value={String(para.parallelism)} />
          </div>
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
          <button class="sf-btn primary" hx-post="/api/admin/modal/pipeline/save" hx-include="#a-parallelism, #a-retries, #a-retry-delay" hx-target="#pm-save-msg" hx-swap="innerHTML">Save</button>
          <span id="pm-save-msg"></span>
        </div>
      </div>
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
