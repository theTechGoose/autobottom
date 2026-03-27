/**
 * QuestionLabEditor island — Question Lab config/question management.
 * Supports three views:
 *   - "list": top-level config list
 *   - "config": config detail with question list
 *   - "question": question editor with version history and test runner
 *
 * API endpoints mirror the legacy handlers:
 *   GET  /question-lab/api/configs
 *   POST /question-lab/api/configs
 *   PUT  /question-lab/api/configs/:id
 *   DELETE /question-lab/api/configs/:id
 *   POST /question-lab/api/configs/:id/questions
 *   GET  /question-lab/api/questions/:id
 *   PUT  /question-lab/api/questions/:id
 *   DELETE /question-lab/api/questions/:id
 *   POST /question-lab/api/questions/:id/restore/:index
 *   POST /question-lab/api/questions/:id/tests
 *   DELETE /question-lab/api/tests/:id
 *   POST /question-lab/api/simulate
 */

import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";

interface QLConfig {
  id: string;
  name: string;
  questionIds: string[];
  createdAt: number;
}

interface QLVersion {
  timestamp: number;
  text: string;
}

interface QLQuestion {
  id: string;
  configId: string;
  name: string;
  text: string;
  autoYesExp: string;
  versions: QLVersion[];
  testIds: string[];
}

interface QLTest {
  id: string;
  snippet: string;
  expected: "yes" | "no";
  lastResult?: "pass" | "fail";
  lastRunAt?: number;
  lastThinking?: string;
  lastDefense?: string;
  lastAnswer?: string;
}

type View = "list" | "config" | "question";
type TestStatus = "running" | "pass" | "fail" | "pending";

