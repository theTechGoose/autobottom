/** Question Lab — config list, question editor, test runner. Two-pane layout. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { apiFetch } from "../../lib/api.ts";

interface QLConfig {
  id: string; name: string; type: "internal" | "partner";
  testEmailRecipients?: string[];
}

interface QLQuestion {
  id: string; configId: string; name: string; text: string;
  autoYesExp?: string; egregious?: boolean;
  temperature?: number; numDocs?: number; weight?: number;
  order?: number; updatedAt: number;
}

interface QLTestRun {
  id: string; configId: string; questionId: string;
  result: "pass" | "fail";
  expectedAnswer: string; actualAnswer: string;
  thinking?: string; defense?: string; runAt: number;
}

function pillForType(type: string) {
  return type === "internal" ? "pill-blue" : "pill-purple";
}

function fmtAge(ts: number): string {
  const ms = Date.now() - ts;
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default define.page(async function QuestionLabPage(ctx) {
  const user = ctx.state.user!;
  const url = new URL(ctx.req.url);
  const activeConfigId = url.searchParams.get("configId") ?? "";
  const tab = url.searchParams.get("tab") ?? "questions";

  let configs: QLConfig[] = [];
  let activeConfig: QLConfig | null = null;
  let questions: QLQuestion[] = [];
  let testRuns: QLTestRun[] = [];

  try {
    const data = await apiFetch<{ configs: QLConfig[] }>("/api/qlab/configs", ctx.req);
    configs = data.configs ?? [];
  } catch (e) { console.error("[qlab] configs error:", e); }

  if (activeConfigId) {
    activeConfig = configs.find((c) => c.id === activeConfigId) ?? null;
    if (activeConfig) {
      try {
        const served = await apiFetch<{ config: QLConfig; questions: QLQuestion[] }>(
          `/api/qlab/serve?name=${encodeURIComponent(activeConfig.id)}`,
          ctx.req,
        );
        questions = (served.questions ?? []).slice().sort(
          (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.updatedAt - b.updatedAt,
        );
      } catch (e) { console.error("[qlab] questions error:", e); }
      if (tab === "history") {
        try {
          const r = await apiFetch<{ runs: QLTestRun[] }>(
            `/api/qlab/test-runs?configId=${encodeURIComponent(activeConfig.id)}&limit=100`,
            ctx.req,
          );
          testRuns = r.runs ?? [];
        } catch (e) { console.error("[qlab] runs error:", e); }
      }
    }
  }

  const totalQuestions = questions.length;
  const egregiousCount = questions.filter((q) => q.egregious).length;

  return (
    <Layout title="Question Lab" section="admin" user={user} pathname={url.pathname} hideSidebar>
      <div class="ql-topbar">
        <div class="ql-topbar-title">
          <span class="ql-topbar-icon" aria-hidden="true">✏️</span>
          <h1>Question Lab</h1>
        </div>
        <a href="/admin/dashboard" class="ql-topbar-back">← Dashboard</a>
      </div>

      <div class="ql-page-body" style="display:flex;gap:16px;align-items:flex-start;">
        {/* Config sidebar */}
        <div style="width:280px;flex-shrink:0;">
          <div class="card">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
              <div class="tbl-title" style="margin:0;">Configurations</div>
              <button
                class="sf-btn primary"
                style="font-size:10px;"
                hx-post="/api/qlab/configs/new"
                hx-target="#qlab-config-list"
                hx-swap="outerHTML"
              >+ New</button>
            </div>
            <div id="qlab-config-list">
              {configs.length === 0 ? (
                <div style="color:var(--text-dim);font-size:12px;text-align:center;padding:20px;">
                  No configurations yet
                </div>
              ) : configs.map((c) => (
                <a
                  key={c.id}
                  href={`/question-lab?configId=${c.id}`}
                  class="qlab-config-item"
                  style={c.id === activeConfigId
                    ? "background:var(--bg-surface);border-color:var(--accent);"
                    : ""}
                >
                  <div class="qlab-config-name">{c.name}</div>
                  <div class="qlab-config-meta">
                    <span class={`pill ${pillForType(c.type)}`}>{c.type}</span>
                  </div>
                </a>
              ))}
            </div>
          </div>

          {activeConfig && (
            <div class="card" style="margin-top:12px;">
              <div class="tbl-title" style="margin-bottom:8px;">Config Actions</div>
              <form
                hx-post="/api/qlab/configs/rename"
                hx-target="#qlab-config-list"
                hx-swap="outerHTML"
                style="display:flex;gap:6px;margin-bottom:8px;"
              >
                <input type="hidden" name="id" value={activeConfig.id} />
                <input class="sf-input" name="name" type="text" value={activeConfig.name} style="flex:1;font-size:11px;" />
                <button type="submit" class="sf-btn primary" style="font-size:10px;">Rename</button>
              </form>
              <button
                class="sf-btn"
                style="width:100%;margin-bottom:6px;font-size:10px;"
                hx-post={`/api/qlab/configs/clone?id=${activeConfig.id}`}
                hx-target="#qlab-config-list"
                hx-swap="outerHTML"
              >Clone</button>
              <button
                class="sf-btn danger"
                style="width:100%;font-size:10px;"
                hx-post={`/api/qlab/configs/delete?id=${activeConfig.id}`}
                hx-confirm={`Delete "${activeConfig.name}" and all its questions?`}
                hx-target="body"
                hx-push-url="/question-lab"
              >Delete Config</button>
            </div>
          )}
        </div>

        {/* Main panel */}
        <div style="flex:1;min-width:0;">
          {!activeConfig ? (
            <div class="card">
              <div style="text-align:center;color:var(--text-dim);padding:60px 20px;">
                <div style="font-size:48px;opacity:0.3;margin-bottom:12px;">QL</div>
                Select a configuration on the left, or create a new one.
              </div>
            </div>
          ) : (
            <>
              {/* Tabs */}
              <div style="display:flex;gap:4px;margin-bottom:12px;border-bottom:1px solid var(--border);">
                {[
                  { id: "questions", label: `Questions (${totalQuestions})` },
                  { id: "runner", label: "Test Runner" },
                  { id: "history", label: "Test History" },
                  { id: "assignments", label: "Assignments" },
                ].map((t) => (
                  <a
                    key={t.id}
                    href={`/question-lab?configId=${activeConfigId}&tab=${t.id}`}
                    style={`padding:8px 14px;font-size:12px;font-weight:600;text-decoration:none;border-bottom:2px solid ${
                      tab === t.id ? "var(--accent)" : "transparent"
                    };color:${tab === t.id ? "var(--text-bright)" : "var(--text-muted)"};`}
                  >{t.label}</a>
                ))}
              </div>

              {tab === "questions" && (
                <QuestionsPanel
                  configId={activeConfigId}
                  questions={questions}
                  egregiousCount={egregiousCount}
                />
              )}
              {tab === "runner" && (
                <TestRunnerPanel
                  configId={activeConfigId}
                  questions={questions}
                />
              )}
              {tab === "history" && (
                <HistoryPanel
                  configId={activeConfigId}
                  runs={testRuns}
                  questions={questions}
                />
              )}
              {tab === "assignments" && (
                <AssignmentsPanel
                  configId={activeConfigId}
                  configName={activeConfig.name}
                  configType={activeConfig.type}
                />
              )}
            </>
          )}
        </div>
      </div>
    </Layout>
  );
});

