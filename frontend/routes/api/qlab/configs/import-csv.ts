/** POST: parse the uploaded CSV (or pasted textarea) and call the backend
 *  /api/qlab/configs/import endpoint to create a config + its questions. */
import { define } from "../../../../lib/define.ts";
import { apiPost } from "../../../../lib/api.ts";
import { parseCsv, csvToQuestions } from "../../../../lib/csv.ts";

interface ImportResponse { ok?: boolean; configId?: string; imported?: number; skipped?: boolean; error?: string }

export const handler = define.handlers({
  async POST(ctx) {
    let form: FormData;
    try { form = await ctx.req.formData(); } catch (e) {
      return msg(`<span style="color:var(--red);">Invalid form payload: ${escapeHtml((e as Error).message)}</span>`);
    }

    const name = String(form.get("name") ?? "").trim();
    const type = String(form.get("type") ?? "internal");
    const dupeMode = String(form.get("dupeMode") ?? "skip");

    if (!name) return msg(`<span style="color:var(--red);">Config name is required.</span>`);

    // CSV body: file upload takes precedence, fall back to pasted textarea.
    const file = form.get("file");
    let csvText = "";
    if (file && typeof file !== "string" && file.size > 0) {
      csvText = await file.text();
    } else {
      csvText = String(form.get("csv") ?? "").trim();
    }
    if (!csvText) return msg(`<span style="color:var(--red);">Provide either a CSV file or paste CSV content.</span>`);

    let questions;
    try {
      const rows = parseCsv(csvText);
      questions = csvToQuestions(rows);
    } catch (e) {
      return msg(`<span style="color:var(--red);">CSV parse error: ${escapeHtml((e as Error).message)}</span>`);
    }
    if (questions.length === 0) {
      return msg(`<span style="color:var(--red);">No valid rows. CSV needs <code>name</code> and <code>text</code> columns.</span>`);
    }

    try {
      const r = await apiPost<ImportResponse>("/api/qlab/configs/import", ctx.req, {
        name, type, questions, dupeMode,
      });
      if (r.error) return msg(`<span style="color:var(--red);">${escapeHtml(r.error)}</span>`);
      if (r.skipped) return msg(`<span style="color:var(--yellow);">Skipped — a config named "${escapeHtml(name)}" already exists. Pick a different name or set "If Name Exists" to Overwrite.</span>`);
      const id = r.configId ?? "";
      const count = r.imported ?? questions.length;
      return msg(
        `<span style="color:var(--green);">✓ Imported ${count} question${count === 1 ? "" : "s"} into "${escapeHtml(name)}".</span>` +
        `<div style="margin-top:8px;"><a href="/question-lab?configId=${encodeURIComponent(id)}" class="sf-btn primary" style="font-size:11px;text-decoration:none;display:inline-block;">Open Config →</a></div>`
      );
    } catch (err) {
      return msg(`<span style="color:var(--red);">Import failed: ${escapeHtml((err as Error).message)}</span>`);
    }
  },
});

function msg(html: string): Response {
  return new Response(html, { headers: { "content-type": "text/html" } });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
