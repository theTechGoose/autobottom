/** POST: run a simulation through Groq. Returns result HTML with pass/fail buttons. */
import { define } from "../../../../lib/define.ts";
import { apiPost, parseHtmxBody } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import { escapeHtml } from "../../../../lib/qlab-render.tsx";

interface LlmAnswer {
  answer?: string;
  thinking?: string;
  defense?: string;
  raw?: string;
}

export const handler = define.handlers({
  async POST(ctx) {
    const body = await parseHtmxBody(ctx.req);
    const configId = String(body.configId ?? "");
    const questionId = String(body.questionId ?? "");
    const transcript = String(body.transcript ?? "").trim();
    if (!questionId || !transcript) {
      return new Response(
        `<div style="color:var(--red);font-size:11px;">Question + transcript required.</div>`,
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }

    let result: LlmAnswer = {};
    try {
      const r = await apiPost<{ result?: LlmAnswer; error?: string }>(
        "/api/qlab/simulate",
        ctx.req,
        { questionId, transcript },
      );
      if (r.error) {
        return new Response(
          `<div style="color:var(--red);font-size:11px;">Backend: ${escapeHtml(r.error)}</div>`,
          { headers: { "content-type": "text/html; charset=utf-8" } },
        );
      }
      result = r.result ?? {};
    } catch (e) {
      return new Response(
        `<div style="color:var(--red);font-size:11px;">Sim failed: ${escapeHtml((e as Error).message)}</div>`,
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }

    const answer = result.answer ?? "";
    const thinking = result.thinking ?? "";
    const defense = result.defense ?? "";

    const html = renderToString(
      <div style="border:1px solid var(--border);border-radius:8px;padding:12px;background:var(--bg);">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--text-dim);">
            LLM Answer
          </div>
          <div style="display:flex;gap:6px;">
            <form
              hx-post="/api/qlab/runner/save"
              hx-target="#qlab-save-result"
              hx-swap="innerHTML"
              style="display:flex;gap:4px;"
            >
              <input type="hidden" name="configId" value={configId} />
              <input type="hidden" name="questionId" value={questionId} />
              <input type="hidden" name="answer" value={answer} />
              <input type="hidden" name="thinking" value={thinking} />
              <input type="hidden" name="defense" value={defense} />
              <button type="submit" name="result" value="pass" class="sf-btn" style="background:var(--green-bg);color:var(--green);font-size:10px;border-color:rgba(63,185,80,0.3);">
                Mark Pass
              </button>
              <button type="submit" name="result" value="fail" class="sf-btn" style="background:var(--red-bg);color:var(--red);font-size:10px;border-color:rgba(248,81,73,0.3);">
                Mark Fail
              </button>
            </form>
          </div>
        </div>
        <div style="font-family:var(--mono);font-size:13px;font-weight:700;color:var(--text-bright);margin-bottom:8px;">
          → {answer || "(no answer)"}
        </div>
        {thinking && (
          <details style="margin-bottom:6px;">
            <summary style="cursor:pointer;font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;">Thinking</summary>
            <div style="font-size:11px;color:var(--text-muted);white-space:pre-wrap;margin-top:6px;font-family:var(--mono);">{thinking}</div>
          </details>
        )}
        {defense && (
          <details>
            <summary style="cursor:pointer;font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;">Defense</summary>
            <div style="font-size:11px;color:var(--text-muted);white-space:pre-wrap;margin-top:6px;font-family:var(--mono);">{defense}</div>
          </details>
        )}
        <div id="qlab-save-result" style="margin-top:10px;"></div>
      </div>,
    );
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  },
});
