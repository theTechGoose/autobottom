/** POST: Add word to bad words config (preserving exclusions on existing entries), return refreshed words tab. */
import { define } from "../../../../../lib/define.ts";
import { apiFetch, apiPost } from "../../../../../lib/api.ts";
import { renderBadWordsResponse, type BwConfig, type BwWordEntry } from "../bad-words.tsx";

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const word = (form.get("word") as string)?.trim();

    let config: BwConfig = {};
    try { config = await apiFetch<BwConfig>("/admin/bad-word-config", ctx.req); } catch { /* empty */ }
    const rawWords: (string | BwWordEntry)[] = config.words ?? [];
    const existingNames = rawWords.map(w => typeof w === "string" ? w : w.word);
    let expand: string | null = null;
    if (word && !existingNames.includes(word)) {
      // Push as object with empty exclusions so the entry can grow exclusion rules
      rawWords.push({ word, exclusions: [] });
      config.words = rawWords;
      try { await apiPost("/admin/bad-word-config", ctx.req, config); } catch { /* fail-safe */ }
      expand = word;
    }

    return await renderBadWordsResponse(ctx.req, { tab: "words", expandedWord: expand });
  },
});
