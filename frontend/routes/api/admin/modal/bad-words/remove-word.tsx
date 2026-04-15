/** POST: Remove word from bad words config, return updated list. */
import { define } from "../../../../../lib/define.ts";
import { apiFetch, apiPost } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const word = (form.get("word") as string)?.trim();

    let config: Record<string, unknown> = {};
    try { config = await apiFetch("/admin/bad-word-config", ctx.req); } catch {}
    let rawWords = (config.words as (string | { word: string })[]) ?? [];
    if (word) {
      rawWords = rawWords.filter(w => (typeof w === "string" ? w : w.word) !== word);
      config.words = rawWords;
      try { await apiPost("/admin/bad-word-config", ctx.req, config); } catch {}
    }
    const words = rawWords.map(w => typeof w === "string" ? w : w.word);

    const html = renderToString(
      <>{words.length === 0 ? (
        <div style="color:var(--text-dim);font-size:11px;padding:8px;">No words configured</div>
      ) : words.map(w => (
        <div key={w} class="item-row">
          <span>{w}</span>
          <button class="item-remove" hx-post="/api/admin/modal/bad-words/remove-word" hx-vals={JSON.stringify({ word: w })} hx-target="#bw-word-list" hx-swap="innerHTML">&times;</button>
        </div>
      ))}</>
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
