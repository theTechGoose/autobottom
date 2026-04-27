/** GET: load a transcript snippet for a finding ID into the textarea. */
import { define } from "../../../../lib/define.ts";
import { apiFetch } from "../../../../lib/api.ts";
import { escapeHtml } from "../../../../lib/qlab-render.tsx";

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const findingId = url.searchParams.get("findingId") ?? "";
    if (!findingId) {
      return new Response(
        `<textarea id="qlab-transcript-input" name="transcript" placeholder="Paste transcript here..." class="sf-input" style="width:100%;min-height:160px;font-size:12px;font-family:var(--mono);margin-bottom:8px;"></textarea>`,
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }
    let snippet = "";
    try {
      const r = await apiFetch<{ snippet?: string; error?: string }>(
        `/api/qlab/snippet?findingId=${encodeURIComponent(findingId)}`,
        ctx.req,
      );
      snippet = r.snippet ?? "";
    } catch (_e) { /* leave empty */ }
    return new Response(
      `<textarea id="qlab-transcript-input" name="transcript" placeholder="Paste transcript here..." class="sf-input" style="width:100%;min-height:160px;font-size:12px;font-family:var(--mono);margin-bottom:8px;">${escapeHtml(snippet)}</textarea>`,
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );
  },
});
