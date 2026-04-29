/** POST: Remove word from bad words config (matching by .word for object entries), return refreshed words tab. */
import { define } from "../../../../../lib/define.ts";
import { apiFetch, apiPost } from "../../../../../lib/api.ts";
import { renderBadWordsResponse, type BwConfig, type BwWordEntry } from "../bad-words.tsx";

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const word = (form.get("word") as string)?.trim();

    let config: BwConfig = {};
    try { config = await apiFetch<BwConfig>("/admin/bad-word-config", ctx.req); } catch { /* empty */ }
    let rawWords: (string | BwWordEntry)[] = config.words ?? [];
    if (word) {
      rawWords = rawWords.filter(w => (typeof w === "string" ? w : w.word) !== word);
      config.words = rawWords;
      try { await apiPost("/admin/bad-word-config", ctx.req, config); } catch { /* fail-safe */ }
    }

    return await renderBadWordsResponse(ctx.req, { tab: "words", expandedWord: null });
  },
});
