/** GET: poll the status of a running test audit by finding ID. Returns
 *  a fragment that either keeps polling (audit pending) OR renders the
 *  final state (audit finished/failed). HTMX consumes this for the
 *  /question-lab/config/[id] Run Test Audit panel. */
import { define } from "../../../../lib/define.ts";
import { apiFetch } from "../../../../lib/api.ts";

interface Finding {
  id?: string;
  findingStatus?: string;
  errorMessage?: string;
  answeredQuestions?: unknown[];
}

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const id = String(url.searchParams.get("id") ?? "").trim();
    if (!id) return frag(`<div id="qlab-test-status" style="color:var(--red);font-size:11px;">missing id</div>`);

    try {
      const finding = await apiFetch<Finding>(`/audit/finding?id=${encodeURIComponent(id)}`, ctx.req);
      const status = finding?.findingStatus ?? "pending";
      if (status === "finished") return frag(doneFragment(id));
      if (status === "error" || status === "failed") {
        return frag(errorFragment(id, finding?.errorMessage ?? "unknown error"));
      }
      // Still running — emit another polling iteration.
      return frag(pollingFragment(id, status));
    } catch (e) {
      return frag(errorFragment(id, (e as Error).message));
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
    <span>${escapeHtml(label)} (fid: <code style="font-family:var(--mono);">${findingId}</code>)</span>
  </div>`;
}

function doneFragment(findingId: string): string {
  return `<div id="qlab-test-status" style="display:flex;align-items:center;gap:10px;font-size:11px;">
    <span style="color:var(--green);font-weight:600;">✓ done</span>
    <code style="font-family:var(--mono);color:var(--text-dim);">${findingId}</code>
    <a href="/audit/report?id=${encodeURIComponent(findingId)}" target="_blank" class="sf-btn primary" style="font-size:10px;text-decoration:none;">View Report →</a>
  </div>`;
}

function errorFragment(findingId: string, message: string): string {
  return `<div id="qlab-test-status" style="font-size:11px;color:var(--red);">
    ✗ ${escapeHtml(message)} <code style="font-family:var(--mono);color:var(--text-dim);">${findingId}</code>
  </div>`;
}

function frag(html: string): Response {
  return new Response(html, { headers: { "content-type": "text/html" } });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
