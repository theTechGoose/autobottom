/** POST: kick off an isolated test audit for a config + record ID.
 *  Returns a status fragment that polls /api/qlab/test-status?id=<findingId>
 *  every 2s until the audit finishes. Mirrors prod's runTestAudit JS but as
 *  HTMX so we don't need a client-side island. */
import { define } from "../../../../lib/define.ts";
import { apiPost } from "../../../../lib/api.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const configName = String(form.get("configName") ?? "").trim();
    const rid = String(form.get("rid") ?? "").trim();
    const type = String(form.get("type") ?? "internal");
    const recipientsRaw = String(form.get("emails") ?? "").trim();
    const testEmailRecipients = recipientsRaw
      ? recipientsRaw.split(/[\s,]+/).map((e) => e.trim()).filter(Boolean)
      : undefined;

    if (!configName) return err("Config name missing.");
    if (!rid) return err("Enter a Record ID.");

    try {
      const r = await apiPost<{ ok?: boolean; findingId?: string; error?: string }>(
        "/api/qlab/test-audit",
        ctx.req,
        {
          configName,
          rid,
          recordingIdField: type === "partner" ? "GenieNumber" : "VoGenie",
          testEmailRecipients,
        },
      );
      if (r.error) return err(r.error);
      const fid = r.findingId ?? "";
      if (!fid) return err("Backend did not return a findingId.");
      return new Response(pollingFragment(fid, "starting…"), { headers: { "content-type": "text/html" } });
    } catch (e) {
      return err((e as Error).message);
    }
  },
});

function pollingFragment(findingId: string, label: string): string {
  return `<div id="qlab-test-status"
    hx-get="/api/qlab/configs/test-status?id=${encodeURIComponent(findingId)}"
    hx-trigger="load delay:2s"
    hx-swap="outerHTML"
    style="display:flex;align-items:center;gap:8px;font-size:11px;color:var(--text-muted);"
  >
    <span class="qlab-spinner"></span>
    <span>${label} (fid: <code style="font-family:var(--mono);">${findingId}</code>)</span>
  </div>`;
}

function err(text: string): Response {
  return new Response(
    `<div id="qlab-test-status" style="font-size:11px;color:var(--red);">${text}</div>`,
    { headers: { "content-type": "text/html" } },
  );
}
