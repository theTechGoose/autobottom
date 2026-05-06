/** Island: Weekly Builder editor — stage per-dept / per-office configs and
 *  publish them as recurring EmailReportConfigs. Ports prod main:weekly-
 *  builder/page.ts.
 *
 *  Layout:
 *    Top bar  → custom report name input, test-email input, Send Test, Publish
 *    Left     → dept (with shifts) + office trees, each row stageable
 *    Right    → staged list with auto-derived recipients, preview, trash */
import { useEffect, useMemo, useState } from "preact/hooks";

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
}

interface StagedConfig {
  type: "internal" | "partner";
  department?: string;
  office?: string;
  shift?: string | null;
  name: string;
  recipients: string[];
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

  function stage(s: { type: "internal" | "partner"; department?: string; office?: string; shift?: string | null }) {
    if (isStaged(s)) return;
    const cfg: StagedConfig = {
      type: s.type,
      department: s.department,
      office: s.office,
      shift: s.shift ?? null,
      name: buildName(s),
      recipients: recipientsFor(s),
    };
    setStaged([...staged, cfg]);
    setMsg(null);
  }

  function unstage(idx: number) { setStaged(staged.filter((_, i) => i !== idx)); }

  async function sendTest() {
    if (!testEmail.trim()) { setMsg({ kind: "err", text: "Enter a test email first." }); return; }
    if (staged.length === 0) { setMsg({ kind: "err", text: "Stage at least one config." }); return; }
    setBusy(true);
    try {
      const res = await fetch("/admin/weekly-builder/test-send", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ testEmail: testEmail.trim(), configs: staged }),
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
        body: JSON.stringify({ configs: staged }),
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

  async function preview(s: StagedConfig) {
    setBusy(true);
    try {
      const ephemeral = {
        name: s.name,
        recipients: s.recipients,
        reportSections: [{
          header: s.name,
          columns: ["finalizedAt", "voName", "department", "score", "recordId", "findingId"],
          criteria: [],
        }],
        dateRange: { mode: "weekly", startDay: 1 },
        onlyCompleted: true,
        topLevelFilters: buildFilters(s),
      };
      const res = await fetch("/admin/email-reports/preview-inline", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(ephemeral),
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
      {msg && <div style={`margin-bottom:10px;font-size:11px;color:var(--${msg.kind === "ok" ? "green" : "red"});`}>{msg.text}</div>}

      <div style="display:grid;grid-template-columns:55fr 45fr;gap:14px;align-items:flex-start;">
        {/* Left pane — trees */}
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <div class="tbl-title" style="margin:0;">Available</div>
            <input class="sf-input" type="search" placeholder="Filter…" value={filter} onInput={(e) => setFilter((e.target as HTMLInputElement).value)} style="font-size:11px;width:160px;" />
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
                      shifts={internalShifts}
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
                {staged.map((s, i) => (
                  <div key={i} style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;">
                    <div style="flex:1;min-width:0;">
                      <div style="font-size:12px;font-weight:600;color:var(--text-bright);">{s.name}</div>
                      <div style="font-size:10px;color:var(--text-dim);margin-top:2px;">
                        {s.type === "internal" ? `Internal · ${s.department}${s.shift ? ` · ${s.shift}` : ""}` : `Partner · ${s.office}`}
                        {" · "}
                        <span style={s.recipients.length === 0 ? "color:var(--red);" : ""}>{s.recipients.length} recipient{s.recipients.length === 1 ? "" : "s"}</span>
                      </div>
                      {s.recipients.length > 0 && (
                        <div style="font-size:10px;color:var(--text-muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{s.recipients.join(", ")}</div>
                      )}
                    </div>
                    <button class="sf-btn ghost" type="button" disabled={busy} onClick={() => preview(s)} style="font-size:10px;padding:4px 8px;" title="Preview">👁</button>
                    <button class="sf-btn danger" type="button" disabled={busy} onClick={() => unstage(i)} style="font-size:10px;padding:4px 8px;" title="Remove">🗑</button>
                  </div>
                ))}
              </div>}
        </div>
      </div>

      {previewHtml !== null && <PreviewOverlay html={previewHtml} onClose={() => setPreviewHtml(null)} />}
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
