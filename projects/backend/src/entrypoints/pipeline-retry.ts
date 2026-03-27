/** Pipeline retry middleware — wraps pipeline step handlers with error recovery. */

import { enqueueStep } from "../domain/data/queue/mod.ts";
import { trackError, trackRetry, trackCompleted, getPipelineConfig } from "../domain/data/kv/mod.ts";
import { sendEmail } from "../domain/data/postmark/mod.ts";
import { env } from "../env.ts";
import { json } from "./helpers.ts";
import type { Handler } from "./helpers.ts";

/**
 * Wraps a pipeline step handler with retry logic.
 * On error: re-enqueues the step up to maxRetries, then sends an alert email.
 * Always returns 200 to free the queue slot (QStash would otherwise retry on its own).
 */
export function withPipelineRetry(handler: Handler): Handler {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const cloned = req.clone();

    let body: Record<string, any> = {};
    try { body = await cloned.json(); } catch { /* no body */ }

    try {
      return await handler(req);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[${url.pathname}] error:`, e);

      const retryOrgId = body.orgId ?? "";
      const pipelineCfg = retryOrgId
        ? await getPipelineConfig(retryOrgId)
        : { maxRetries: 3, retryDelaySeconds: 30 };
      const attempt = (body._retry ?? 0) + 1;
      const stepName = url.pathname.replace("/audit/step/", "");
      const fid = body.findingId ?? "unknown";

      if (retryOrgId) {
        trackError(retryOrgId, fid, stepName, msg).catch(() => {});
      }

      if (attempt <= pipelineCfg.maxRetries) {
        const is429 = msg.includes("429") || msg.toLowerCase().includes("rate limit");
        const delay = is429 ? pipelineCfg.retryDelaySeconds : undefined;
        console.warn(
          `[${url.pathname}] Re-enqueuing (attempt ${attempt}/${pipelineCfg.maxRetries})` +
          (is429 ? ` [429 delay ${pipelineCfg.retryDelaySeconds}s]` : ""),
        );
        if (retryOrgId) {
          trackRetry(retryOrgId, fid, stepName, attempt).catch(() => {});
        }
        try {
          const retryBody = { ...body, _retry: attempt };
          await enqueueStep(stepName, retryBody, delay);
        } catch (requeueErr) {
          console.error(`[${url.pathname}] Failed to re-enqueue:`, requeueErr);
        }
        return json({ error: msg, retried: true, attempt }, 200);
      }

      // Max retries exhausted
      console.error(`[${url.pathname}] Max retries (${pipelineCfg.maxRetries}) exhausted for findingId=${fid}`);
      if (retryOrgId) {
        trackCompleted(retryOrgId, fid).catch(() => {});
      }
      sendEmail({
        to: env.alertEmail,
        subject: `[Auto-Bot] Pipeline retries exhausted: ${stepName}`,
        htmlBody: `<h3>Pipeline Step Failed</h3>
<p><b>Finding ID:</b> ${fid}</p>
<p><b>Step:</b> ${stepName}</p>
<p><b>Retries:</b> ${attempt - 1}/${pipelineCfg.maxRetries}</p>
<p><b>Error:</b></p><pre>${msg}</pre>
<p><a href="${env.selfUrl}/audit/report?id=${fid}">View Report</a></p>`,
      }).catch((emailErr) => console.error(`[${url.pathname}] Failed to send alert email:`, emailErr));

      return json({ error: msg, retried: false, attempt }, 200);
    }
  };
}
