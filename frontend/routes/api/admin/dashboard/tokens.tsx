/** HTMX fragment — returns fresh token usage HTML for the Token Usage panel. */
import { define } from "../../../../lib/define.ts";
import { apiFetch } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import { TokenUsagePanel, type TokenData } from "../../../../components/TokenUsagePanel.tsx";

export const handler = define.handlers({
  async GET(ctx) {
    let tokens: TokenData = { total_tokens: 0, prompt_tokens: 0, completion_tokens: 0, calls: 0, by_function: {} };
    try {
      tokens = await apiFetch<TokenData>("/admin/token-usage", ctx.req);
    } catch { /* use defaults */ }
    const html = renderToString(<TokenUsagePanel tokens={tokens} />);
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
