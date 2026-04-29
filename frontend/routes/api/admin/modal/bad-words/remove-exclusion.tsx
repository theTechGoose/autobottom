/** POST: Remove an exclusion rule (by index) from a word entry, save config, return refreshed words tab. */
import { define } from "../../../../../lib/define.ts";
import { apiFetch, apiPost } from "../../../../../lib/api.ts";
import { renderBadWordsResponse, type BwConfig, type BwWordEntry } from "../bad-words.tsx";

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const word = (form.get("word") as string)?.trim();
    const exIndexRaw = (form.get("exIndex") as string)?.trim();
    const exIndex = parseInt(exIndexRaw, 10);

    let config: BwConfig = {};
    try { config = await apiFetch<BwConfig>("/admin/bad-word-config", ctx.req); } catch { /* empty */ }
    const rawWords: (string | BwWordEntry)[] = config.words ?? [];

    if (word && Number.isInteger(exIndex) && exIndex >= 0) {
      const idx = rawWords.findIndex(w => (typeof w === "string" ? w : w.word) === word);
      if (idx !== -1) {
        const cur = rawWords[idx];
        if (typeof cur !== "string" && cur.exclusions && exIndex < cur.exclusions.length) {
          const next = [...cur.exclusions];
          next.splice(exIndex, 1);
          rawWords[idx] = { word: cur.word, exclusions: next };
          config.words = rawWords;
          try { await apiPost("/admin/bad-word-config", ctx.req, config); } catch { /* fail-safe */ }
        }
      }
    }

    return await renderBadWordsResponse(ctx.req, { tab: "words", expandedWord: word ?? null });
  },
});
