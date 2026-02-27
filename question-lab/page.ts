/** Inline HTML/CSS/JS for the Question Lab UI. */
import type { QLConfig, QLQuestion, QLTest } from "./kv.ts";

function esc(str: string) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const STYLES = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #1a1a2e; color: #e0e0e0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; min-height: 100vh; }
  a { color: #4a9eff; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .container { max-width: 1100px; margin: 0 auto; padding: 24px; }
  .header { display: flex; align-items: center; gap: 16px; margin-bottom: 32px; padding-bottom: 16px; border-bottom: 1px solid #2a2a4a; }
  .header h1 { font-size: 24px; font-weight: 600; }
  .breadcrumb { font-size: 14px; color: #888; }
  .breadcrumb a { color: #6ab0ff; }
  .card { background: #16213e; border: 1px solid #2a2a4a; border-radius: 8px; padding: 20px; margin-bottom: 16px; }
  .card h2 { font-size: 18px; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #2a2a4a; }
  th { color: #888; font-weight: 500; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; }
  tr:hover td { background: #1e2d50; }
  tr:last-child td { border-bottom: none; }
  button, .btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; background: #4a9eff; color: #fff; border: none; border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer; transition: background 0.15s; }
  button:hover, .btn:hover { background: #3a8eef; }
  .btn-danger { background: #e74c3c; }
  .btn-danger:hover { background: #c0392b; }
  .btn-secondary { background: #3a3a5a; }
  .btn-secondary:hover { background: #4a4a6a; }
  .btn-sm { padding: 4px 10px; font-size: 12px; }
  input, textarea, select { background: #0f1a30; color: #e0e0e0; border: 1px solid #2a2a4a; border-radius: 6px; padding: 8px 12px; font-size: 14px; font-family: inherit; width: 100%; }
  input:focus, textarea:focus, select:focus { outline: none; border-color: #4a9eff; }
  textarea { resize: vertical; min-height: 120px; }
  .form-row { margin-bottom: 12px; }
  .form-row label { display: block; font-size: 13px; color: #888; margin-bottom: 4px; }
  .inline-form { display: none; margin-top: 16px; }
  .inline-form.active { display: block; }
  .actions { display: flex; gap: 8px; margin-top: 12px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: 500; }
  .badge-pass { background: #1a4a2e; color: #4ade80; }
  .badge-fail { background: #4a1a1a; color: #f87171; }
  .badge-pending { background: #3a3a1a; color: #fbbf24; }
  .badge-running { background: #1a2a4a; color: #60a5fa; }
  .empty { text-align: center; padding: 40px; color: #666; }
  .version-item { padding: 10px 12px; border-left: 3px solid #2a2a4a; margin-bottom: 8px; background: #0f1a30; border-radius: 0 6px 6px 0; }
  .version-item .timestamp { font-size: 12px; color: #666; }
  .version-item .text { font-size: 13px; margin-top: 4px; white-space: pre-wrap; color: #aaa; }
  .test-detail { display: none; padding: 12px; margin-top: 8px; background: #0f1a30; border-radius: 6px; font-size: 13px; }
  .test-detail.active { display: block; }
  .test-detail h4 { color: #888; font-size: 12px; text-transform: uppercase; margin-bottom: 4px; }
  .test-detail p { white-space: pre-wrap; margin-bottom: 12px; }
  .toggle-group { display: flex; gap: 0; }
  .toggle-group button { border-radius: 0; border: 1px solid #2a2a4a; background: #0f1a30; color: #888; }
  .toggle-group button:first-child { border-radius: 6px 0 0 6px; }
  .toggle-group button:last-child { border-radius: 0 6px 6px 0; }
  .toggle-group button.active { background: #4a9eff; color: #fff; border-color: #4a9eff; }
  .spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid #4a9eff; border-top-color: transparent; border-radius: 50%; animation: spin 0.6s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
`;

function shell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Question Lab</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <style>${STYLES}</style>
</head>
<body>
  <div class="container">${body}</div>
</body>
</html>`;
}

// ── Config List Page ─────────────────────────────────────────────────

export function configListPage(configs: QLConfig[]): string {
  const rows = configs.map((c) => `
    <tr>
      <td><a href="/question-lab/config/${c.id}">${esc(c.name)}</a></td>
      <td>${c.questionIds.length}</td>
      <td>${new Date(c.createdAt).toLocaleDateString()}</td>
      <td><button class="btn-sm btn-danger" onclick="deleteConfig('${c.id}')">Delete</button></td>
    </tr>`).join("");

  return shell("Configs", `
    <div class="header"><h1>Question Lab</h1></div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h2>Configurations</h2>
        <button onclick="document.getElementById('new-config-form').classList.toggle('active')">New Config</button>
      </div>
      <div id="new-config-form" class="inline-form">
        <div class="form-row">
          <label>Config Name</label>
          <input type="text" id="config-name" placeholder="e.g. VO Audit Questions v2" />
        </div>
        <div class="actions">
          <button onclick="createConfig()">Create</button>
          <button class="btn-secondary" onclick="document.getElementById('new-config-form').classList.remove('active')">Cancel</button>
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
    </script>`);
}

// ── Config Detail Page ───────────────────────────────────────────────

export function configDetailPage(config: QLConfig, questions: QLQuestion[]): string {
  const rows = questions.map((q) => `
    <tr>
      <td><a href="/question-lab/question/${q.id}">${esc(q.name)}</a></td>
      <td>${esc(q.text.length > 80 ? q.text.slice(0, 80) + "..." : q.text)}</td>
      <td>${q.testIds.length}</td>
      <td><button class="btn-sm btn-danger" onclick="deleteQuestion('${q.id}')">Delete</button></td>
    </tr>`).join("");

  return shell(config.name, `
    <div class="header">
      <div>
        <div class="breadcrumb"><a href="/question-lab">Question Lab</a> / Config</div>
        <h1>${esc(config.name)}</h1>
      </div>
    </div>
    <div class="card">
      <div class="form-row">
        <label>Config Name</label>
        <div style="display:flex;gap:8px;">
          <input type="text" id="config-name" value="${esc(config.name)}" />
          <button onclick="renameConfig()">Save</button>
        </div>
      </div>
    </div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h2>Questions (${questions.length})</h2>
        <button onclick="document.getElementById('new-q-form').classList.toggle('active')">Add Question</button>
      </div>
      <div id="new-q-form" class="inline-form">
        <div class="form-row"><label>Question Name (short label)</label><input type="text" id="q-name" placeholder="e.g. Disclosure Check" /></div>
        <div class="form-row"><label>Question Text</label><textarea id="q-text" placeholder="e.g. Did the agent disclose that the offer is promotional?"></textarea></div>
        <div class="actions">
          <button onclick="addQuestion()">Add</button>
          <button class="btn-secondary" onclick="document.getElementById('new-q-form').classList.remove('active')">Cancel</button>
        </div>
      </div>
      ${questions.length === 0
        ? '<div class="empty">No questions yet. Add one to get started.</div>'
        : `<table><thead><tr><th>Name</th><th>Text</th><th>Tests</th><th></th></tr></thead><tbody>${rows}</tbody></table>`}
    </div>
    <script>
      const configId = '${config.id}';
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
    </script>`);
}

// ── Question Editor Page ─────────────────────────────────────────────

export function questionEditorPage(question: QLQuestion, tests: QLTest[]): string {
  const versionItems = question.versions.map((v, i) => `
    <div class="version-item">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span class="timestamp">${new Date(v.timestamp).toLocaleString()}</span>
        <button class="btn-sm btn-secondary" onclick="restoreVersion(${i})">Restore</button>
      </div>
      <div class="text">${esc(v.text.length > 200 ? v.text.slice(0, 200) + "..." : v.text)}</div>
    </div>`).join("");

  const testRows = tests.map((t) => {
    const badgeClass = t.lastResult === "pass" ? "badge-pass" : t.lastResult === "fail" ? "badge-fail" : "badge-pending";
    const badgeText = t.lastResult ?? "untested";
    return `
    <tr onclick="toggleDetail('${t.id}')" style="cursor:pointer;">
      <td>${esc(t.snippet.length > 60 ? t.snippet.slice(0, 60) + "..." : t.snippet)}</td>
      <td><span class="badge ${t.expected === "yes" ? "badge-pass" : "badge-fail"}">${t.expected}</span></td>
      <td><span class="badge ${badgeClass}" id="badge-${t.id}">${badgeText}</span></td>
      <td>${t.lastRunAt ? new Date(t.lastRunAt).toLocaleString() : "-"}</td>
      <td><button class="btn-sm btn-danger" onclick="event.stopPropagation();deleteTest('${t.id}')">Delete</button></td>
    </tr>
    <tr><td colspan="5" style="padding:0;border:none;">
      <div class="test-detail" id="detail-${t.id}">
        ${t.lastThinking ? `<h4>Thinking</h4><p>${esc(t.lastThinking)}</p>` : ""}
        ${t.lastDefense ? `<h4>Defense</h4><p>${esc(t.lastDefense)}</p>` : ""}
        ${t.lastAnswer ? `<h4>Raw Answer</h4><p>${esc(t.lastAnswer)}</p>` : ""}
        ${!t.lastResult ? '<p style="color:#666;">Run a simulation to see results.</p>' : ""}
      </div>
    </td></tr>`;
  }).join("");

  const testIdsJson = JSON.stringify(tests.map((t) => t.id));

  return shell(question.name, `
    <div class="header">
      <div>
        <div class="breadcrumb"><a href="/question-lab">Question Lab</a> / <a href="/question-lab/config/${question.configId}">Config</a> / Question</div>
        <h1>${esc(question.name)}</h1>
      </div>
    </div>
    <div class="card">
      <h2>Question Editor</h2>
      <div class="form-row" style="margin-top:12px;"><label>Name</label><input type="text" id="q-name" value="${esc(question.name)}" /></div>
      <div class="form-row"><label>Question Text</label><textarea id="q-text" style="min-height:160px;">${esc(question.text)}</textarea></div>
      <div class="form-row"><label>Auto-Yes Expression (optional)</label><input type="text" id="q-autoyes" value="${esc(question.autoYesExp)}" placeholder="e.g. HAS_FLAG" /></div>
      <div class="actions"><button onclick="saveQuestion()">Save Changes</button></div>
    </div>
    <div class="card">
      <h2>Version History</h2>
      ${question.versions.length === 0
        ? '<div class="empty" style="padding:20px;">No previous versions yet.</div>'
        : `<div style="margin-top:12px;">${versionItems}</div>`}
    </div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h2>Tests (${tests.length})</h2>
        <div class="actions" style="margin:0;">
          <button class="btn-secondary" onclick="document.getElementById('new-test-form').classList.toggle('active')">Add Test</button>
          ${tests.length > 0 ? '<button onclick="simulateAll()">Simulate All</button>' : ""}
        </div>
      </div>
      <div id="new-test-form" class="inline-form">
        <div class="form-row"><label>Transcript Snippet</label><textarea id="test-snippet" placeholder="Paste transcript fragment here..."></textarea></div>
        <div class="form-row">
          <label>Expected Answer</label>
          <div class="toggle-group">
            <button id="exp-yes" class="active" onclick="setExpected('yes')">Yes</button>
            <button id="exp-no" onclick="setExpected('no')">No</button>
          </div>
        </div>
        <div class="actions">
          <button onclick="addTest()">Add Test</button>
          <button class="btn-secondary" onclick="document.getElementById('new-test-form').classList.remove('active')">Cancel</button>
        </div>
      </div>
      ${tests.length === 0
        ? '<div class="empty" style="padding:20px;">No tests yet. Add a snippet to start testing.</div>'
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
    </script>`);
}
