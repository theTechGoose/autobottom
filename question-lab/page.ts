/** Inline HTML/CSS/JS for the Question Lab UI. */
import type { QLConfig, QLQuestion, QLTest } from "./kv.ts";

function esc(str: string) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const STYLES = `
  :root {
    --bg: #0d1117;
    --bg-raised: #161b22;
    --card: #21262d;
    --border: #30363d;
    --text: #e6edf3;
    --muted: #8b949e;
    --blue: #388bfd;
    --blue-dim: rgba(56,139,253,0.12);
    --green: #3fb950;
    --green-dim: rgba(63,185,80,0.12);
    --red: #f85149;
    --red-dim: rgba(248,81,73,0.12);
    --orange: #d29922;
    --orange-dim: rgba(210,153,34,0.12);
    --radius: 10px;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; min-height: 100vh; }
  a { color: var(--blue); text-decoration: none; }
  a:hover { text-decoration: underline; }

  /* Top nav */
  .topnav { background: var(--bg-raised); border-bottom: 1px solid var(--border); padding: 0 24px; height: 52px; display: flex; align-items: center; gap: 16px; position: sticky; top: 0; z-index: 10; }
  .topnav-logo { font-weight: 700; font-size: 15px; color: var(--text); display: flex; align-items: center; gap: 8px; white-space: nowrap; }
  .topnav-logo .flask { color: var(--green); font-size: 18px; }
  .topnav-crumb { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--muted); flex: 1; min-width: 0; overflow: hidden; }
  .topnav-crumb a { color: var(--muted); }
  .topnav-crumb a:hover { color: var(--text); text-decoration: none; }
  .topnav-crumb .sep { opacity: 0.4; }
  .topnav-back { font-size: 13px; color: var(--muted); padding: 5px 12px; border: 1px solid var(--border); border-radius: 6px; white-space: nowrap; transition: color 0.15s, border-color 0.15s; }
  .topnav-back:hover { color: var(--text); border-color: var(--muted); text-decoration: none; }

  /* Layout */
  .container { max-width: 1100px; margin: 0 auto; padding: 32px 24px; }
  .page-hd { margin-bottom: 24px; }
  .page-hd h1 { font-size: 22px; font-weight: 600; }
  .page-hd .sub { font-size: 14px; color: var(--muted); margin-top: 4px; }

  /* Cards */
  .card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.25); }
  .card-hd { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
  .card-hd h2 { font-size: 16px; font-weight: 600; margin: 0; }

  /* Test audit card */
  .card-test { border-color: rgba(63,185,80,0.25); background: rgba(63,185,80,0.03); }
  .card-test .card-hd h2 { color: var(--green); }

  /* Tables */
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--border); color: var(--muted); font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  td { padding: 10px 12px; border-bottom: 1px solid var(--border); font-size: 14px; }
  tbody tr:nth-child(even) td { background: rgba(255,255,255,0.018); }
  tbody tr:hover td { background: var(--blue-dim); }
  tbody tr:last-child td { border-bottom: none; }

  /* Buttons */
  button, .btn { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; background: var(--blue); color: #fff; border: none; border-radius: 6px; font-size: 13px; font-weight: 500; cursor: pointer; transition: background 0.15s, opacity 0.15s; white-space: nowrap; }
  button:hover, .btn:hover { background: #1f6feb; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-danger { background: var(--red); }
  .btn-danger:hover { background: #da3633; }
  .btn-ghost { background: transparent; color: var(--muted); border: 1px solid var(--border); }
  .btn-ghost:hover { color: var(--text); border-color: var(--muted); background: rgba(255,255,255,0.04); }
  .btn-green { background: var(--green); color: #0d1117; }
  .btn-green:hover { background: #3aaa48; }
  .btn-sm { padding: 4px 10px; font-size: 12px; }

  /* Inputs */
  input, textarea, select { background: var(--bg-raised); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px; font-size: 14px; font-family: inherit; width: 100%; transition: border-color 0.15s, box-shadow 0.15s; }
  input:focus, textarea:focus, select:focus { outline: none; border-color: var(--blue); box-shadow: 0 0 0 3px rgba(56,139,253,0.1); }
  textarea { resize: vertical; min-height: 120px; }
  .form-row { margin-bottom: 14px; }
  .form-row label { display: block; font-size: 11px; color: var(--muted); margin-bottom: 5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px; }

  /* Inline expand forms */
  .inline-form { display: none; margin-top: 16px; background: var(--bg-raised); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
  .inline-form.active { display: block; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; }

  /* Badges */
  .badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; }
  .badge-pass { background: var(--green-dim); color: var(--green); border: 1px solid rgba(63,185,80,0.3); }
  .badge-fail { background: var(--red-dim); color: var(--red); border: 1px solid rgba(248,81,73,0.3); }
  .badge-pending { background: var(--orange-dim); color: var(--orange); border: 1px solid rgba(210,153,34,0.3); }
  .badge-running { background: var(--blue-dim); color: var(--blue); border: 1px solid rgba(56,139,253,0.3); }
  .tag { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; background: var(--blue-dim); color: var(--blue); border: 1px solid rgba(56,139,253,0.2); }

  /* Empty states */
  .empty { text-align: center; padding: 40px 20px; color: var(--muted); font-size: 14px; }

  /* Version history */
  .version-list { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .version-item { padding: 12px 16px; border-bottom: 1px solid var(--border); background: var(--bg-raised); display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
  .version-item:last-child { border-bottom: none; }
  .version-item .meta { flex: 1; min-width: 0; }
  .version-item .ts { font-size: 12px; color: var(--muted); margin-bottom: 4px; }
  .version-item .vtext { font-size: 13px; white-space: pre-wrap; color: var(--muted); font-family: 'SF Mono', Consolas, monospace; }

  /* Test rows */
  .test-detail { display: none; padding: 12px 16px; background: var(--bg); font-size: 13px; border-top: 1px solid var(--border); }
  .test-detail.active { display: block; }
  .test-detail h4 { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .test-detail p { white-space: pre-wrap; margin-bottom: 12px; line-height: 1.5; color: var(--text); }

  /* Toggle group */
  .toggle-group { display: flex; }
  .toggle-group button { border-radius: 0; border: 1px solid var(--border); background: var(--bg-raised); color: var(--muted); margin-right: -1px; }
  .toggle-group button:first-child { border-radius: 6px 0 0 6px; }
  .toggle-group button:last-child { border-radius: 0 6px 6px 0; margin-right: 0; }
  .toggle-group button.active { background: var(--blue); color: #fff; border-color: var(--blue); z-index: 1; }

  /* Spinner */
  .spinner { display: inline-block; width: 12px; height: 12px; border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: spin 0.6s linear infinite; vertical-align: middle; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Test run history */
  .run-history td { font-size: 13px; }
  .run-link { font-family: 'SF Mono', Consolas, monospace; font-size: 12px; color: var(--blue); }
`;

