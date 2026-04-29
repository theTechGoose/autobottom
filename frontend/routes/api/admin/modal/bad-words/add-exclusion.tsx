/** POST: Add an exclusion rule to a word entry, save config, return refreshed words tab. */
import { define } from "../../../../../lib/define.ts";
import { apiFetch, apiPost } from "../../../../../lib/api.ts";
import { renderBadWordsResponse, type BwConfig, type BwWordEntry } from "../bad-words.tsx";

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const word = (form.get("word") as string)?.trim();
    const exType = (form.get("exType") as string)?.trim();
    const exWord = (form.get("exWord") as string)?.trim();
    const exBufferRaw = (form.get("exBuffer") as string)?.trim();
    const exBuffer = Math.max(1, Math.min(20, parseInt(exBufferRaw, 10) || 1));
    const type = exType === "suffix" ? "suffix" : "prefix";

    let config: BwConfig = {};
    try { config = await apiFetch<BwConfig>("/admin/bad-word-config", ctx.req); } catch { /* empty */ }
    const rawWords: (string | BwWordEntry)[] = config.words ?? [];

    if (word && exWord) {
      // Coerce target entry to object form
      const idx = rawWords.findIndex(w => (typeof w === "string" ? w : w.word) === word);
      if (idx !== -1) {
        const cur = rawWords[idx];
        const entry: BwWordEntry = typeof cur === "string"
          ? { word: cur, exclusions: [] }
          : { word: cur.word, exclusions: cur.exclusions ?? [] };
        entry.exclusions = [...(entry.exclusions ?? []), { word: exWord, buffer: exBuffer, type }];
        rawWords[idx] = entry;
        config.words = rawWords;
        try { await apiPost("/admin/bad-word-config", ctx.req, config); } catch { /* fail-safe */ }
      }
    }

    return await renderBadWordsResponse(ctx.req, { tab: "words", expandedWord: word ?? null });
  },
});