export default function QuestionLabEditor() {
  const view = useSignal<View>("list");
  const configs = useSignal<QLConfig[]>([]);
  const activeConfig = useSignal<QLConfig | null>(null);
  const questions = useSignal<QLQuestion[]>([]);
  const activeQuestion = useSignal<QLQuestion | null>(null);
  const tests = useSignal<QLTest[]>([]);

  // Form state — config list
  const showNewConfig = useSignal(false);
  const newConfigName = useSignal("");

  // Form state — config detail
  const configName = useSignal("");
  const showNewQuestion = useSignal(false);
  const newQName = useSignal("");
  const newQText = useSignal("");

  // Form state — question editor
  const qName = useSignal("");
  const qText = useSignal("");
  const qAutoYes = useSignal("");
  const showNewTest = useSignal(false);
  const testSnippet = useSignal("");
  const testExpected = useSignal<"yes" | "no">("yes");
  const testStatuses = useSignal<Record<string, TestStatus>>({});
  const expandedTests = useSignal<Set<string>>(new Set());

  const toastMsg = useSignal("");
  const toastType = useSignal("success");

  function showToast(msg: string, type = "success") {
    toastMsg.value = msg;
    toastType.value = type;
    setTimeout(() => { toastMsg.value = ""; }, 2000);
  }

  // ── Config list ──────────────────────────────────────────────

  async function loadConfigs() {
    try {
      const res = await fetch("/question-lab/api/configs");
      if (!res.ok) return;
      configs.value = await res.json() || [];
    } catch {
      // ignore
    }
  }

  async function createConfig() {
    const name = newConfigName.value.trim();
    if (!name) return;
    try {
      const res = await fetch("/question-lab/api/configs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error("Create failed");
      newConfigName.value = "";
      showNewConfig.value = false;
      await loadConfigs();
    } catch (err) {
      showToast((err as Error).message, "error");
    }
  }

  async function deleteConfig(id: string) {
    if (!confirm("Delete this config and all its questions?")) return;
    try {
      await fetch(`/question-lab/api/configs/${id}`, { method: "DELETE" });
      await loadConfigs();
    } catch (err) {
      showToast((err as Error).message, "error");
    }
  }

  // ── Config detail ────────────────────────────────────────────

  async function openConfig(config: QLConfig) {
    activeConfig.value = config;
    configName.value = config.name;
    view.value = "config";
    await loadQuestions(config.id);
  }

  async function loadQuestions(configId: string) {
    try {
      const res = await fetch(`/question-lab/api/configs/${configId}`);
      if (!res.ok) return;
      const data = await res.json();
      questions.value = data.questions || [];
    } catch {
      // ignore
    }
  }

  async function renameConfig() {
    const name = configName.value.trim();
    if (!name || !activeConfig.value) return;
    try {
      const res = await fetch(`/question-lab/api/configs/${activeConfig.value.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error("Rename failed");
      showToast("Config renamed");
    } catch (err) {
      showToast((err as Error).message, "error");
    }
  }

  async function addQuestion() {
    const name = newQName.value.trim();
    const text = newQText.value.trim();
    if (!name || !text || !activeConfig.value) return;
    try {
      const res = await fetch(
        `/question-lab/api/configs/${activeConfig.value.id}/questions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, text }),
        },
      );
      if (!res.ok) throw new Error("Create failed");
      newQName.value = "";
      newQText.value = "";
      showNewQuestion.value = false;
      await loadQuestions(activeConfig.value.id);
    } catch (err) {
      showToast((err as Error).message, "error");
    }
  }

  async function deleteQuestion(id: string) {
    if (!confirm("Delete this question and all its tests?")) return;
    try {
      await fetch(`/question-lab/api/questions/${id}`, { method: "DELETE" });
      if (activeConfig.value) await loadQuestions(activeConfig.value.id);
    } catch (err) {
      showToast((err as Error).message, "error");
    }
  }

  // ── Question editor ──────────────────────────────────────────

  async function openQuestion(q: QLQuestion) {
    activeQuestion.value = q;
    qName.value = q.name;
    qText.value = q.text;
    qAutoYes.value = q.autoYesExp || "";
    testStatuses.value = {};
    view.value = "question";
    await loadTests(q.id);
  }

  async function loadTests(questionId: string) {
    try {
      const res = await fetch(`/question-lab/api/questions/${questionId}`);
      if (!res.ok) return;
      const data = await res.json();
      activeQuestion.value = data.question;
      tests.value = data.tests || [];
    } catch {
      // ignore
    }
  }

  async function saveQuestion() {
    const name = qName.value.trim();
    const text = qText.value.trim();
    if (!name || !text || !activeQuestion.value) return;
    try {
      const res = await fetch(`/question-lab/api/questions/${activeQuestion.value.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, text, autoYesExp: qAutoYes.value }),
      });
      if (!res.ok) throw new Error("Save failed");
      showToast("Question saved");
      await loadTests(activeQuestion.value.id);
    } catch (err) {
      showToast((err as Error).message, "error");
    }
  }

  async function restoreVersion(index: number) {
    if (!confirm("Restore this version? Current text will be saved to history.")) return;
    if (!activeQuestion.value) return;
    try {
      await fetch(
        `/question-lab/api/questions/${activeQuestion.value.id}/restore/${index}`,
        { method: "POST" },
      );
      await loadTests(activeQuestion.value.id);
    } catch (err) {
      showToast((err as Error).message, "error");
    }
  }

  async function addTest() {
    const snippet = testSnippet.value.trim();
    if (!snippet || !activeQuestion.value) return;
    try {
      const res = await fetch(
        `/question-lab/api/questions/${activeQuestion.value.id}/tests`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ snippet, expected: testExpected.value }),
        },
      );
      if (!res.ok) throw new Error("Create failed");
      testSnippet.value = "";
      showNewTest.value = false;
      await loadTests(activeQuestion.value.id);
    } catch (err) {
      showToast((err as Error).message, "error");
    }
  }

  async function deleteTest(id: string) {
    if (!confirm("Delete this test?")) return;
    try {
      await fetch(`/question-lab/api/tests/${id}`, { method: "DELETE" });
      if (activeQuestion.value) await loadTests(activeQuestion.value.id);
    } catch (err) {
      showToast((err as Error).message, "error");
    }
  }

  async function simulateAll() {
    if (!activeQuestion.value || tests.value.length === 0) return;
    const testIds = tests.value.map((t) => t.id);

    // Mark all as running
    const statuses: Record<string, TestStatus> = {};
    testIds.forEach((id) => { statuses[id] = "running"; });
    testStatuses.value = statuses;

    try {
      const res = await fetch("/question-lab/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionText: qText.value, testIds }),
      });
      if (!res.ok) throw new Error("Simulate failed");

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop()!;
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = JSON.parse(line.slice(6));
          if (data.done) {
            await loadTests(activeQuestion.value!.id);
            return;
          }
          testStatuses.value = {
            ...testStatuses.value,
            [data.testId]: data.status === "pass" ? "pass" : "fail",
          };
        }
      }
    } catch (err) {
      showToast((err as Error).message, "error");
      const cleared: Record<string, TestStatus> = {};
      testIds.forEach((id) => { cleared[id] = "pending"; });
      testStatuses.value = cleared;
    }
  }

  function toggleTestDetail(id: string) {
    const s = new Set(expandedTests.value);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    expandedTests.value = s;
  }

  useEffect(() => {
    loadConfigs();
  }, []);

  // ── Render ───────────────────────────────────────────────────

  const renderBadge = (t: QLTest) => {
    const status = testStatuses.value[t.id];
    if (status === "running") return <span class="badge badge-running">running</span>;
    if (status === "pass") return <span class="badge badge-pass">pass</span>;
    if (status === "fail") return <span class="badge badge-fail">fail</span>;
    if (t.lastResult === "pass") return <span class="badge badge-pass">pass</span>;
    if (t.lastResult === "fail") return <span class="badge badge-fail">fail</span>;
    return <span class="badge badge-pending">untested</span>;
  };

  return (
    <div class="container">
      {/* ── Config list view ── */}
      {view.value === "list" && (
        <>
          <div class="header">
            <h1>Question Lab</h1>
          </div>
          <div class="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h2>Configurations</h2>
              <button onClick={() => { showNewConfig.value = !showNewConfig.value; }}>
                New Config
              </button>
            </div>

            {showNewConfig.value && (
              <div class="inline-form active">
                <div class="form-row">
                  <label>Config Name</label>
                  <input
                    type="text"
                    value={newConfigName.value}
                    onInput={(e) => { newConfigName.value = (e.target as HTMLInputElement).value; }}
                    placeholder="e.g. VO Audit Questions v2"
                  />
                </div>
                <div class="actions">
                  <button onClick={createConfig}>Create</button>
                  <button class="btn-secondary" onClick={() => { showNewConfig.value = false; }}>Cancel</button>
                </div>
              </div>
            )}

            {configs.value.length === 0
              ? <div class="empty">No configurations yet. Create one to get started.</div>
              : (
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Questions</th>
                      <th>Created</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {configs.value.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <a
                            href="#"
                            onClick={(e) => { e.preventDefault(); openConfig(c); }}
                          >
                            {c.name}
                          </a>
                        </td>
                        <td>{c.questionIds.length}</td>
                        <td>{new Date(c.createdAt).toLocaleDateString()}</td>
                        <td>
                          <button
                            class="btn-sm btn-danger"
                            onClick={() => deleteConfig(c.id)}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
          </div>
        </>
      )}

      {/* ── Config detail view ── */}
      {view.value === "config" && activeConfig.value && (
        <>
          <div class="header">
            <div>
              <div class="breadcrumb">
                <a href="#" onClick={(e) => { e.preventDefault(); view.value = "list"; loadConfigs(); }}>
                  Question Lab
                </a>
                {" / Config"}
              </div>
              <h1>{activeConfig.value.name}</h1>
            </div>
          </div>

          <div class="card">
            <div class="form-row">
              <label>Config Name</label>
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  type="text"
                  value={configName.value}
                  onInput={(e) => { configName.value = (e.target as HTMLInputElement).value; }}
                />
                <button onClick={renameConfig}>Save</button>
              </div>
            </div>
          </div>

          <div class="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h2>Questions ({questions.value.length})</h2>
              <button onClick={() => { showNewQuestion.value = !showNewQuestion.value; }}>
                Add Question
              </button>
            </div>

            {showNewQuestion.value && (
              <div class="inline-form active">
                <div class="form-row">
                  <label>Question Name (short label)</label>
                  <input
                    type="text"
                    value={newQName.value}
                    onInput={(e) => { newQName.value = (e.target as HTMLInputElement).value; }}
                    placeholder="e.g. Disclosure Check"
                  />
                </div>
                <div class="form-row">
                  <label>Question Text</label>
                  <textarea
                    value={newQText.value}
                    onInput={(e) => { newQText.value = (e.target as HTMLTextAreaElement).value; }}
                    placeholder="e.g. Did the agent disclose that the offer is promotional?"
                  />
                </div>
                <div class="actions">
                  <button onClick={addQuestion}>Add</button>
                  <button class="btn-secondary" onClick={() => { showNewQuestion.value = false; }}>Cancel</button>
                </div>
              </div>
            )}

            {questions.value.length === 0
              ? <div class="empty">No questions yet. Add one to get started.</div>
              : (
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Text</th>
                      <th>Tests</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {questions.value.map((q) => (
                      <tr key={q.id}>
                        <td>
                          <a
                            href="#"
                            onClick={(e) => { e.preventDefault(); openQuestion(q); }}
                          >
                            {q.name}
                          </a>
                        </td>
                        <td>{q.text.length > 80 ? q.text.slice(0, 80) + "..." : q.text}</td>
                        <td>{q.testIds.length}</td>
                        <td>
                          <button
                            class="btn-sm btn-danger"
                            onClick={() => deleteQuestion(q.id)}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
          </div>
        </>
      )}

      {/* ── Question editor view ── */}
      {view.value === "question" && activeQuestion.value && (
        <>
          <div class="header">
            <div>
              <div class="breadcrumb">
                <a href="#" onClick={(e) => { e.preventDefault(); view.value = "list"; loadConfigs(); }}>
                  Question Lab
                </a>
                {" / "}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    view.value = "config";
                    if (activeConfig.value) loadQuestions(activeConfig.value.id);
                  }}
                >
                  Config
                </a>
                {" / Question"}
              </div>
              <h1>{activeQuestion.value.name}</h1>
            </div>
          </div>

          <div class="card">
            <h2>Question Editor</h2>
            <div class="form-row" style={{ marginTop: "12px" }}>
              <label>Name</label>
              <input
                type="text"
                value={qName.value}
                onInput={(e) => { qName.value = (e.target as HTMLInputElement).value; }}
              />
            </div>
            <div class="form-row">
              <label>Question Text</label>
              <textarea
                value={qText.value}
                style={{ minHeight: "160px" }}
                onInput={(e) => { qText.value = (e.target as HTMLTextAreaElement).value; }}
              />
            </div>
            <div class="form-row">
              <label>Auto-Yes Expression (optional)</label>
              <input
                type="text"
                value={qAutoYes.value}
                onInput={(e) => { qAutoYes.value = (e.target as HTMLInputElement).value; }}
                placeholder="e.g. HAS_FLAG"
              />
            </div>
            <div class="actions">
              <button onClick={saveQuestion}>Save Changes</button>
            </div>
          </div>

          {/* Version History */}
          <div class="card">
            <h2>Version History</h2>
            {(activeQuestion.value.versions?.length || 0) === 0
              ? <div class="empty" style={{ padding: "20px" }}>No previous versions yet.</div>
              : (
                <div style={{ marginTop: "12px" }}>
                  {activeQuestion.value.versions.map((v, i) => (
                    <div key={i} class="version-item">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span class="timestamp">{new Date(v.timestamp).toLocaleString()}</span>
                        <button class="btn-sm btn-secondary" onClick={() => restoreVersion(i)}>
                          Restore
                        </button>
                      </div>
                      <div class="text">
                        {v.text.length > 200 ? v.text.slice(0, 200) + "..." : v.text}
                      </div>
                    </div>
                  ))}
                </div>
              )}
          </div>

          {/* Tests */}
          <div class="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h2>Tests ({tests.value.length})</h2>
              <div class="actions" style={{ margin: 0 }}>
                <button
                  class="btn-secondary"
                  onClick={() => { showNewTest.value = !showNewTest.value; }}
                >
                  Add Test
                </button>
                {tests.value.length > 0 && (
                  <button onClick={simulateAll}>Simulate All</button>
                )}
              </div>
            </div>

            {showNewTest.value && (
              <div class="inline-form active">
                <div class="form-row">
                  <label>Transcript Snippet</label>
                  <textarea
                    value={testSnippet.value}
                    onInput={(e) => { testSnippet.value = (e.target as HTMLTextAreaElement).value; }}
                    placeholder="Paste transcript fragment here..."
                  />
                </div>
                <div class="form-row">
                  <label>Expected Answer</label>
                  <div class="toggle-group">
                    <button
                      class={testExpected.value === "yes" ? "active" : ""}
                      onClick={() => { testExpected.value = "yes"; }}
                    >
                      Yes
                    </button>
                    <button
                      class={testExpected.value === "no" ? "active" : ""}
                      onClick={() => { testExpected.value = "no"; }}
                    >
                      No
                    </button>
                  </div>
                </div>
                <div class="actions">
                  <button onClick={addTest}>Add Test</button>
                  <button class="btn-secondary" onClick={() => { showNewTest.value = false; }}>Cancel</button>
                </div>
              </div>
            )}

            {tests.value.length === 0
              ? <div class="empty" style={{ padding: "20px" }}>No tests yet. Add a snippet to start testing.</div>
              : (
                <table>
                  <thead>
                    <tr>
                      <th>Snippet</th>
                      <th>Expected</th>
                      <th>Result</th>
                      <th>Last Run</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {tests.value.map((t) => (
                      <>
                        <tr
                          key={t.id}
                          style={{ cursor: "pointer" }}
                          onClick={() => toggleTestDetail(t.id)}
                        >
                          <td>{t.snippet.length > 60 ? t.snippet.slice(0, 60) + "..." : t.snippet}</td>
                          <td>
                            <span class={`badge ${t.expected === "yes" ? "badge-pass" : "badge-fail"}`}>
                              {t.expected}
                            </span>
                          </td>
                          <td>{renderBadge(t)}</td>
                          <td>{t.lastRunAt ? new Date(t.lastRunAt).toLocaleString() : "-"}</td>
                          <td>
                            <button
                              class="btn-sm btn-danger"
                              onClick={(e) => { e.stopPropagation(); deleteTest(t.id); }}
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                        {expandedTests.value.has(t.id) && (
                          <tr key={`${t.id}-detail`}>
                            <td colSpan={5} style={{ padding: 0, border: "none" }}>
                              <div class="test-detail active">
                                {t.lastThinking && (
                                  <>
                                    <h4>Thinking</h4>
                                    <p>{t.lastThinking}</p>
                                  </>
                                )}
                                {t.lastDefense && (
                                  <>
                                    <h4>Defense</h4>
                                    <p>{t.lastDefense}</p>
                                  </>
                                )}
                                {t.lastAnswer && (
                                  <>
                                    <h4>Raw Answer</h4>
                                    <p>{t.lastAnswer}</p>
                                  </>
                                )}
                                {!t.lastResult && (
                                  <p style={{ color: "#666" }}>Run a simulation to see results.</p>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              )}
          </div>
        </>
      )}

      {/* Toast */}
      {toastMsg.value && (
        <div class={`badge${toastType.value === "error" ? " badge-fail" : " badge-pass"}`}
          style={{
            position: "fixed",
            bottom: "24px",
            left: "50%",
            transform: "translateX(-50%)",
            padding: "8px 20px",
            fontSize: "13px",
            zIndex: 100,
          }}
        >
          {toastMsg.value}
        </div>
      )}
    </div>
  );
}
