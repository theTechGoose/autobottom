/** Modal content: Pipeline settings — stepper UI matching production. */
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
              <div class="pm-field-desc">Max concurrent audit operations</div>
            </div>
            <div class="pm-stepper">
              <button class="pm-step-btn" data-step data-target="a-parallelism" data-dir="-1" type="button">&minus;</button>
              <input type="number" class="pm-step-value" id="a-parallelism" name="parallelism" min="1" max="100" value={String(para.parallelism)} />
              <button class="pm-step-btn" data-step data-target="a-parallelism" data-dir="1" type="button">+</button>
              <span class="pm-unit" style="visibility:hidden;">sec</span>
            </div>
          </div>
        </div>

        <div class="pm-divider"></div>

        {/* Queue Status */}
        <div class="pm-section">
          <div class="pm-section-label" style="display:flex;align-items:center;justify-content:space-between;">
            <span>Queue Status (Live from QStash)</span>
            <button class="sf-btn ghost" hx-get="/api/admin/modal/pipeline/queues" hx-target="#pm-queue-status" hx-swap="innerHTML" style="font-size:10px;padding:3px 10px;height:auto;">Check</button>
          </div>
          <div id="pm-queue-status" style="font-size:11px;color:var(--text-dim);padding:4px 0;">Click "Check" to verify QStash queue parallelism</div>
        </div>

        <div class="pm-divider"></div>

        {/* Retry Policy */}
        <div class="pm-section">
          <div class="pm-section-label">Retry Policy</div>
          <div class="pm-field">
            <div class="pm-field-info">
              <div class="pm-field-name">Max Retries</div>
              <div class="pm-field-desc">Attempts before marking failed</div>
            </div>
            <div class="pm-stepper">
              <button class="pm-step-btn" data-step data-target="a-retries" data-dir="-1" type="button">&minus;</button>
              <input type="number" class="pm-step-value" id="a-retries" name="maxRetries" min="0" max="50" value={String(config.maxRetries)} />
              <button class="pm-step-btn" data-step data-target="a-retries" data-dir="1" type="button">+</button>
              <span class="pm-unit" style="visibility:hidden;">sec</span>
            </div>
          </div>
          <div class="pm-field">
            <div class="pm-field-info">
              <div class="pm-field-name">Delay</div>
              <div class="pm-field-desc">Seconds between retry attempts</div>
            </div>
            <div class="pm-stepper">
              <button class="pm-step-btn" data-step data-target="a-retry-delay" data-dir="-1" type="button">&minus;</button>
              <input type="number" class="pm-step-value" id="a-retry-delay" name="retryDelaySeconds" min="0" max="300" value={String(config.retryDelaySeconds)} />
              <button class="pm-step-btn" data-step data-target="a-retry-delay" data-dir="1" type="button">+</button>
              <span class="pm-unit">sec</span>
            </div>
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