interface CrumbItem { label: string; href?: string; }

function shell(title: string, body: string, crumbs: CrumbItem[] = []): string {
  const crumbHtml = crumbs.map((b, i) => {
    const last = i === crumbs.length - 1;
    if (b.href && !last) return `<a href="${b.href}">${esc(b.label)}</a><span class="sep">/</span>`;
    return `<span>${esc(b.label)}</span>`;
  }).join(" ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)} — Question Lab</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <style>${STYLES}</style>
</head>
<body>
  <nav class="topnav">
    <div class="topnav-logo"><span class="flask">🧪</span> Question Lab</div>
    ${crumbHtml ? `<div class="topnav-crumb">${crumbHtml}</div>` : `<div style="flex:1"></div>`}
    <a class="topnav-back" href="/dashboard">← Dashboard</a>
  </nav>
  <div class="container">${body}</div>
</body>
</html>`;
}

// ── Config List Page ─────────────────────────────────────────────────

export function configListPage(configs: QLConfig[]): string {
  const rows = configs.map((c) => `
    <tr>
      <td><a href="/question-lab/config/${c.id}">${esc(c.name)}</a></td>
      <td style="color:var(--muted);">${c.questionIds.length} question${c.questionIds.length === 1 ? "" : "s"}</td>
      <td style="color:var(--muted);font-size:13px;">${new Date(c.createdAt).toLocaleDateString("en-US", { timeZone: "America/New_York" })}</td>
      <td style="text-align:right;"><button class="btn-sm btn-danger" onclick="deleteConfig('${c.id}')">Delete</button></td>
    </tr>`).join("");

  return shell("Configurations", `
    <div class="page-hd">
      <h1>Question Lab</h1>
      <p class="sub">Manage audit question configurations for internal and partner audits.</p>
    </div>
    <div class="card">
      <div class="card-hd">
        <h2>Configurations</h2>
        <button onclick="document.getElementById('new-config-form').classList.toggle('active')">+ New Config</button>
      </div>
      <div id="new-config-form" class="inline-form">
        <div class="form-row">
          <label>Config Name</label>
          <input type="text" id="config-name" placeholder="e.g. VO Audit Questions v2" />
        </div>
        <div class="actions">
          <button onclick="createConfig()">Create</button>
          <button class="btn-ghost" onclick="document.getElementById('new-config-form').classList.remove('active')">Cancel</button>
        </div>
      </div>
      ${configs.length === 0
        ? '<div class="empty">No configurations yet. Create one to get started.</div>'
        : `<table><thead><tr><th>Name</th><th>Questions</th><th>Created</th><th></th></tr></thead><tbody>${rows}</tbody></table>`}
    </div>
    <script>
      async function createConfig() {
        const name = document.getElementById('config-name').value.trim();
        if (!name) return;
        await fetch('/question-lab/api/configs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
        location.reload();
      }
      async function deleteConfig(id) {
        if (!confirm('Delete this config and all its questions?')) return;
        await fetch('/question-lab/api/configs/' + id, { method: 'DELETE' });
        location.reload();
      }
    </script>`, []);
}

// ── Config Detail Page ───────────────────────────────────────────────

export function configDetailPage(config: QLConfig, questions: QLQuestion[]): string {
  const rows = questions.map((q) => `
    <tr>
      <td><a href="/question-lab/question/${q.id}">${esc(q.name)}</a></td>
      <td style="color:var(--muted);font-size:13px;">${esc(q.text.length > 90 ? q.text.slice(0, 90) + "…" : q.text)}</td>
      <td style="color:var(--muted);">${q.testIds.length}</td>
      <td style="text-align:right;"><button class="btn-sm btn-danger" onclick="deleteQuestion('${q.id}')">Delete</button></td>
    </tr>`).join("");

  const testRuns = config.testRuns ?? [];
  const runRows = testRuns.map((r) => `
    <tr class="run-history">
      <td class="run-link"><a href="/audit/report?id=${r.findingId}">${r.findingId.slice(0, 12)}…</a></td>
      <td>${esc(r.rid)}</td>
      <td><span class="tag">${r.type}</span></td>
      <td style="color:var(--muted);font-size:12px;">${new Date(r.startedAt).toLocaleString("en-US", { timeZone: "America/New_York" })}</td>
    </tr>`).join("");

  const defaultEmails = JSON.stringify(config.testEmailRecipients ?? ["ai@monsterrg.com"]);

  return shell(config.name, `
    <div class="page-hd">
      <div style="display:flex;align-items:center;gap:10px;">
        <h1>${esc(config.name)}</h1>
        <span class="tag">Config</span>
      </div>
    </div>

    <div class="card">
      <div class="card-hd"><h2>Config Settings</h2></div>
      <div class="form-row">
        <label>Config Name</label>
        <div style="display:flex;gap:8px;">
          <input type="text" id="config-name" value="${esc(config.name)}" />
          <button onclick="renameConfig()">Save</button>
        </div>
      </div>
    </div>

    <div class="card card-test">
      <div class="card-hd">
        <h2>🧪 Run Test Audit</h2>
        <span style="font-size:12px;color:var(--muted);">Isolated — no live data affected</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;">
        <div class="form-row" style="margin:0;">
          <label>Record ID (RID)</label>
          <input type="text" id="test-rid" placeholder="e.g. 12345678" />
        </div>
        <div class="form-row" style="margin:0;">
          <label>Audit Type</label>
          <div class="toggle-group" style="margin-top:5px;">
            <button id="type-internal" class="active" onclick="setAuditType('internal')">Internal</button>
            <button id="type-partner" onclick="setAuditType('partner')">Partner</button>
          </div>
        </div>
      </div>
      <div class="form-row">
        <label>Email Recipients <span style="font-weight:400;text-transform:none;">(comma-separated)</span></label>
        <div style="display:flex;gap:8px;">
          <input type="text" id="test-emails" value="${esc((config.testEmailRecipients ?? ["ai@monsterrg.com"]).join(", "))}" />
          <button class="btn-ghost" onclick="saveEmails()">Save</button>
        </div>
      </div>
      <div class="actions">
        <button class="btn-green" id="run-btn" onclick="runTestAudit()">▶ Run Test Audit</button>
        <span id="run-status" style="font-size:13px;color:var(--muted);align-self:center;"></span>
      </div>
      ${testRuns.length > 0 ? `
      <div style="margin-top:20px;">
        <div style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;font-weight:600;">Recent Test Runs</div>
        <table><thead><tr><th>Finding ID</th><th>RID</th><th>Type</th><th>Started</th></tr></thead><tbody>${runRows}</tbody></table>
      </div>` : ""}
    </div>

    <div class="card">
      <div class="card-hd">
        <h2>Questions <span style="font-weight:400;color:var(--muted);font-size:14px;">(${questions.length})</span></h2>
        <button onclick="document.getElementById('new-q-form').classList.toggle('active')">+ Add Question</button>
      </div>
      <div id="new-q-form" class="inline-form">
        <div class="form-row"><label>Question Name (short label)</label><input type="text" id="q-name" placeholder="e.g. Disclosure Check" /></div>
        <div class="form-row"><label>Question Text</label><textarea id="q-text" placeholder="e.g. Did the agent disclose that the offer is promotional?"></textarea></div>
        <div class="actions">
          <button onclick="addQuestion()">Add</button>
          <button class="btn-ghost" onclick="document.getElementById('new-q-form').classList.remove('active')">Cancel</button>
        </div>
      </div>
      ${questions.length === 0
        ? '<div class="empty">No questions yet. Add one to get started.</div>'
        : `<table><thead><tr><th>Name</th><th>Text</th><th>Tests</th><th></th></tr></thead><tbody>${rows}</tbody></table>`}
    </div>

    <script>
      const configId = '${config.id}';
      let auditType = 'internal';

      function setAuditType(t) {
        auditType = t;
        document.getElementById('type-internal').classList.toggle('active', t === 'internal');
        document.getElementById('type-partner').classList.toggle('active', t === 'partner');
      }

      async function saveEmails() {
        const raw = document.getElementById('test-emails').value;
        const emails = raw.split(',').map(e => e.trim()).filter(Boolean);
        await fetch('/question-lab/api/configs/' + configId + '/test-emails', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emails })
        });
        document.getElementById('run-status').textContent = 'Emails saved.';
        setTimeout(() => { document.getElementById('run-status').textContent = ''; }, 2000);
      }

      async function runTestAudit() {
        const rid = document.getElementById('test-rid').value.trim();
        if (!rid) { alert('Please enter a Record ID.'); return; }
        const btn = document.getElementById('run-btn');
        const status = document.getElementById('run-status');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Starting…';
        status.textContent = '';
        try {
          const res = await fetch('/question-lab/api/run-test-audit', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ configId, rid, type: auditType })
          });
          const data = await res.json();
          if (data.findingId) {
            status.innerHTML = '✅ Started — <a href="/audit/report?id=' + data.findingId + '" target="_blank">View Report</a>';
            setTimeout(() => location.reload(), 1500);
          } else {
            status.textContent = '❌ ' + (data.error || 'Failed to start');
          }
        } catch (e) {
          status.textContent = '❌ Network error';
        } finally {
          btn.disabled = false;
          btn.innerHTML = '▶ Run Test Audit';
        }
      }

      async function renameConfig() {
        const name = document.getElementById('config-name').value.trim();
        if (!name) return;
        await fetch('/question-lab/api/configs/' + configId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
        location.reload();
      }

      async function addQuestion() {
        const name = document.getElementById('q-name').value.trim();
        const text = document.getElementById('q-text').value.trim();
        if (!name || !text) return;
        await fetch('/question-lab/api/configs/' + configId + '/questions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, text }) });
        location.reload();
      }

      async function deleteQuestion(id) {
        if (!confirm('Delete this question and all its tests?')) return;
        await fetch('/question-lab/api/questions/' + id, { method: 'DELETE' });
        location.reload();
      }
    </script>`,
    [{ label: "Question Lab", href: "/question-lab" }, { label: config.name }]);
}

// ── Question Editor Page ─────────────────────────────────────────────

export function questionEditorPage(question: QLQuestion, tests: QLTest[]): string {
  const versionItems = question.versions.map((v, i) => `
    <div class="version-item">
      <div class="meta">
        <div class="ts">${new Date(v.timestamp).toLocaleString("en-US", { timeZone: "America/New_York" })}</div>
        <div class="vtext">${esc(v.text.length > 200 ? v.text.slice(0, 200) + "…" : v.text)}</div>
      </div>
      <button class="btn-sm btn-ghost" onclick="restoreVersion(${i})">Restore</button>
    </div>`).join("");

  const testRows = tests.map((t) => {
    const badgeClass = t.lastResult === "pass" ? "badge-pass" : t.lastResult === "fail" ? "badge-fail" : "badge-pending";
    const badgeText = t.lastResult ?? "untested";
    return `
    <tr onclick="toggleDetail('${t.id}')" style="cursor:pointer;">
      <td style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(t.snippet.length > 70 ? t.snippet.slice(0, 70) + "…" : t.snippet)}</td>
      <td><span class="badge ${t.expected === "yes" ? "badge-pass" : "badge-fail"}">${t.expected}</span></td>
      <td><span class="badge ${badgeClass}" id="badge-${t.id}">${badgeText}</span></td>
      <td style="color:var(--muted);font-size:12px;">${t.lastRunAt ? new Date(t.lastRunAt).toLocaleString("en-US", { timeZone: "America/New_York" }) : "—"}</td>
      <td style="text-align:right;"><button class="btn-sm btn-danger" onclick="event.stopPropagation();deleteTest('${t.id}')">Delete</button></td>
    </tr>
    <tr><td colspan="5" style="padding:0;border:none;">
      <div class="test-detail" id="detail-${t.id}">
        ${t.lastThinking ? `<h4>Thinking</h4><p>${esc(t.lastThinking)}</p>` : ""}
        ${t.lastDefense ? `<h4>Defense</h4><p>${esc(t.lastDefense)}</p>` : ""}
        ${t.lastAnswer ? `<h4>Raw Answer</h4><p>${esc(t.lastAnswer)}</p>` : ""}
        ${!t.lastResult ? '<p style="color:var(--muted);">Run a simulation to see results.</p>' : ""}
      </div>
    </td></tr>`;
  }).join("");

  const testIdsJson = JSON.stringify(tests.map((t) => t.id));

  return shell(question.name, `
    <div class="page-hd">
      <div style="display:flex;align-items:center;gap:10px;">
        <h1>${esc(question.name)}</h1>
        <span class="tag">Question</span>
      </div>
    </div>

    <div class="card">
      <div class="card-hd"><h2>Question Editor</h2></div>
      <div class="form-row"><label>Name</label><input type="text" id="q-name" value="${esc(question.name)}" /></div>
      <div class="form-row"><label>Question Text</label><textarea id="q-text" style="min-height:180px;">${esc(question.text)}</textarea></div>
      <div class="form-row"><label>Auto-Yes Expression <span style="font-weight:400;text-transform:none;">(optional)</span></label><input type="text" id="q-autoyes" value="${esc(question.autoYesExp)}" placeholder="e.g. ~49:Married" /></div>
      <div class="actions"><button onclick="saveQuestion()">Save Changes</button></div>
    </div>

    <div class="card">
      <div class="card-hd"><h2>Version History <span style="font-weight:400;color:var(--muted);font-size:14px;">(${question.versions.length})</span></h2></div>
      ${question.versions.length === 0
        ? '<div class="empty" style="padding:20px 0 4px;">No previous versions yet.</div>'
        : `<div class="version-list">${versionItems}</div>`}
    </div>

    <div class="card">
      <div class="card-hd">
        <h2>Tests <span style="font-weight:400;color:var(--muted);font-size:14px;">(${tests.length})</span></h2>
        <div class="actions" style="margin:0;">
          <button class="btn-ghost" onclick="document.getElementById('new-test-form').classList.toggle('active')">+ Add Test</button>
          ${tests.length > 0 ? '<button onclick="simulateAll()">Simulate All</button>' : ""}
        </div>
      </div>
      <div id="new-test-form" class="inline-form">
        <div class="form-row"><label>Transcript Snippet</label><textarea id="test-snippet" placeholder="Paste transcript fragment here…"></textarea></div>
        <div class="form-row">
          <label>Expected Answer</label>
          <div class="toggle-group" style="margin-top:5px;">
            <button id="exp-yes" class="active" onclick="setExpected('yes')">Yes</button>
            <button id="exp-no" onclick="setExpected('no')">No</button>
          </div>
        </div>
        <div class="actions">
          <button onclick="addTest()">Add Test</button>
          <button class="btn-ghost" onclick="document.getElementById('new-test-form').classList.remove('active')">Cancel</button>
        </div>
      </div>
      ${tests.length === 0
        ? '<div class="empty" style="padding:24px 0 8px;">No tests yet. Add a snippet to start testing.</div>'
        : `<table><thead><tr><th>Snippet</th><th>Expected</th><th>Result</th><th>Last Run</th><th></th></tr></thead><tbody>${testRows}</tbody></table>`}
    </div>

    <script>
      const questionId = '${question.id}';
      let expectedValue = 'yes';
      function setExpected(val) {
        expectedValue = val;
        document.getElementById('exp-yes').classList.toggle('active', val === 'yes');
        document.getElementById('exp-no').classList.toggle('active', val === 'no');
      }
      function toggleDetail(testId) { document.getElementById('detail-' + testId).classList.toggle('active'); }
      async function saveQuestion() {
        const name = document.getElementById('q-name').value.trim();
        const text = document.getElementById('q-text').value.trim();
        const autoYesExp = document.getElementById('q-autoyes').value.trim();
        if (!name || !text) return;
        await fetch('/question-lab/api/questions/' + questionId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, text, autoYesExp }) });
        location.reload();
      }
      async function restoreVersion(index) {
        if (!confirm('Restore this version? Current text will be saved to history.')) return;
        await fetch('/question-lab/api/questions/' + questionId + '/restore/' + index, { method: 'POST' });
        location.reload();
      }
      async function addTest() {
        const snippet = document.getElementById('test-snippet').value.trim();
        if (!snippet) return;
        await fetch('/question-lab/api/questions/' + questionId + '/tests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ snippet, expected: expectedValue }) });
        location.reload();
      }
      async function deleteTest(id) {
        if (!confirm('Delete this test?')) return;
        await fetch('/question-lab/api/tests/' + id, { method: 'DELETE' });
        location.reload();
      }
      async function simulateAll() {
        const questionText = document.getElementById('q-text').value.trim();
        const testIds = ${testIdsJson};
        if (testIds.length === 0) return;
        testIds.forEach(id => {
          const badge = document.getElementById('badge-' + id);
          if (badge) { badge.className = 'badge badge-running'; badge.innerHTML = '<span class="spinner"></span> running'; }
        });
        const res = await fetch('/question-lab/api/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ questionText, testIds }) });
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\\n');
          buffer = lines.pop();
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = JSON.parse(line.slice(6));
            if (data.done) { setTimeout(() => location.reload(), 500); return; }
            const badge = document.getElementById('badge-' + data.testId);
            if (badge) { badge.className = 'badge ' + (data.status === 'pass' ? 'badge-pass' : 'badge-fail'); badge.textContent = data.status; }
          }
        }
      }
    </script>`,
    [
      { label: "Question Lab", href: "/question-lab" },
      { label: "Config", href: `/question-lab/config/${question.configId}` },
      { label: question.name },
    ]);
}
