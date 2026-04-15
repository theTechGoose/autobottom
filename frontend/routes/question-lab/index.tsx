/** Question Lab — config list, question editor, test runner. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { apiFetch } from "../../lib/api.ts";

interface QLConfig { id: string; name: string; type: string; questionCount?: number; }

export default define.page(async function QuestionLabPage(ctx) {
  const user = ctx.state.user!;

  let configs: QLConfig[] = [];
  try {
    const data = await apiFetch<{ configs: QLConfig[] }>("/api/qlab/configs", ctx.req);
    configs = data.configs ?? [];
  } catch (e) { console.error("QLab data error:", e); }

  return (
    <Layout title="Question Lab" section="admin" user={user}>
      <div class="page-header">
        <h1>Question Lab</h1>
        <p class="page-sub">Manage audit question configurations</p>
      </div>

      <div style="display:flex;gap:16px;">
        {/* Config list */}
        <div style="width:320px;flex-shrink:0;">
          <div class="card">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
              <div class="tbl-title" style="margin:0;">Configurations</div>
              <button class="btn btn-primary btn-sm" hx-post="/api/qlab/create-config" hx-swap="none">New</button>
            </div>
            {configs.length === 0 ? (
              <div style="color:var(--text-dim);font-size:12px;text-align:center;padding:20px;">No configurations yet</div>
            ) : configs.map((c) => (
              <a
                key={c.id}
                href={`/question-lab?configId=${c.id}`}
                class="qlab-config-item"
              >
                <div class="qlab-config-name">{c.name}</div>
                <div class="qlab-config-meta">
                  <span class={`pill pill-${c.type === "internal" ? "blue" : "purple"}`}>{c.type}</span>
                  <span style="font-size:10px;color:var(--text-dim);">{c.questionCount ?? 0} questions</span>
                </div>
              </a>
            ))}
          </div>
        </div>

        {/* Editor area */}
        <div style="flex:1;">
          <div class="card">
            <div style="text-align:center;color:var(--text-dim);padding:40px;">
              <div style="font-size:48px;opacity:0.3;margin-bottom:12px;">🧪</div>
              Select a configuration to edit questions, or create a new one.
              <br/><br/>
              <span style="font-size:11px;">Question editing, simulation, and test audits available per config.</span>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
});
