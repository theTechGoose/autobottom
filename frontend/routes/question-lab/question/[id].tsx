/** Question Lab — single question editor page. Mirrors prod
 *  main:question-lab/page.ts questionEditorPage. Full-width, no sidebar.
 *
 *  Sections:
 *    - Question Editor: name, text, auto-yes expression (with reference
 *      docs), temperature, numDocs, weight, egregious — single Save form
 *    - Version History: lists prior text versions with Restore buttons
 *    - Test Simulator: paste a transcript, click Simulate, see the
 *      LLM's yes/no answer. (Hits /api/qlab/simulate which already exists
 *      on the backend.)
 *
 *  All HTMX, no client JS. Save returns a tiny status fragment; restore
 *  triggers a redirect. */
import { define } from "../../../lib/define.ts";
import { Layout } from "../../../components/Layout.tsx";
import { apiFetch } from "../../../lib/api.ts";

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
  createdAt?: number;
  updatedAt?: number;
  versions?: Array<{ text: string; updatedAt: number }>;
}

export default define.page(async function QuestionEditorPage(ctx) {
  const user = ctx.state.user!;
  const url = new URL(ctx.req.url);
  const id = (ctx.params as { id?: string }).id ?? "";

  let q: QLQuestion | null = null;
  try {
    q = await apiFetch<QLQuestion>(`/api/qlab/question?id=${encodeURIComponent(id)}`, ctx.req);
    if (q && (q as { error?: string }).error) q = null;
  } catch (e) { console.error("[qlab/question] load error:", e); }

  return (
    <Layout title={q?.name ?? "Question"} section="admin" user={user} pathname={url.pathname} hideSidebar>
      <div class="ql-topbar">
        <div class="ql-topbar-title">
          <span class="ql-topbar-icon" aria-hidden="true">✏️</span>
          <h1>Question Lab</h1>
          {q && (
            <span style="color:var(--text-dim);font-weight:400;font-size:13px;margin-left:8px;">
              <a href="/question-lab" style="color:var(--text-muted);text-decoration:none;">Question Lab</a>
              <span style="margin:0 6px;color:var(--text-dim);">/</span>
              <a href={`/question-lab/config/${q.configId}`} style="color:var(--text-muted);text-decoration:none;">Config</a>
              <span style="margin:0 6px;color:var(--text-dim);">/</span>
              <span style="color:var(--text-bright);">{q.name}</span>
            </span>
          )}
        </div>
        <a href="/admin/dashboard" class="ql-topbar-back">← Dashboard</a>
      </div>

      <div class="ql-page-body">
        {!q ? (
          <div class="card" style="text-align:center;color:var(--text-dim);padding:40px;">Question not found.</div>
        ) : (
          <>
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
              <h1 style="margin:0;font-size:22px;">{q.name}</h1>
              <span class="pill pill-blue">Question</span>
              <a href={`/question-lab/config/${q.configId}`} class="sf-btn" style="font-size:11px;text-decoration:none;">← Back to Config</a>
            </div>
            <EditorCard q={q} />
            <VersionsCard q={q} />
            <SimulatorCard q={q} />
          </>
        )}
      </div>
    </Layout>
  );
});

