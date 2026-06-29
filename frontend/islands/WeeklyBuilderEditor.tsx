/** Island: Weekly Builder editor — stage per-dept / per-office configs and
 *  publish them as recurring EmailReportConfigs. Ports prod main:weekly-
 *  builder/page.ts.
 *
 *  Layout:
 *    Top bar  → custom report name input, test-email input, Send Test, Publish
 *    Left     → dept (with shifts) + office trees, each row stageable
 *    Right    → staged list with auto-derived recipients, preview, trash */
import { useEffect, useMemo, useState } from "preact/hooks";
import { WeeklyEditView, type ReportConfig } from "./EmailReportEditor.tsx";

interface ManagerScope { departments: string[]; shifts: string[] }
interface PartnerDims { offices: Record<string, string[]> }
interface AuditDims { departments: string[]; shifts: string[] }
interface BypassCfg { patterns?: string[] }
interface ExistingConfig {
  id: string;
  name: string;
  weeklyType?: string;
  weeklyDepartment?: string;
  weeklyShift?: string;
  weeklyOffice?: string;
}

interface DataResponse {
  partnerDims: PartnerDims;
  managerScopes: Record<string, ManagerScope>;
  bypassCfg: BypassCfg;
  existingConfigs: ExistingConfig[];
  auditDims: AuditDims;
  deptShifts?: Record<string, string[]>;
}

interface StagedConfig {
  type: "internal" | "partner";
  department?: string;
  office?: string;
  shift?: string | null;
  config: ReportConfig;
}

