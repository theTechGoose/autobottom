/** POST handler: Save webhook config for a specific kind. */
import { define } from "../../../../../lib/define.ts";
import { apiPost } from "../../../../../lib/api.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const url = new URL(ctx.req.url);
    const kind = url.searchParams.get("kind") ?? "terminate";
    const form = await ctx.req.formData();

    const payload: Record<string, unknown> = {
      postUrl: form.get("postUrl") ?? "",
      testEmail: form.get("testEmail") ?? "",
      bcc: form.get("bcc") ?? "",
    };

    // Parse headers JSON
    const headersStr = (form.get("postHeaders") as string) ?? "";
    try { payload.postHeaders = headersStr ? JSON.parse(headersStr) : {}; } catch { payload.postHeaders = {}; }

    // Email template fields
    if (form.get("emailTemplateId")) payload.emailTemplateId = form.get("emailTemplateId");
    if (form.get("dismissalTemplateId")) payload.dismissalTemplateId = form.get("dismissalTemplateId");

    try {
      await apiPost(`/admin/settings/${kind}`, ctx.req, payload);
      return new Response(`<span style="font-size:11px;color:var(--green);">Saved</span>`, { headers: { "content-type": "text/html" } });
    } catch (e) {
      return new Response(`<span style="font-size:11px;color:var(--red);">Error: ${(e as Error).message}</span>`, { headers: { "content-type": "text/html" } });
    }
  },
});