function EditorCard({ q }: { q: QLQuestion }) {
  return (
    <div class="card" style="margin-bottom:16px;">
      <div class="tbl-title" style="margin-bottom:12px;">Question Editor</div>
      <form
        hx-post="/api/qlab/questions/update"
        hx-target="#qe-msg"
        hx-swap="innerHTML"
      >
        <input type="hidden" name="id" value={q.id} />
        <div style="margin-bottom:10px;">
          <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.8px;">Name</label>
          <input class="sf-input" type="text" name="name" value={q.name} required style="width:100%;font-size:12px;" />
        </div>
        <div style="margin-bottom:10px;">
          <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.8px;">Question Text</label>
          <textarea class="sf-input" name="text" required rows={6} style="width:100%;font-size:12px;font-family:var(--mono);">{q.text}</textarea>
        </div>
        <div style="margin-bottom:10px;">
          <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.8px;">
            Auto-Yes / Skip Expression <span style="font-weight:400;text-transform:none;color:var(--text-muted);">(optional)</span>
          </label>
          <input class="sf-input" type="text" name="autoYesExp" value={q.autoYesExp ?? ""} placeholder="e.g. {{594!0}}=0::Guest didn't get MCC" style="width:100%;font-size:12px;font-family:var(--mono);" />
          <details style="margin-top:8px;font-size:11px;color:var(--text-dim);">
            <summary style="cursor:pointer;color:var(--blue);font-weight:500;">Expression reference</summary>
            <ExpressionReference />
          </details>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:10px;margin-bottom:10px;">
          <div>
            <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.8px;">Temperature</label>
            <input class="sf-input" type="number" name="temperature" value={String(q.temperature ?? 0.8)} min={0} max={1} step={0.1} style="width:100%;font-size:12px;" />
            <div style="font-size:10px;color:var(--text-dim);margin-top:2px;">0 = deterministic, 1 = creative</div>
          </div>
          <div>
            <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.8px;">Vector Docs</label>
            <input class="sf-input" type="number" name="numDocs" value={String(q.numDocs ?? 4)} min={1} max={10} step={1} style="width:100%;font-size:12px;" />
            <div style="font-size:10px;color:var(--text-dim);margin-top:2px;">RAG chunks (1–10)</div>
          </div>
          <div>
            <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.8px;">Weight</label>
            <input class="sf-input" type="number" name="weight" value={String(q.weight ?? 5)} min={1} max={100} step={1} style="width:100%;font-size:12px;" />
            <div style="font-size:10px;color:var(--text-dim);margin-top:2px;">Bonus-point cost</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;margin-bottom:14px;">
          <input type="checkbox" name="egregious" value="true" checked={!!q.egregious} style="width:16px;height:16px;" />
          <label style="font-size:11px;font-weight:600;color:var(--text-bright);flex:1;">Egregious Question</label>
          <span style="font-size:10px;color:var(--text-dim);">(immune to bonus-point flips, impacts chargebacks)</span>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <button type="submit" class="sf-btn primary" style="font-size:12px;">Save Changes</button>
          <span id="qe-msg" style="font-size:11px;"></span>
        </div>
      </form>
    </div>
  );
}

function ExpressionReference() {
  return (
    <div style="margin-top:8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:10px;line-height:1.7;">
      <div style="margin-bottom:8px;">Format: <code style="background:var(--bg-raised);padding:2px 6px;border-radius:3px;font-size:11px;">condition::reason message</code></div>
      <table style="width:100%;font-size:11px;border-collapse:collapse;">
        <thead>
          <tr style="text-align:left;color:var(--text-dim);">
            <th style="padding:4px 8px;border-bottom:1px solid var(--border);">Operator</th>
            <th style="padding:4px 8px;border-bottom:1px solid var(--border);">Meaning</th>
            <th style="padding:4px 8px;border-bottom:1px solid var(--border);">Example</th>
          </tr>
        </thead>
        <tbody>
          <tr><td style="padding:4px 8px;font-family:var(--mono);color:var(--green);">~</td><td style="padding:4px 8px;">Contains</td><td style="padding:4px 8px;font-family:var(--mono);">{`{{49}}~single::Guest is single`}</td></tr>
          <tr><td style="padding:4px 8px;font-family:var(--mono);color:var(--red);">/</td><td style="padding:4px 8px;">Does NOT contain</td><td style="padding:4px 8px;font-family:var(--mono);">{`{{49}}/single::Guest is married`}</td></tr>
          <tr><td style="padding:4px 8px;font-family:var(--mono);color:var(--blue);">=</td><td style="padding:4px 8px;">Equals</td><td style="padding:4px 8px;font-family:var(--mono);">{`{{594!0}}=0::Guest didn't get MCC`}</td></tr>
          <tr><td style="padding:4px 8px;font-family:var(--mono);color:#f97316;">#</td><td style="padding:4px 8px;">Does NOT equal</td><td style="padding:4px 8px;font-family:var(--mono);">{`{{553}}#yes::Not activated`}</td></tr>
          <tr><td style="padding:4px 8px;font-family:var(--mono);color:var(--text-muted);">&lt;</td><td style="padding:4px 8px;">Less than (numeric)</td><td style="padding:4px 8px;font-family:var(--mono);">{`{{706}}<1::Revenue not collected`}</td></tr>
        </tbody>
      </table>
      <div style="margin-top:8px;color:var(--text-dim);">
        <code style="background:var(--bg-raised);padding:1px 4px;border-radius:2px;">{`{{fieldId}}`}</code> is replaced with the record's field value at audit time.{" "}
        <code style="background:var(--bg-raised);padding:1px 4px;border-radius:2px;">{`{{fieldId!default}}`}</code> uses "default" if the field is empty.{" "}
        <code style="background:var(--bg-raised);padding:1px 4px;border-radius:2px;">::reason</code> is the message shown when the skip fires.
      </div>
    </div>
  );
}

