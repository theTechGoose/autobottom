/** GET: render the inline question editor for an existing question. */
import { define } from "../../../../lib/define.ts";
import { apiFetch } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

interface QLQuestion {
  id: string; configId: string; name: string; text: string;
  autoYesExp?: string; egregious?: boolean;
  temperature?: number; numDocs?: number; weight?: number;
}

export function renderEditor(q: QLQuestion | null, configId: string, isNew: boolean): string {
  return renderToString(
    <div style="border:1px solid var(--accent);border-radius:8px;padding:12px;background:var(--bg-surface);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <div style="font-size:12px;font-weight:700;color:var(--text-bright);">
          {isNew ? "New Question" : `Edit: ${q?.name ?? ""}`}
        </div>
        <button
          type="button"
          class="sf-btn ghost"
          style="font-size:10px;"
          hx-get="/api/qlab/questions/cancel"
          hx-target="#qlab-q-editor"
          hx-swap="innerHTML"
        >Cancel</button>
      </div>

      <form
        hx-post={isNew ? "/api/qlab/questions/create" : "/api/qlab/questions/update"}
        hx-target="body"
        hx-push-url={`/question-lab?configId=${configId}`}
      >
        <input type="hidden" name="configId" value={configId} />
        {!isNew && q && <input type="hidden" name="id" value={q.id} />}

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
          <div>
            <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.8px;">
              Header
            </label>
            <input
              class="sf-input"
              type="text"
              name="name"
              required
              placeholder="e.g. Income Disclosed"
              value={q?.name ?? ""}
            />
          </div>
          <div>
            <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.8px;">
              Auto-Yes Expression
            </label>
            <input
              class="sf-input"
              type="text"
              name="autoYesExp"
              placeholder="+:fieldA~match&fieldB=value"
              value={q?.autoYesExp ?? ""}
            />
          </div>
        </div>

        <div style="margin-bottom:10px;">
          <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.8px;">
            Question Body
          </label>
          <textarea
            class="sf-input"
            name="text"
            required
            placeholder="Was income properly disclosed during the call?"
            style="min-height:120px;font-family:var(--mono);"
          >{q?.text ?? ""}</textarea>
          <div style="font-size:10px;color:var(--text-dim);margin-top:4px;">
            Tip: wrap LLM-context in triple-backtick <code>```note```</code> blocks. Use <code>+:</code> prefix in autoYes to enable <code>&amp;</code> / <code>|</code> operators.
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:10px;">
          <div>
            <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.8px;">
              Temperature
            </label>
            <input class="sf-input" type="number" name="temperature" min="0" max="2" step="0.1" value={String(q?.temperature ?? 0.8)} />
          </div>
          <div>
            <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.8px;">
              Num Docs
            </label>
            <input class="sf-input" type="number" name="numDocs" min="0" max="20" step="1" value={String(q?.numDocs ?? 4)} />
          </div>
          <div>
            <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.8px;">
              Weight
            </label>
            <input class="sf-input" type="number" name="weight" min="1" max="100" step="1" value={String(q?.weight ?? 5)} />
          </div>
          <div style="display:flex;align-items:flex-end;">
            <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text);">
              <input type="checkbox" name="egregious" value="1" checked={q?.egregious ?? false} />
              Egregious
            </label>
          </div>
        </div>

        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button type="submit" class="sf-btn primary" style="font-size:11px;">
            {isNew ? "Create Question" : "Save Changes"}
          </button>
        </div>
      </form>
    </div>,
  );
}

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const id = url.searchParams.get("id") ?? "";
    if (!id) return new Response("id required", { status: 400 });
    try {
      const q = await apiFetch<QLQuestion>(`/api/qlab/question?id=${encodeURIComponent(id)}`, ctx.req);
      return new Response(renderEditor(q, q.configId, false), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    } catch (e) {
      return new Response(`<div style="color:var(--red);font-size:11px;">${(e as Error).message}</div>`, {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
});
