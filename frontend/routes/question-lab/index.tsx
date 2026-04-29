/** Question Lab list page. Mirrors prod main:question-lab/page.ts
 *  configListPage: full-width table of every config with Mark Bulk Egregious,
 *  Import CSV, + New Config buttons in the card header. Click a row name →
 *  /question-lab/config/[id]. No sidebar; the prod-matching ✏️ Question Lab
 *  top bar provides ← Dashboard navigation. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { apiFetch } from "../../lib/api.ts";
import CsvImportWizard from "../../islands/CsvImportWizard.tsx";

interface QLConfig {
  id: string;
  name: string;
  type: "internal" | "partner";
  active?: boolean;
  createdAt?: number;
  /** Backend doesn't return question count directly — derived in this page
   *  via a per-config /api/qlab/serve fetch when totals matter. For the list
   *  view we just show the cached count from the backend if it's there. */
  questionCount?: number;
}

interface ServeResponse { questions?: unknown[] }

export default define.page(async function QuestionLabPage(ctx) {
  const user = ctx.state.user!;
  const url = new URL(ctx.req.url);

  let configs: QLConfig[] = [];
  try {
    const data = await apiFetch<{ configs: QLConfig[] }>("/api/qlab/configs", ctx.req);
    configs = data.configs ?? [];
  } catch (e) { console.error("[qlab] configs error:", e); }

  // Hydrate question counts in parallel — backend's listConfigs doesn't carry
  // the count, but the detail's serve endpoint does. Cap concurrency by
  // batching to avoid hammering Firestore.
  const counts = await Promise.all(configs.map(async (c) => {
    try {
      const r = await apiFetch<ServeResponse>(`/api/qlab/serve?name=${encodeURIComponent(c.id)}`, ctx.req);
      return r.questions?.length ?? 0;
    } catch { return 0; }
  }));
  configs = configs.map((c, i) => ({ ...c, questionCount: counts[i] }));

  return (
    <Layout title="Question Lab" section="admin" user={user} pathname={url.pathname} hideSidebar>
      <div class="ql-topbar">
        <div class="ql-topbar-title">
          <span class="ql-topbar-icon" aria-hidden="true">✏️</span>
          <h1>Question Lab</h1>
        </div>
        <a href="/admin/dashboard" class="ql-topbar-back">← Dashboard</a>
      </div>

      <div class="ql-page-body">
        <div class="page-header" style="margin-bottom:14px;">
          <h1 style="font-size:22px;margin:0 0 4px;">Question Lab</h1>
          <p class="page-sub" style="margin:0;">Manage audit question configurations for internal and partner audits.</p>
        </div>

        <div class="card">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px;">
            <div class="tbl-title" style="margin:0;">Configurations</div>
            <div style="display:flex;gap:8px;align-items:center;">
              <button
                class="sf-btn danger"
                style="font-size:11px;"
                hx-get="/api/qlab/configs/bulk-egregious-form"
                hx-target="#qlab-action-panel"
                hx-swap="innerHTML"
              >Mark Bulk Egregious</button>
              <CsvImportWizard />
              <details class="qlab-new-details">
                <summary class="sf-btn primary" style="font-size:11px;cursor:pointer;list-style:none;">+ New Config</summary>
                <form
                  class="qlab-new-form"
                  hx-post="/api/qlab/configs/create"
                  hx-target="#qlab-new-msg"
                  hx-swap="innerHTML"
                >
                  <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-bottom:6px;">
                    <div style="flex:1;min-width:220px;">
                      <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.8px;">Config Name</label>
                      <input class="sf-input" name="name" type="text" required placeholder="e.g. WYN — New Orleans, LA" style="width:100%;font-size:12px;" />
                    </div>
                    <div>
                      <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.8px;">Type</label>
                      <select class="sf-input" name="type" style="font-size:12px;">
                        <option value="internal">Internal</option>
                        <option value="partner">Partner</option>
                      </select>
                    </div>
                    <button type="submit" class="sf-btn primary" style="font-size:11px;">Create</button>
                  </div>
                  <div id="qlab-new-msg" style="font-size:11px;color:var(--text-dim);"></div>
                </form>
              </details>
            </div>
          </div>

          <div id="qlab-action-panel"></div>

          {configs.length === 0 ? (
            <div style="text-align:center;color:var(--text-dim);padding:30px;font-size:13px;">No configurations yet. Create one to get started.</div>
          ) : (
            <form
              id="qlab-bulk"
              hx-post="/api/qlab/configs/bulk-delete"
              hx-confirm="Delete the selected configs and all their questions? This cannot be undone."
              hx-target="body"
              hx-push-url="/question-lab"
            >
              <table class="data-table" style="width:100%;font-size:12px;">
                <thead>
                  <tr style="text-align:left;color:var(--text-dim);font-size:10px;text-transform:uppercase;letter-spacing:1px;">
                    <th style="padding:8px 10px;width:24px;"></th>
                    <th style="padding:8px 10px;">Name</th>
                    <th style="padding:8px 10px;">Type</th>
                    <th style="padding:8px 10px;">Status</th>
                    <th style="padding:8px 10px;">Questions</th>
                    <th style="padding:8px 10px;">Created</th>
                    <th style="padding:8px 10px;text-align:right;">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {configs.map((c) => (
                    <tr key={c.id} style="border-top:1px solid var(--border);">
                      <td style="padding:8px 10px;">
                        <input type="checkbox" name="ids" value={c.id} aria-label={`Select ${c.name}`} style="width:16px;height:16px;cursor:pointer;" />
                      </td>
                      <td style="padding:8px 10px;">
                        <a href={`/question-lab/config/${c.id}`} class="tbl-link" style="font-weight:600;color:var(--blue);">{c.name}</a>
                      </td>
                      <td style="padding:8px 10px;">
                        <span class={`pill ${c.type === "partner" ? "pill-orange" : "pill-blue"}`}>{c.type}</span>
                      </td>
                      <td style="padding:8px 10px;">
                        <StatusPill id={c.id} active={c.active ?? true} />
                      </td>
                      <td style="padding:8px 10px;color:var(--text-dim);">{c.questionCount ?? 0} question{(c.questionCount ?? 0) === 1 ? "" : "s"}</td>
                      <td style="padding:8px 10px;color:var(--text-dim);">{c.createdAt ? new Date(c.createdAt).toLocaleDateString("en-US", { timeZone: "America/New_York" }) : "—"}</td>
                      <td style="padding:8px 10px;text-align:right;">
                        <button
                          class="sf-btn"
                          type="button"
                          style="font-size:10px;margin-right:4px;"
                          hx-post={`/api/qlab/configs/clone?id=${c.id}`}
                          hx-target="body"
                          hx-push-url="/question-lab"
                          title="Clone"
                        >Clone</button>
                        <button
                          class="sf-btn danger"
                          type="button"
                          style="font-size:10px;"
                          hx-post={`/api/qlab/configs/delete?id=${c.id}`}
                          hx-confirm={`Delete "${c.name}" and all its questions?`}
                          hx-target="body"
                          hx-push-url="/question-lab"
                        >Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px;gap:8px;flex-wrap:wrap;">
                <button
                  type="submit"
                  class="sf-btn danger"
                  style="font-size:11px;"
                >Delete selected</button>
                <button
                  type="button"
                  class="sf-btn danger"
                  style="font-size:11px;background:var(--red);color:#fff;border-color:var(--red);"
                  hx-post="/api/qlab/configs/bulk-delete?all=1"
                  hx-confirm={`PERMANENTLY delete ALL ${configs.length} configs and every question they contain? Type-confirm in the next dialog.`}
                  hx-prompt="Type DELETE ALL to confirm"
                  hx-target="body"
                  hx-push-url="/question-lab"
                >Delete ALL configs</button>
              </div>
            </form>
          )}
        </div>
      </div>
    </Layout>
  );
});

function StatusPill({ id, active }: { id: string; active: boolean }) {
  const cls = active ? "pill-green" : "pill-red";
  const label = active ? "active" : "inactive";
  return (
    <button
      type="button"
      class={`pill ${cls}`}
      style="cursor:pointer;border:none;font-family:inherit;"
      hx-post={`/api/qlab/configs/toggle-active?id=${id}`}
      hx-target="this"
      hx-swap="outerHTML"
      title="Click to toggle"
    >{label}</button>
  );
}
