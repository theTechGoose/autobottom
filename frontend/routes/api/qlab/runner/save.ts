/** POST: save a test run (pass/fail) via the backend updateTest endpoint. */
import { define } from "../../../../lib/define.ts";
import { apiPost, parseHtmxBody } from "../../../../lib/api.ts";
import { okFragment, errorFragment, htmlResponse } from "../../../../lib/qlab-render.tsx";

export const handler = define.handlers({
  async POST(ctx) {
    const body = await parseHtmxBody(ctx.req);
    const configId = String(body.configId ?? "");
    const questionId = String(body.questionId ?? "");
    const result = String(body.result ?? "");
    if (!questionId || (result !== "pass" && result !== "fail")) {
      return htmlResponse(errorFragment("questionId + pass/fail required"), 400);
    }
    try {
      const res = await apiPost<{ ok?: boolean; runId?: string; error?: string }>(
        "/api/qlab/tests/update",
        ctx.req,
        {
          configId,
          questionId,
          result,
          answer: String(body.answer ?? ""),
          thinking: String(body.thinking ?? ""),
          defense: String(body.defense ?? ""),
        },
      );
      if (res.error) return htmlResponse(errorFragment(res.error), 400);
      return htmlResponse(okFragment(`Saved as ${result.toUpperCase()}. View it under Test History.`));
    } catch (e) {
      return htmlResponse(errorFragment(`Save failed: ${(e as Error).message}`), 500);
    }
  },
});