function VersionsCard({ q }: { q: QLQuestion }) {
  const versions = q.versions ?? [];
  return (
    <div class="card" style="margin-bottom:16px;">
      <div class="tbl-title" style="margin-bottom:8px;">Version History <span style="font-weight:400;color:var(--text-dim);font-size:12px;">({versions.length})</span></div>
      {versions.length === 0
        ? <div style="font-size:11px;color:var(--text-dim);padding:8px 0;">No previous versions yet.</div>
        : (
          <div style="display:flex;flex-direction:column;gap:6px;">
            {versions.map((v, i) => (
              <div key={i} style="display:flex;gap:8px;align-items:flex-start;padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;font-size:11px;">
                <div style="flex:1;min-width:0;">
                  <div style="color:var(--text-dim);font-size:10px;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:2px;">{new Date(v.updatedAt).toLocaleString("en-US", { timeZone: "America/New_York" })}</div>
                  <div style="color:var(--text);overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;">{v.text.length > 240 ? v.text.slice(0, 240) + "…" : v.text}</div>
                </div>
                <button
                  type="button"
                  class="sf-btn"
                  style="font-size:10px;"
                  hx-post={`/api/qlab/questions/restore?id=${q.id}&versionIndex=${i}`}
                  hx-confirm="Restore this version of the question text?"
                  hx-target="body"
                  hx-push-url={`/question-lab/question/${q.id}`}
                >Restore</button>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

function SimulatorCard({ q }: { q: QLQuestion }) {
  return (
    <div class="card">
      <div class="tbl-title" style="margin-bottom:8px;">Test Simulator</div>
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:10px;">Paste a transcript snippet, run it through this question, see the LLM's yes/no answer.</div>
      <form
        hx-post="/api/qlab/runner/simulate"
        hx-target="#qe-sim-result"
        hx-swap="innerHTML"
        hx-indicator="#qe-sim-spinner"
      >
        <input type="hidden" name="questionId" value={q.id} />
        <textarea class="sf-input" name="transcript" required rows={6} placeholder="Paste a transcript snippet…" style="width:100%;font-size:11px;font-family:var(--mono);margin-bottom:10px;"></textarea>
        <div style="display:flex;gap:8px;align-items:center;">
          <button type="submit" class="sf-btn primary" style="font-size:11px;">Simulate</button>
          <span id="qe-sim-spinner" class="htmx-indicator" style="display:none;align-items:center;gap:6px;font-size:11px;color:var(--text-dim);">
            <span class="qlab-spinner"></span><span>Running…</span>
          </span>
        </div>
      </form>
      <pre id="qe-sim-result" style="margin-top:10px;font-size:11px;font-family:var(--mono);color:var(--text);background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:10px;white-space:pre-wrap;min-height:24px;"></pre>
    </div>
  );
}
