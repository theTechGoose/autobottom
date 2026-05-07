/** POST handler: Save pipeline retry config + per-queue QStash parallelism.
 *  Each queue with a numeric input is pushed to /admin/set-queue-parallelism
 *  individually so QStash actually enforces the cap. Empty inputs are
 *  skipped (lets the operator change one queue without re-asserting all). */
import { define } from "../../../../../lib/define.ts";
import { apiPost } from "../../../../../lib/api.ts";

const QUEUES = ["audit-transcribe", "audit-questions", "audit-cleanup"];

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const maxRetries = Number(form.get("maxRetries")) || 3;
    const retryDelaySeconds = Number(form.get("retryDelaySeconds")) || 30;

    const updates: Array<{ queueName: string; parallelism: number }> = [];
    for (const q of QUEUES) {
      const raw = form.get(`parallelism-${q}`);
      if (raw === null || raw === "") continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 1 || n > 100) continue;
      updates.push({ queueName: q, parallelism: Math.floor(n) });
    }

    const errors: string[] = [];

    try {
      await apiPost("/admin/pipeline-config", ctx.req, { maxRetries, retryDelaySeconds });
    } catch (e) {
      errors.push(`retry-policy: ${(e as Error).message}`);
    }

    for (const u of updates) {
      try {
        await apiPost("/admin/set-queue-parallelism", ctx.req, u);
      } catch (e) {
        errors.push(`${u.queueName}: ${(e as Error).message}`);
      }
    }

    if (errors.length > 0) {
      return new Response(
        `<span style="font-size:11px;color:var(--red);">Error: ${errors.join("; ")}</span>`,
        { headers: { "content-type": "text/html" } },
      );
    }

    const summary = updates.length === 0
      ? "Saved retry policy"
      : `Saved · pushed ${updates.length} queue${updates.length === 1 ? "" : "s"} to QStash`;
    return new Response(
      `<span style="font-size:11px;color:var(--green);">${summary}</span>`,
      { headers: { "content-type": "text/html" } },
    );
  },
});
