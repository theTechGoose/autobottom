/** Question Lab — config detail page. Mirrors prod main:question-lab/page.ts
 *  configDetailPage: three stacked cards (Config Settings → Run Test Audit →
 *  Questions) on a full-width page, no sidebar. Click a question name →
 *  /question-lab/question/[id] for the full editor.
 *
 *  All interactivity is HTMX — no client JS. The Run Test Audit panel
 *  kicks off a backend test-audit and polls /api/qlab/configs/test-status
 *  every 2s until the finding finishes (or errors). */
import { define } from "../../../lib/define.ts";
import { Layout } from "../../../components/Layout.tsx";
import { apiFetch } from "../../../lib/api.ts";

interface QLConfig {
  id: string;
  name: string;
  type: "internal" | "partner";
  active?: boolean;
  testEmailRecipients?: string[];
}
interface QLQuestion {
  id: string;
  configId: string;
  name: string;
  text: string;
  autoYesExp?: string;
  egregious?: boolean;
  weight?: number;
  numDocs?: number;
  temperature?: number;
  order?: number;
}
interface QLTestRun {
  id: string;
  configId: string;
  questionId: string;
  result: "pass" | "fail";
  expectedAnswer: string;
  actualAnswer: string;
  runAt: number;
}

export default define.page(async function ConfigDetailPage(ctx) {
  const user = ctx.state.user!;
  const url = new URL(ctx.req.url);
  const id = (ctx.params as { id?: string }).id ?? "";

  let config: QLConfig | null = null;
  let questions: QLQuestion[] = [];
  let testRuns: QLTestRun[] = [];

  try {
    const data = await apiFetch<{ config: QLConfig; questions: QLQuestion[] }>(
      `/api/qlab/serve?name=${encodeURIComponent(id)}`,
      ctx.req,
    );
    config = data.config ?? null;
    questions = (data.questions ?? []).slice().sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0),
    );
  } catch (e) { console.error("[qlab/detail] load error:", e); }

  if (config) {
    try {
      const r = await apiFetch<{ runs: QLTestRun[] }>(
        `/api/qlab/test-runs?configId=${encodeURIComponent(config.id)}&limit=20`,
        ctx.req,
      );
      testRuns = r.runs ?? [];
    } catch { /* ignore — section just renders empty */ }
  }

  return (
    <Layout title={config?.name ?? "Config"} section="admin" user={user} pathname={url.pathname} hideSidebar>
      <div class="ql-topbar">
        <div class="ql-topbar-title">
          <span class="ql-topbar-icon" aria-hidden="true">✏️</span>
          <h1>Question Lab</h1>
          <span style="color:var(--text-dim);font-weight:400;font-size:13px;margin-left:8px;">
            <a href="/question-lab" style="color:var(--text-muted);text-decoration:none;">Question Lab</a>
            <span style="margin:0 6px;color:var(--text-dim);">/</span>
            <span style="color:var(--text-bright);">{config?.name ?? "—"}</span>
          </span>
        </div>
        <a href="/admin/dashboard" class="ql-topbar-back">← Dashboard</a>
      </div>

      <div class="ql-page-body">
        {!config ? (
          <div class="card" style="text-align:center;color:var(--text-dim);padding:40px;">Config not found.</div>
        ) : (
          <>
            <ConfigHeader config={config} />
            <ConfigSettings config={config} />
            <RunTestAuditCard config={config} runs={testRuns} questions={questions} />
            <QuestionsCard config={config} questions={questions} />
          </>
        )}
      </div>
    </Layout>
  );
});

function ConfigHeader({ config }: { config: QLConfig }) {
  return (
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
      <h1 style="margin:0;font-size:22px;">{config.name}</h1>
      <span class="pill pill-blue">Config</span>
      <button
        class="sf-btn"
        style="font-size:11px;"
        hx-post={`/api/qlab/configs/clone?id=${config.id}`}
        hx-target="body"
        hx-push-url="/question-lab"
        title="Clone this config"
      >Clone</button>
    </div>
  );
}

function ConfigSettings({ config }: { config: QLConfig }) {
  return (
    <div class="card" style="margin-bottom:16px;">
      <div class="tbl-title" style="margin-bottom:12px;">Config Settings</div>

      <form
        hx-post="/api/qlab/configs/field"
        hx-target="#cfg-name-msg"
        hx-swap="innerHTML"
        style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end;margin-bottom:14px;"
      >
        <input type="hidden" name="id" value={config.id} />
        <input type="hidden" name="field" value="name" />
        <div>
          <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.8px;">Config Name</label>
          <input class="sf-input" type="text" name="value" value={config.name} required style="width:100%;font-size:12px;" />
        </div>
        <button type="submit" class="sf-btn primary" style="font-size:11px;">Save</button>
      </form>
      <div id="cfg-name-msg" style="font-size:11px;margin-bottom:12px;"></div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
        <div>
          <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.8px;">Type</label>
          <div style="display:flex;gap:4px;">
            <TypeButton id={config.id} value="internal" active={config.type !== "partner"} />
            <TypeButton id={config.id} value="partner" active={config.type === "partner"} />
          </div>
          <div id="cfg-type-msg" style="font-size:11px;margin-top:4px;"></div>
        </div>
        <div>
          <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.8px;">Active</label>
          <ActiveButton id={config.id} active={config.active ?? true} />
        </div>
      </div>
    </div>
  );
}