function QuestionsPanel(props: {
  configId: string;
  questions: QLQuestion[];
  egregiousCount: number;
}) {
  return (
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <div>
          <div class="tbl-title" style="margin-bottom:2px;">Questions</div>
          <div style="font-size:11px;color:var(--text-dim);">
            {props.questions.length} total{" "}
            {props.egregiousCount > 0 && (
              <span style="color:var(--red);">· {props.egregiousCount} egregious</span>
            )}
          </div>
        </div>
        <button
          class="sf-btn primary"
          style="font-size:11px;"
          hx-get={`/api/qlab/questions/new?configId=${props.configId}`}
          hx-target="#qlab-q-editor"
          hx-swap="innerHTML"
        >+ Add Question</button>
      </div>

      <div id="qlab-q-editor" style="margin-bottom:14px;"></div>

      {props.questions.length === 0 ? (
        <div style="color:var(--text-dim);font-size:12px;text-align:center;padding:24px;">
          No questions yet — click "+ Add Question" above.
        </div>
      ) : (
        <table class="data-table" style="width:100%;font-size:12px;">
          <thead>
            <tr style="text-align:left;color:var(--text-dim);font-size:10px;text-transform:uppercase;letter-spacing:1px;">
              <th style="padding:6px 8px;width:40px;">#</th>
              <th style="padding:6px 8px;">Header</th>
              <th style="padding:6px 8px;">Auto-Yes</th>
              <th style="padding:6px 8px;width:90px;">Flags</th>
              <th style="padding:6px 8px;width:160px;text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            {props.questions.map((q, i) => (
              <tr key={q.id} style="border-top:1px solid var(--border);">
                <td style="padding:8px;color:var(--text-dim);font-family:var(--mono);">{i + 1}</td>
                <td style="padding:8px;">
                  <div style="font-weight:600;color:var(--text-bright);">{q.name}</div>
                  <div style="color:var(--text-dim);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:380px;">
                    {q.text.slice(0, 110)}{q.text.length > 110 ? "..." : ""}
                  </div>
                </td>
                <td style="padding:8px;font-family:var(--mono);font-size:10px;color:var(--cyan);max-width:160px;overflow:hidden;text-overflow:ellipsis;">
                  {q.autoYesExp || ""}
                </td>
                <td style="padding:8px;">
                  {q.egregious && (
                    <span class="pill" style="background:var(--red-bg);color:var(--red);">egr</span>
                  )}
                </td>
                <td style="padding:8px;text-align:right;">
                  <button
                    class="sf-btn"
                    style="font-size:10px;margin-right:4px;"
                    hx-get={`/api/qlab/questions/edit?id=${q.id}`}
                    hx-target="#qlab-q-editor"
                    hx-swap="innerHTML"
                  >Edit</button>
                  <button
                    class="sf-btn danger"
                    style="font-size:10px;"
                    hx-post={`/api/qlab/questions/delete?id=${q.id}&configId=${props.configId}`}
                    hx-confirm={`Delete question "${q.name}"?`}
                    hx-target="body"
                    hx-push-url={`/question-lab?configId=${props.configId}`}
                  >Del</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function TestRunnerPanel(props: {
  configId: string;
  questions: QLQuestion[];
}) {
  return (
    <div class="card">
      <div class="tbl-title" style="margin-bottom:8px;">Test Runner</div>
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:12px;">
        Pick a question, paste a transcript, run it. Save the result as pass / fail to record a test run.
      </div>

      <form
        hx-post="/api/qlab/runner/simulate"
        hx-target="#qlab-runner-result"
        hx-swap="innerHTML"
        hx-indicator="#qlab-runner-spinner"
      >
        <input type="hidden" name="configId" value={props.configId} />
        <div style="display:flex;gap:8px;margin-bottom:8px;">
          <select class="sf-input" name="questionId" style="flex:1;font-size:12px;" required>
            <option value="">Select a question...</option>
            {props.questions.map((q) => (
              <option key={q.id} value={q.id}>{q.name}</option>
            ))}
          </select>
          <input
            class="sf-input"
            type="text"
            name="findingId"
            placeholder="Or load from finding ID..."
            style="width:200px;font-size:12px;"
            hx-get="/api/qlab/runner/load-snippet"
            hx-trigger="change, keyup[key=='Enter']"
            hx-target="#qlab-transcript-input"
            hx-swap="outerHTML"
          />
        </div>
        <textarea
          id="qlab-transcript-input"
          name="transcript"
          placeholder="Paste transcript here..."
          class="sf-input"
          style="width:100%;min-height:160px;font-size:12px;font-family:var(--mono);margin-bottom:8px;"
        ></textarea>
        <div style="display:flex;gap:8px;align-items:center;">
          <button type="submit" class="sf-btn primary" style="font-size:11px;">Run Simulation</button>
          <span id="qlab-runner-spinner" class="htmx-indicator" style="font-size:11px;color:var(--text-dim);">
            Running...
          </span>
        </div>
      </form>

      <div id="qlab-runner-result" style="margin-top:14px;"></div>
    </div>
  );
}

function HistoryPanel(props: {
  configId: string;
  runs: QLTestRun[];
  questions: QLQuestion[];
}) {
  const qById = new Map(props.questions.map((q) => [q.id, q.name]));
  return (
    <div class="card">
      <div class="tbl-title" style="margin-bottom:8px;">Test History</div>
      {props.runs.length === 0 ? (
        <div style="color:var(--text-dim);font-size:12px;text-align:center;padding:24px;">
          No test runs yet for this config.
        </div>
      ) : (
        <table class="data-table" style="width:100%;font-size:12px;">
          <thead>
            <tr style="text-align:left;color:var(--text-dim);font-size:10px;text-transform:uppercase;letter-spacing:1px;">
              <th style="padding:6px 8px;width:80px;">When</th>
              <th style="padding:6px 8px;">Question</th>
              <th style="padding:6px 8px;width:64px;">Result</th>
              <th style="padding:6px 8px;">Expected → Actual</th>
            </tr>
          </thead>
          <tbody>
            {props.runs.map((r) => (
              <tr key={r.id} style="border-top:1px solid var(--border);">
                <td style="padding:8px;color:var(--text-dim);font-size:11px;">{fmtAge(r.runAt)}</td>
                <td style="padding:8px;color:var(--text-bright);">
                  {qById.get(r.questionId) ?? r.questionId.slice(0, 8)}
                </td>
                <td style="padding:8px;">
                  <span
                    class="pill"
                    style={r.result === "pass"
                      ? "background:var(--green-bg);color:var(--green);"
                      : "background:var(--red-bg);color:var(--red);"}
                  >{r.result}</span>
                </td>
                <td style="padding:8px;font-size:11px;color:var(--text-muted);">
                  <span style="color:var(--text-dim);">{r.expectedAnswer || "—"}</span>{" → "}
                  <span style="color:var(--text-bright);">{r.actualAnswer || "—"}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function AssignmentsPanel(props: {
  configId: string;
  configName: string;
  configType: "internal" | "partner";
}) {
  const fieldLabel = props.configType === "internal" ? "Destination ID" : "Office Name";
  const placeholder = props.configType === "internal" ? "dest-1234" : "East Office";
  return (
    <div class="card">
      <div class="tbl-title" style="margin-bottom:8px;">Assignment</div>
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:12px;">
        Bind this config to a {props.configType === "internal" ? "destination (date-leg)" : "office (partner)"}.
        The audit pipeline reads this assignment to pick which questions to ask.
      </div>
      <form
        hx-post="/api/qlab/assignments/set"
        hx-target="#qlab-assign-result"
        hx-swap="innerHTML"
        style="display:flex;gap:8px;align-items:flex-end;"
      >
        <input type="hidden" name="type" value={props.configType} />
        <input type="hidden" name="value" value={props.configName} />
        <div style="flex:1;">
          <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.8px;">
            {fieldLabel}
          </label>
          <input class="sf-input" name="key" type="text" placeholder={placeholder} required style="width:100%;font-size:12px;" />
        </div>
        <button type="submit" class="sf-btn primary" style="font-size:11px;">Bind</button>
      </form>
      <div id="qlab-assign-result" style="margin-top:10px;font-size:11px;color:var(--text-dim);"></div>

      <div style="margin-top:18px;padding-top:12px;border-top:1px solid var(--border);">
        <div class="tbl-title" style="margin-bottom:8px;">Current Assignments</div>
        <div
          hx-get={`/api/qlab/assignments/list?type=${props.configType}&configName=${encodeURIComponent(props.configName)}`}
          hx-trigger="load"
          hx-swap="innerHTML"
          style="font-size:11px;color:var(--text-dim);"
        >Loading...</div>
      </div>
    </div>
  );
}