export default function WeeklyBuilderEditor() {
  const [data, setData] = useState<DataResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [staged, setStaged] = useState<StagedConfig[]>([]);
  const [reportName, setReportName] = useState("Weekly Audit Summary");
  const [testEmail, setTestEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState<ReportConfig | null>(null);
  const [stageAllOpen, setStageAllOpen] = useState(false);
  const [saType, setSaType] = useState<"internal" | "partner" | "both">("internal");
  const [saShifts, setSaShifts] = useState<string[]>(["All"]);
  const [saExcludeDepts, setSaExcludeDepts] = useState<string[]>([]);
  const [saExcludeOffices, setSaExcludeOffices] = useState<string[]>([]);
  const [globalEmails, setGlobalEmails] = useState<string[]>([]);

  useEffect(() => { void load(); }, []);
  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/admin/weekly-builder/data");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }

  // Invert manager scopes once: dept -> emails. Used for live recipient hints
  // on staging and for the right-pane recipient pill list.
  const deptEmails = useMemo(() => {
    const out: Record<string, string[]> = {};
    if (!data) return out;
    for (const [email, scope] of Object.entries(data.managerScopes ?? {})) {
      for (const dept of (scope?.departments ?? [])) {
        if (!out[dept]) out[dept] = [];
        if (!out[dept].includes(email)) out[dept].push(email);
      }
    }
    return out;
  }, [data]);

  function recipientsFor(staged: Pick<StagedConfig, "type" | "department" | "office">): string[] {
    if (!data) return [];
    if (staged.type === "internal") return deptEmails[staged.department ?? ""] ?? [];
    return data.partnerDims.offices?.[staged.office ?? ""] ?? [];
  }

  /** Shifts a department actually runs (from audit history). Falls back to the
   *  full shift list when coverage is unknown, so we never hide a department. */
  function shiftsForDept(dept: string): string[] {
    const all = data?.auditDims.shifts ?? [];
    const cov = data?.deptShifts?.[dept];
    return cov && cov.length > 0 ? all.filter((s) => cov.includes(s)) : all;
  }

  /** Layer the page-level "always include" emails onto a config's recipients
   *  (deduped). Applied at preview / test / publish so every report gets them,
   *  no matter how it was staged or when the global list changed. */
  function withGlobals(cfg: ReportConfig): ReportConfig {
    return globalEmails.length ? { ...cfg, recipients: dedupeEmails([...(cfg.recipients ?? []), ...globalEmails]) } : cfg;
  }

  function isPublished(s: { type: "internal" | "partner"; department?: string; office?: string; shift?: string | null }): boolean {
    if (!data) return false;
    return data.existingConfigs.some((c) => {
      if (c.weeklyType !== s.type) return false;
      if (s.type === "internal") return c.weeklyDepartment === s.department && (c.weeklyShift ?? null) === (s.shift ?? null);
      return c.weeklyOffice === s.office;
    });
  }

  function isStaged(s: { type: "internal" | "partner"; department?: string; office?: string; shift?: string | null }): boolean {
    return staged.some((x) => x.type === s.type && x.department === s.department && x.office === s.office && (x.shift ?? null) === (s.shift ?? null));
  }

  function buildName(s: { type: "internal" | "partner"; department?: string; office?: string; shift?: string | null }): string {
    if (s.type === "internal") return `${reportName} — ${s.department}${s.shift ? ` (${s.shift})` : ""}`;
    return `${reportName} — ${s.office}`;
  }

  function buildStagedConfig(s: { type: "internal" | "partner"; department?: string; office?: string; shift?: string | null }): ReportConfig {
    const name = buildName(s);
    return {
      name,
      recipients: recipientsFor(s),
      reportSections: [{
        header: name,
        columns: ["finalizedAt", "voName", "department", "score", "recordId", "findingId"],
        criteria: [],
      }],
      dateRange: { mode: "weekly", startDay: 1 },
      onlyCompleted: true,
      enabled: true,
      failedOnly: false,
      schedule: { cron: "0 9 * * *", tz: "America/New_York" },
      weeklyType: s.type,
      weeklyDepartment: s.department,
      weeklyShift: s.shift ?? undefined,
      weeklyOffice: s.office,
      topLevelFilters: buildFilters(s),
    };
  }

  function stage(s: { type: "internal" | "partner"; department?: string; office?: string; shift?: string | null }) {
    if (isStaged(s)) return;
    setStaged([...staged, {
      type: s.type,
      department: s.department,
      office: s.office,
      shift: s.shift ?? null,
      config: buildStagedConfig(s),
    }]);
    setMsg(null);
  }

  /** Bulk-stage every non-excluded department / office. Each report keeps its
   *  own manager-scoped recipients, plus any global emails (deduped). Skips
   *  anything already staged or published. */
  function runStageAll() {
    if (!data) return;
    const plan = planStageAll({
      type: saType,
      shifts: saShifts,
      departments: data.auditDims.departments ?? [],
      offices: Object.keys(data.partnerDims.offices ?? {}),
      deptEmails,
      officeEmails: data.partnerDims.offices ?? {},
      excludeDepts: saExcludeDepts,
      excludeOffices: saExcludeOffices,
      deptShifts: data.deptShifts,
      alreadyStaged: (sel) => isStaged(sel),
      alreadyPublished: (sel) => isPublished(sel),
    });

    setStageAllOpen(false);
    if (plan.length === 0) {
      setMsg({ kind: "err", text: "Nothing new to stage — all excluded or already staged/published." });
      return;
    }
    const additions: StagedConfig[] = plan.map((p) => {
      const config = buildStagedConfig({ type: p.type, department: p.department, office: p.office, shift: p.shift });
      config.recipients = p.recipients; // managers + globals, already deduped by planStageAll
      return { type: p.type, department: p.department, office: p.office, shift: p.shift, config };
    });
    setStaged([...staged, ...additions]);
    const noEmail = additions.filter((a) => (a.config.recipients ?? []).length === 0).length;
    setMsg({ kind: "ok", text: `Staged ${additions.length} report${additions.length === 1 ? "" : "s"}${noEmail ? ` · ${noEmail} with no recipients` : ""}.` });
  }

  /** Multi-select shifts. "All" (one combined report) is mutually exclusive
   *  with specific shifts; toggling off the last specific shift reverts to All. */
  function toggleSaShift(sh: string) {
    if (sh === "All") { setSaShifts(["All"]); return; }
    setSaShifts((prev) => {
      const base = prev.filter((x) => x !== "All");
      const next = base.includes(sh) ? base.filter((x) => x !== sh) : [...base, sh];
      return next.length === 0 ? ["All"] : next;
    });
  }

  function openEdit(idx: number) { setDraft(structuredClone(staged[idx].config)); setEditIdx(idx); }
  function closeEdit() { setEditIdx(null); setDraft(null); }
  function saveEdit(cfg: ReportConfig) {
    if (editIdx === null) return;
    setStaged(staged.map((x, i) => i === editIdx ? { ...x, config: cfg } : x));
    closeEdit();
  }

  function unstage(idx: number) { setStaged(staged.filter((_, i) => i !== idx)); }

  async function sendTest() {
    if (!testEmail.trim()) { setMsg({ kind: "err", text: "Enter a test email first." }); return; }
    if (staged.length === 0) { setMsg({ kind: "err", text: "Stage at least one config." }); return; }
    setBusy(true);
    try {
      const res = await fetch("/admin/weekly-builder/test-send", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ testEmail: testEmail.trim(), configs: staged.map((s) => ({ ...s, config: withGlobals(s.config) })) }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setMsg({ kind: "ok", text: `Sent ${data.sent ?? 0} test report${data.sent === 1 ? "" : "s"} to ${testEmail}${data.errors?.length ? ` (${data.errors.length} errors)` : ""}.` });
    } catch (e) { setMsg({ kind: "err", text: `Test send failed: ${(e as Error).message}` }); }
    finally { setBusy(false); }
  }

  async function publish() {
    if (staged.length === 0) { setMsg({ kind: "err", text: "Stage at least one config." }); return; }
    if (!globalThis.confirm(`Publish ${staged.length} weekly report config${staged.length === 1 ? "" : "s"}?`)) return;
    setBusy(true);
    try {
      const res = await fetch("/admin/weekly-builder/publish", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ configs: staged.map((s) => ({ ...s, config: withGlobals(s.config) })) }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const skipped = (data.skipped ?? []) as string[];
      setMsg({ kind: "ok", text: `Published ${data.created} config${data.created === 1 ? "" : "s"}${skipped.length ? `, skipped ${skipped.length} (already exists)` : ""}.` });
      setStaged([]);
      void load();
    } catch (e) { setMsg({ kind: "err", text: `Publish failed: ${(e as Error).message}` }); }
    finally { setBusy(false); }
  }

  async function previewConfig(cfg: ReportConfig) {
    setBusy(true);
    try {
      const res = await fetch("/admin/email-reports/preview-inline", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(withGlobals(cfg)),
      });
      const data = await res.json();
      setPreviewHtml(data.html ?? "");
    } catch (e) { setMsg({ kind: "err", text: `Preview failed: ${(e as Error).message}` }); }
    finally { setBusy(false); }
  }

  if (loading) return <div style="padding:40px;text-align:center;color:var(--text-dim);">Loading…</div>;
  if (error) return <div style="padding:40px;text-align:center;color:var(--red);">Failed to load: {error}</div>;
  if (!data) return null;

  const filterLc = filter.trim().toLowerCase();
  const internalDepts = (data.auditDims.departments ?? []).filter((d) => !filterLc || d.toLowerCase().includes(filterLc));
  const internalShifts = data.auditDims.shifts ?? [];
  const offices = Object.keys(data.partnerDims.offices ?? {}).filter((o) => !filterLc || o.toLowerCase().includes(filterLc));

  return (
    <div>
      {/* Top bar */}
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:14px;flex-wrap:wrap;">
        <div style="flex:1;min-width:200px;">
          <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:2px;text-transform:uppercase;letter-spacing:0.8px;">Report Name</label>
          <input class="sf-input" type="text" value={reportName} onInput={(e) => setReportName((e.target as HTMLInputElement).value)} style="font-size:12px;width:100%;" />
        </div>
        <div style="flex:1;min-width:200px;">
          <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:2px;text-transform:uppercase;letter-spacing:0.8px;">Test Email</label>
          <input class="sf-input" type="email" value={testEmail} placeholder="me@example.com" onInput={(e) => setTestEmail((e.target as HTMLInputElement).value)} style="font-size:12px;width:100%;" />
        </div>
        <button class="sf-btn" type="button" disabled={busy} onClick={sendTest} style="font-size:11px;">Send Test</button>
        <button class="sf-btn primary" type="button" disabled={busy || staged.length === 0} onClick={publish} style="font-size:11px;">Publish ({staged.length})</button>
      </div>

      {/* Global recipients — layered onto every report (each report = its
          department managers + these). Lives above the panes so it applies to
          everything staged, individually or via Stage All. */}
      <div style="margin-bottom:14px;">
        <EmailChips label="Always include these emails (added to every report)" placeholder="support@…, ceo@… — press Enter" value={globalEmails} onChange={setGlobalEmails} />
      </div>

      {msg && <div style={`margin-bottom:10px;font-size:11px;color:var(--${msg.kind === "ok" ? "green" : "red"});`}>{msg.text}</div>}

      <div style="display:grid;grid-template-columns:minmax(0,55fr) minmax(0,45fr);gap:14px;align-items:flex-start;">
        {/* Left pane — trees */}
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:8px;">
            <div class="tbl-title" style="margin:0;">Available</div>
            <div style="display:flex;align-items:center;gap:8px;">
              <button class="sf-btn" type="button" onClick={() => setStageAllOpen(true)} style="font-size:11px;">+ Stage All</button>
              <input class="sf-input" type="search" placeholder="Filter…" value={filter} onInput={(e) => setFilter((e.target as HTMLInputElement).value)} style="font-size:11px;width:160px;" />
            </div>
          </div>

          <div style="margin-bottom:14px;">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:6px;">Internal — Departments</div>
            {internalDepts.length === 0
              ? <div style="font-size:11px;color:var(--text-dim);padding:6px 0;">None.</div>
              : <div style="display:flex;flex-direction:column;gap:6px;">
                  {internalDepts.map((dept) => (
                    <DeptRow
                      key={dept}
                      dept={dept}
                      shifts={shiftsForDept(dept)}
                      recipients={deptEmails[dept] ?? []}
                      published={(shift) => isPublished({ type: "internal", department: dept, shift })}
                      staged={(shift) => isStaged({ type: "internal", department: dept, shift })}
                      onStage={(shift) => stage({ type: "internal", department: dept, shift })}
                    />
                  ))}
                </div>}
          </div>

          <div>
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:6px;">Partner — Offices</div>
            {offices.length === 0
              ? <div style="font-size:11px;color:var(--text-dim);padding:6px 0;">None.</div>
              : <div style="display:flex;flex-direction:column;gap:6px;">
                  {offices.map((office) => {
                    const recips = data.partnerDims.offices[office] ?? [];
                    const already = isPublished({ type: "partner", office });
                    const inStage = isStaged({ type: "partner", office });
                    return (
                      <div key={office} style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;">
                        <div style="flex:1;min-width:0;">
                          <div style="font-size:12px;font-weight:600;color:var(--text-bright);">{office}</div>
                          <div style="font-size:10px;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{recips.length > 0 ? recips.join(", ") : "no recipients configured"}</div>
                        </div>
                        {already && <span class="pill pill-green" style="font-size:9px;">Published</span>}
                        <button class="sf-btn" type="button" disabled={inStage || already} onClick={() => stage({ type: "partner", office })} style="font-size:10px;">{inStage ? "Staged" : "+ Stage"}</button>
                      </div>
                    );
                  })}
                </div>}
          </div>
        </div>

        {/* Right pane — staged list */}
        <div class="card">
          <div class="tbl-title" style="margin:0 0 10px;">Staged ({staged.length})</div>
          {staged.length === 0
            ? <div style="font-size:11px;color:var(--text-dim);padding:14px;text-align:center;border:1px dashed var(--border);border-radius:8px;">Stage a department or office on the left.</div>
            : <div style="display:flex;flex-direction:column;gap:8px;">
                {staged.map((s, i) => {
                  const recips = dedupeEmails([...(s.config.recipients ?? []), ...globalEmails]);
                  const noEmails = recips.length === 0;
                  return (
                  <div key={i} style={`display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:8px;background:${noEmails ? "rgba(248,81,73,0.12)" : "var(--bg)"};border:1px solid ${noEmails ? "var(--red)" : "var(--border)"};`}>
                    <div style="flex:1;min-width:0;">
                      <div style="font-size:12px;font-weight:600;color:var(--text-bright);">
                        {s.config.name}
                        {noEmails && <span style="margin-left:6px;font-size:8px;font-weight:700;letter-spacing:0.5px;background:var(--red);color:#fff;padding:1px 6px;border-radius:4px;vertical-align:middle;">NO EMAILS</span>}
                      </div>
                      <div style="font-size:10px;color:var(--text-dim);margin-top:2px;">
                        {s.type === "internal" ? `Internal · ${s.department}${s.shift ? ` · ${s.shift}` : ""}` : `Partner · ${s.office}`}
                        {" · "}
                        <span style={noEmails ? "color:var(--red);" : ""}>{recips.length} recipient{recips.length === 1 ? "" : "s"}</span>
                      </div>
                      {recips.length > 0 && (
                        <div style="font-size:10px;color:var(--text-muted);margin-top:2px;overflow-wrap:anywhere;line-height:1.5;">{recips.join(", ")}</div>
                      )}
                    </div>
                    <button class="sf-btn ghost" type="button" disabled={busy} onClick={() => openEdit(i)} style="font-size:10px;padding:4px 8px;" title="Edit">✎</button>
                    <button class="sf-btn ghost" type="button" disabled={busy} onClick={() => previewConfig(s.config)} style="font-size:10px;padding:4px 8px;" title="Preview">👁</button>
                    <button class="sf-btn danger" type="button" disabled={busy} onClick={() => unstage(i)} style="font-size:10px;padding:4px 8px;" title="Remove">🗑</button>
                  </div>
                  );
                })}
              </div>}
        </div>
      </div>

      {previewHtml !== null && <PreviewOverlay html={previewHtml} onClose={() => setPreviewHtml(null)} />}
      {editIdx !== null && draft && (
        <div class="modal-overlay open" style="z-index:200;" onClick={(e) => { if (e.target === e.currentTarget) closeEdit(); }}>
          <div class="modal" style="width:min(900px,96vw);max-width:96vw;max-height:90vh;overflow:auto;padding:0;">
            <WeeklyEditView
              config={draft}
              isNew={false}
              templates={[]}
              busy={busy}
              msg={null}
              stagingMode
              onChange={setDraft}
              onCancel={closeEdit}
              onSave={saveEdit}
              onPreview={previewConfig}
            />
          </div>
        </div>
      )}
      {stageAllOpen && (
        <div class="modal-overlay open" style="z-index:200;" onClick={(e) => { if (e.target === e.currentTarget) setStageAllOpen(false); }}>
          <div class="modal" style="width:min(560px,96vw);max-width:96vw;max-height:90vh;overflow:auto;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
              <div class="modal-title" style="margin:0;">Stage All</div>
              <button type="button" class="sf-btn ghost" style="font-size:11px;" onClick={() => setStageAllOpen(false)}>Close</button>
            </div>

            <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:var(--text-dim);margin-bottom:6px;">What to stage</div>
            <div style="display:flex;gap:8px;">
              {(["internal", "partner", "both"] as const).map((t) => (
                <button key={t} type="button" class={`sf-btn ${saType === t ? "primary" : ""}`} onClick={() => setSaType(t)} style="font-size:12px;flex:1;text-transform:capitalize;">{t}</button>
              ))}
            </div>

            {(saType === "internal" || saType === "both") && (
              <div style="margin-top:14px;border-top:1px solid var(--border);padding-top:12px;">
                <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:var(--text-dim);margin-bottom:6px;">Internal — shifts (a report per department, per selected shift)</div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:4px;">
                  {[...internalShifts, "All"].map((sh) => (
                    <button key={sh} type="button" class={`sf-btn ${saShifts.includes(sh) ? "primary" : ""}`} onClick={() => toggleSaShift(sh)} style="font-size:11px;">{sh}</button>
                  ))}
                </div>
                <ChipSearch label="Exclude departments" placeholder="Type a department to exclude…" options={data.auditDims.departments ?? []} selected={saExcludeDepts} onChange={setSaExcludeDepts} listId="sa-dept-list" />
              </div>
            )}

            {(saType === "partner" || saType === "both") && (
              <div style="margin-top:14px;border-top:1px solid var(--border);padding-top:12px;">
                <ChipSearch label="Exclude offices" placeholder="Type an office to exclude…" options={Object.keys(data.partnerDims.offices ?? {})} selected={saExcludeOffices} onChange={setSaExcludeOffices} listId="sa-office-list" />
              </div>
            )}

            <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px;">
              <button class="sf-btn" type="button" onClick={() => setStageAllOpen(false)} style="font-size:12px;">Cancel</button>
              <button class="sf-btn primary" type="button" onClick={runStageAll} style="font-size:12px;">Stage</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function dedupeEmails(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of arr) {
    const v = (e ?? "").trim();
    const k = v.toLowerCase();
    if (v && !seen.has(k)) { seen.add(k); out.push(v); }
  }
  return out;
}

export interface StageAllSelection {
  type: "internal" | "partner";
  department?: string;
  office?: string;
  shift: string | null;
  recipients: string[];
}

type StageAllSel = { type: "internal" | "partner"; department?: string; office?: string; shift: string | null };

/** Pure decision logic for "Stage All": which departments/offices to stage and
 *  their final recipient lists. Excludes the excluded, skips anything already
 *  staged/published, and merges global emails into each report (deduped, case-
 *  insensitive). Kept pure + exported so it can be unit-tested without the UI. */
export function planStageAll(input: {
  type: "internal" | "partner" | "both";
  shifts: string[]; // shift names to stage (a report each), or ["All"]/[] for one combined report
  departments: string[];
  offices: string[];
  deptEmails: Record<string, string[]>;
  officeEmails: Record<string, string[]>;
  excludeDepts: string[];
  excludeOffices: string[];
  deptShifts?: Record<string, string[]>;
  alreadyStaged: (sel: StageAllSel) => boolean;
  alreadyPublished: (sel: StageAllSel) => boolean;
}): StageAllSelection[] {
  const out: StageAllSelection[] = [];
  // "All" (or nothing selected) → one combined report (no shift filter);
  // otherwise one report per selected shift.
  const shifts: (string | null)[] = (input.shifts.includes("All") || input.shifts.length === 0) ? [null] : input.shifts;
  if (input.type === "internal" || input.type === "both") {
    for (const department of input.departments) {
      if (input.excludeDepts.includes(department)) continue;
      const deptCov = input.deptShifts?.[department];
      for (const shift of shifts) {
        // Skip a specific shift the department doesn't actually run (e.g. Weekend
        // for non-weekend departments). Unknown coverage → don't skip (offer it).
        if (shift !== null && deptCov && deptCov.length > 0 && !deptCov.includes(shift)) continue;
        const sel = { type: "internal" as const, department, shift };
        if (input.alreadyStaged(sel) || input.alreadyPublished(sel)) continue;
        out.push({ ...sel, recipients: dedupeEmails(input.deptEmails[department] ?? []) });
      }
    }
  }
  if (input.type === "partner" || input.type === "both") {
    for (const office of input.offices) {
      if (input.excludeOffices.includes(office)) continue;
      const sel = { type: "partner" as const, office, shift: null };
      if (input.alreadyStaged(sel) || input.alreadyPublished(sel)) continue;
      out.push({ ...sel, recipients: dedupeEmails(input.officeEmails[office] ?? []) });
    }
  }
  return out;
}

function ChipSearch({ label, placeholder, options, selected, onChange, listId }: {
  label: string;
  placeholder: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  listId: string;
}) {
  const [q, setQ] = useState("");
  const add = (val: string) => {
    const v = val.trim();
    if (v && options.includes(v) && !selected.includes(v)) onChange([...selected, v]);
    setQ("");
  };
  return (
    <div>
      <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.8px;">{label}</label>
      <input
        class="sf-input"
        type="text"
        list={listId}
        value={q}
        placeholder={placeholder}
        onInput={(e) => setQ((e.target as HTMLInputElement).value)}
        onChange={(e) => add((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(q); } }}
        style="font-size:12px;width:100%;"
      />
      <datalist id={listId}>{options.filter((o) => !selected.includes(o)).map((o) => <option key={o} value={o} />)}</datalist>
      {selected.length > 0 && (
        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;">
          {selected.map((s) => (
            <span key={s} style="display:inline-flex;align-items:center;gap:4px;font-size:11px;background:var(--bg-raised);border:1px solid var(--border);border-radius:5px;padding:2px 6px;color:var(--text-bright);">
              {s}
              <button type="button" onClick={() => onChange(selected.filter((x) => x !== s))} style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:13px;line-height:1;padding:0;">×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function EmailChips({ label, placeholder, value, onChange }: {
  label: string;
  placeholder: string;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const add = () => {
    const v = q.trim().replace(/,+$/, "").trim();
    if (v && !value.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...value, v]);
    setQ("");
  };
  return (
    <div>
      <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.8px;">{label}</label>
      <input
        class="sf-input"
        type="email"
        value={q}
        placeholder={placeholder}
        onInput={(e) => setQ((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } }}
        onBlur={add}
        style="font-size:12px;width:100%;"
      />
      {value.length > 0 && (
        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;">
          {value.map((s) => (
            <span key={s} style="display:inline-flex;align-items:center;gap:4px;font-size:11px;background:var(--bg-raised);border:1px solid var(--border);border-radius:5px;padding:2px 6px;color:var(--text-bright);">
              {s}
              <button type="button" onClick={() => onChange(value.filter((x) => x !== s))} style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:13px;line-height:1;padding:0;">×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function buildFilters(s: StagedConfig) {
  const filters: { field: string; operator: string; value: string }[] = [];
  if (s.type === "internal") {
    filters.push({ field: "auditType", operator: "equals", value: "internal" });
    if (s.department) filters.push({ field: "department", operator: "equals", value: s.department });
    if (s.shift) filters.push({ field: "shift", operator: "equals", value: s.shift });
  } else {
    filters.push({ field: "auditType", operator: "equals", value: "partner" });
    if (s.office) filters.push({ field: "department", operator: "equals", value: s.office });
  }
  filters.push({ field: "appealStatus", operator: "not_equals", value: "pending" });
  return filters;
}

function DeptRow({ dept, shifts, recipients, published, staged, onStage }: {
  dept: string;
  shifts: string[];
  recipients: string[];
  published: (shift: string | null) => boolean;
  staged: (shift: string | null) => boolean;
  onStage: (shift: string | null) => void;
}) {
  const allShiftAlready = published(null);
  const allShiftStaged = staged(null);
  return (
    <div style="border:1px solid var(--border);border-radius:6px;background:var(--bg);">
      <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;font-weight:600;color:var(--text-bright);">{dept}</div>
          <div style="font-size:10px;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{recipients.length > 0 ? recipients.join(", ") : "no manager-scope recipients"}</div>
        </div>
        {allShiftAlready && <span class="pill pill-green" style="font-size:9px;">Published</span>}
        <button class="sf-btn" type="button" disabled={allShiftStaged || allShiftAlready} onClick={() => onStage(null)} style="font-size:10px;">{allShiftStaged ? "Staged" : "+ All shifts"}</button>
      </div>
      {shifts.length > 0 && (
        <div style="display:flex;flex-wrap:wrap;gap:4px;padding:0 8px 8px;">
          {shifts.map((shift) => {
            const already = published(shift);
            const inStage = staged(shift);
            return (
              <button
                key={shift}
                type="button"
                class={`sf-btn ${inStage ? "primary" : ""}`}
                disabled={inStage || already}
                onClick={() => onStage(shift)}
                style="font-size:10px;padding:3px 8px;"
              >{shift}{already ? " ✓" : ""}</button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PreviewOverlay({ html, onClose }: { html: string; onClose: () => void }) {
  return (
    <div class="modal-overlay open" style="z-index:200;" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="modal" style="width:min(960px,96vw);max-width:96vw;height:88vh;display:flex;flex-direction:column;padding:0;overflow:hidden;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border);">
          <div class="modal-title" style="margin:0;">Preview</div>
          <button type="button" class="sf-btn ghost" style="font-size:11px;" onClick={onClose}>Close</button>
        </div>
        <iframe srcDoc={html} sandbox="allow-same-origin" style="flex:1;width:100%;border:none;background:#fff;display:block;min-height:0;" />
      </div>
    </div>
  );
}
