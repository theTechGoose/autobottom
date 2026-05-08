/** HTMX fragment — returns fresh token usage HTML for the Token Usage panel.
 *  Wrapped in a 5s per-isolate fragment cache so parallel panel polls
 *  collapse into a single backend round-trip. */
import { define } from "../../../../lib/define.ts";
import { apiFetch } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import { TokenUsagePanel, type TokenData } from "../../../../components/TokenUsagePanel.tsx";
import { withFragmentCache } from "../../../../lib/fragment-cache.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const html = await withFragmentCache("dashboard-tokens", async () => {
      let tokens: TokenData = { total_tokens: 0, prompt_tokens: 0, completion_tokens: 0, calls: 0, by_function: {} };
      try {
        tokens = await apiFetch<TokenData>("/admin/token-usage", ctx.req);
      } catch { /* use defaults */ }
      return renderToString(<TokenUsagePanel tokens={tokens} />);
    });
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