function TypeButton({ id, value, active }: { id: string; value: "internal" | "partner"; active: boolean }) {
  const label = value === "partner" ? "Partner" : "Internal";
  return (
    <form
      hx-post="/api/qlab/configs/field"
      hx-target="#cfg-type-msg"
      hx-swap="innerHTML"
      style="display:inline;"
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="field" value="type" />
      <input type="hidden" name="value" value={value} />
      <button type="submit" class={`sf-btn ${active ? "primary" : ""}`} style="font-size:11px;" disabled={active}>{label}</button>
    </form>
  );
}

function ActiveButton({ id, active }: { id: string; active: boolean }) {
  const cls = active ? "pill-green" : "pill-red";
  const label = active ? "● Active" : "○ Inactive";
  return (
    <button
      type="button"
      class={`pill ${cls}`}
      style="cursor:pointer;border:none;font-family:inherit;font-size:11px;padding:4px 12px;"
      hx-post={`/api/qlab/configs/toggle-active?id=${id}`}
      hx-target="this"
      hx-swap="outerHTML"
      title="Click to toggle"
    >{label}</button>
  );
}

function RunTestAuditCard({ config, runs }: { config: QLConfig; runs: QLTestRun[]; questions: QLQuestion[] }) {
  const emails = (config.testEmailRecipients ?? ["ai@monsterrg.com"]).join(", ");
  return (
    <div class="card" style="margin-bottom:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <div class="tbl-title" style="margin:0;">🧪 Run Test Audit</div>
        <span style="font-size:11px;color:var(--text-dim);">Isolated — no live data affected</span>
      </div>

      <form
        hx-post="/api/qlab/configs/test-audit"
        hx-target="#qlab-test-status"
        hx-swap="outerHTML"
      >
        <input type="hidden" name="configName" value={config.name} />
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
          <div>
            <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.8px;">Record ID (RID)</label>
            <input class="sf-input" type="text" name="rid" placeholder="e.g. 12345678" required style="width:100%;font-size:12px;font-family:var(--mono);" />
          </div>
          <div>
            <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.8px;">Audit Type</label>
            <div style="display:flex;gap:4px;">
              <label style="flex:1;"><input type="radio" name="type" value="internal" checked style="margin-right:6px;" />Internal</label>
              <label style="flex:1;"><input type="radio" name="type" value="partner" style="margin-right:6px;" />Partner</label>
            </div>
          </div>
        </div>
        <div style="margin-bottom:12px;">
          <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.8px;">Email Recipients (comma-separated)</label>
          <div style="display:flex;gap:8px;">
            <input class="sf-input" type="text" name="emails" value={emails} style="flex:1;font-size:12px;" />
            <button
              type="button"
              class="sf-btn"
              style="font-size:11px;"
              hx-post="/api/qlab/configs/field"
              hx-include="closest form"
              hx-vals={`{"id":"${config.id}","field":"testEmailRecipients"}`}
              hx-target="#cfg-emails-msg"
              hx-swap="innerHTML"
            >Save</button>
          </div>
          <div id="cfg-emails-msg" style="font-size:11px;margin-top:4px;"></div>
        </div>
        <button type="submit" class="sf-btn" style="background:var(--green);color:#fff;font-size:12px;font-weight:600;padding:8px 16px;">▶ Run Test Audit</button>
      </form>

      <div id="qlab-test-status" style="margin-top:12px;font-size:11px;color:var(--text-dim);min-height:18px;"></div>

      {runs.length > 0 && (
        <div style="margin-top:18px;">
          <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;font-weight:600;margin-bottom:6px;">Recent Test Runs</div>
          <table class="data-table" style="width:100%;font-size:11px;">
            <thead>
              <tr>
                <th style="padding:6px 8px;">Finding ID</th>
                <th style="padding:6px 8px;">Question</th>
                <th style="padding:6px 8px;">Result</th>
                <th style="padding:6px 8px;">When</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td style="padding:6px 8px;font-family:var(--mono);">
                    <a href={`/audit/report?id=${r.id}`} class="tbl-link">{r.id.slice(0, 12)}…</a>
                  </td>
                  <td style="padding:6px 8px;color:var(--text-dim);">{r.questionId.slice(0, 12)}…</td>
                  <td style="padding:6px 8px;">
                    <span class={`pill ${r.result === "pass" ? "pill-green" : "pill-red"}`}>{r.result}</span>
                  </td>
                  <td style="padding:6px 8px;color:var(--text-dim);">{new Date(r.runAt).toLocaleString("en-US", { timeZone: "America/New_York" })}</td>
                  <td style="padding:6px 8px;text-align:right;">
                    <a href={`/audit/report?id=${r.id}`} target="_blank" class="sf-btn ghost" style="font-size:10px;">Report</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function QuestionsCard({ config, questions }: { config: QLConfig; questions: QLQuestion[] }) {
  return (
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <div>
          <div class="tbl-title" style="margin-bottom:2px;">Questions <span style="font-weight:400;color:var(--text-dim);font-size:13px;">({questions.length})</span></div>
        </div>
        <details class="qlab-new-details">
          <summary class="sf-btn primary" style="font-size:11px;cursor:pointer;list-style:none;">+ Add Question</summary>
          <form
            class="qlab-new-form"
            hx-post="/api/qlab/questions/create"
            hx-target="body"
            hx-push-url={`/question-lab/config/${config.id}`}
            style="width:520px;"
          >
            <input type="hidden" name="configId" value={config.id} />
            <div style="margin-bottom:8px;">
              <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.8px;">Question Name (short label)</label>
              <input class="sf-input" type="text" name="name" required placeholder="e.g. Disclosure Check" style="width:100%;font-size:12px;" />
            </div>
            <div style="margin-bottom:8px;">
              <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.8px;">Question Text</label>
              <textarea class="sf-input" name="text" required rows={3} style="width:100%;font-size:12px;font-family:var(--mono);"></textarea>
            </div>
            <button type="submit" class="sf-btn primary" style="font-size:11px;">Add</button>
          </form>
        </details>
      </div>

      {questions.length === 0 ? (
        <div style="text-align:center;color:var(--text-dim);font-size:13px;padding:24px;">No questions yet. Click "+ Add Question".</div>
      ) : (
        <table class="data-table" style="width:100%;font-size:12px;">
          <thead>
            <tr style="text-align:left;color:var(--text-dim);font-size:10px;text-transform:uppercase;letter-spacing:1px;">
              <th style="padding:8px;">Name</th>
              <th style="padding:8px;">Text</th>
              <th style="padding:8px;width:90px;">Egregious</th>
              <th style="padding:8px;width:60px;">Weight</th>
              <th style="padding:8px;width:60px;">Docs</th>
              <th style="padding:8px;width:60px;">Temp</th>
              <th style="padding:8px;width:80px;text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            {questions.map((q) => <QuestionRow key={q.id} q={q} />)}
          </tbody>
        </table>
      )}
    </div>
  );
}

function QuestionRow({ q }: { q: QLQuestion }) {
  return (
    <tr style="border-top:1px solid var(--border);">
      <td style="padding:8px;">
        <a href={`/question-lab/question/${q.id}`} class="tbl-link" style="font-weight:600;">{q.name}</a>
      </td>
      <td style="padding:8px;color:var(--text-dim);max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
        {q.text.length > 90 ? q.text.slice(0, 90) + "…" : q.text}
      </td>
      <td style="padding:8px;">
        <EgregiousToggle id={q.id} egregious={!!q.egregious} />
      </td>
      <td style="padding:8px;"><FieldInput id={q.id} field="weight" value={q.weight ?? 5} min={1} max={100} step={1} /></td>
      <td style="padding:8px;"><FieldInput id={q.id} field="numDocs" value={q.numDocs ?? 4} min={1} max={10} step={1} /></td>
      <td style="padding:8px;"><FieldInput id={q.id} field="temperature" value={q.temperature ?? 0.8} min={0} max={1} step={0.1} /></td>
      <td style="padding:8px;text-align:right;">
        <button
          class="sf-btn danger"
          style="font-size:10px;"
          hx-post={`/api/qlab/questions/delete?id=${q.id}`}
          hx-confirm={`Delete "${q.name}"?`}
          hx-target="closest tr"
          hx-swap="outerHTML"
        >Delete</button>
      </td>
    </tr>
  );
}

function EgregiousToggle({ id, egregious }: { id: string; egregious: boolean }) {
  const cls = egregious ? "pill-red" : "pill-blue";
  const label = egregious ? "egregious" : "normal";
  const next = egregious ? "false" : "true";
  return (
    <form
      hx-post="/api/qlab/questions/field"
      hx-target={`#qmsg-${id}`}
      hx-swap="innerHTML"
      style="display:inline;"
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="field" value="egregious" />
      <input type="hidden" name="value" value={next} />
      <button type="submit" class={`pill ${cls}`} style="cursor:pointer;border:none;font-family:inherit;">{label}</button>
      <span id={`qmsg-${id}`} style="margin-left:6px;font-size:10px;"></span>
    </form>
  );
}

function FieldInput({ id, field, value, min, max, step }: { id: string; field: "weight" | "numDocs" | "temperature"; value: number; min: number; max: number; step: number }) {
  return (
    <form
      hx-post="/api/qlab/questions/field"
      hx-trigger="change from:find input"
      hx-target={`#qmsg-${id}-${field}`}
      hx-swap="innerHTML"
      style="display:inline-flex;align-items:center;gap:4px;"
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="field" value={field} />
      <input
        class="sf-input"
        type="number"
        name="value"
        value={String(value)}
        min={min}
        max={max}
        step={step}
        style="width:54px;font-size:11px;padding:2px 4px;text-align:center;"
      />
      <span id={`qmsg-${id}-${field}`} style="font-size:10px;color:var(--green);min-width:0;"></span>
    </form>
  );
}
