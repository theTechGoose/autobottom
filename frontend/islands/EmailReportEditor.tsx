/** Island: Email Reports admin editor — full prod parity (matches the form
 *  surface in main:dashboard/page.ts at lines ~3500-5100).
 *
 *  Three views, all in-modal (no navigation):
 *    list       → table of configs, "WEEKLY REPORTS" divider separates
 *                 weekly entries (`weeklyType` set) from regular entries.
 *                 Buttons: "+ Weekly Report" (green), "+ New Report" (blue).
 *    edit       → regular report editor — pill chip recipients, status
 *                 toggle, schedule, date range card (Rolling/Fixed pills),
 *                 yellow top-level filters card, report sections with
 *                 collapsible cards + column checkboxes, Cancel/Save Report.
 *    weekly     → weekly editor — type pills (Internal/Partner/Both), dept
 *                 + shift dropdowns OR partner office, failed-only toggle,
 *                 fixed schedule banner, identical sections UI, Cancel/Save.
 *
 *  All interactivity client-side. Save POSTs to /admin/email-reports.
 *  Weekly differentiation is via `weeklyType` (string) on the saved config —
 *  same shape the backend's WeeklyBuilderController already writes. */
import { useEffect, useMemo, useState } from "preact/hooks";

// ── Types ─────────────────────────────────────────────────────────────────────

type Operator = "equals" | "not_equals" | "contains" | "not_contains" | "starts_with" | "less_than" | "greater_than";
type ColumnKey = "recordId" | "findingId" | "guestName" | "voName" | "department" | "score" | "appealStatus" | "finalizedAt" | "markedForReview";

interface CriteriaRule { field: string; operator: Operator; value: string; }
interface ReportSection { header: string; columns: ColumnKey[]; criteria: CriteriaRule[]; }
type DateRange =
  | { mode: "rolling"; hours: number }
  | { mode: "weekly"; startDay: number }
  | { mode: "fixed"; from: number; to: number };

interface ReportConfig {
  id?: string;
  name: string;
  recipients: string[];
  cc?: string[];
  bcc?: string[];
  reportSections: ReportSection[];
  topLevelFilters?: CriteriaRule[];
  dateRange?: DateRange;
  onlyCompleted?: boolean;
  failedOnly?: boolean;
  templateId?: string;
  schedule?: { cron: string };
  enabled?: boolean;
  /** Marks this config as a weekly-builder entry. Set when editing
   *  via the in-modal Weekly editor. */
  weeklyType?: "internal" | "partner" | "both";
  weeklyDepartment?: string;
  weeklyShift?: string;
  weeklyOffice?: string;
  /** HH:mm in EST — UI-only preference, persisted as-is. */
  sendTimeEst?: string;
  createdAt?: number;
  disabled?: boolean;
}

interface EmailTemplate { id: string; name: string; }

interface AuditDims { departments: string[]; shifts: string[]; }
interface PartnerDims { offices: Record<string, string[]>; }
interface ManagerScope { departments: string[]; shifts: string[]; }

// ── Field + operator vocab (mirrors prod evaluator) ───────────────────────────

const FIELD_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "score", label: "Score" },
  { value: "department", label: "Department" },
  { value: "voName", label: "Team Member" },
  { value: "shift", label: "Shift" },
  { value: "auditType", label: "Audit Type (internal/partner)" },
  { value: "appealStatus", label: "Appeal Status (none/pending/complete)" },
  { value: "reviewed", label: "Reviewed (true/false)" },
  { value: "questionHeader", label: "Question Header" },
  { value: "questionAnswer", label: "Question Answer (yes/no)" },
];

const OPERATOR_LABELS: Record<Operator, string> = {
  equals: "equals",
  not_equals: "≠",
  contains: "contains",
  not_contains: "doesn't contain",
  starts_with: "starts with",
  less_than: "<",
  greater_than: ">",
};

const ALL_COLUMNS: Array<{ key: ColumnKey; label: string }> = [
  { key: "recordId", label: "Record ID" },
  { key: "findingId", label: "Audit Report" },
  { key: "guestName", label: "Guest Name" },
  { key: "voName", label: "VO Name" },
  { key: "department", label: "Department" },
  { key: "score", label: "Score" },
  { key: "appealStatus", label: "Appeal Status" },
  { key: "finalizedAt", label: "Timestamp" },
  { key: "markedForReview", label: "Most Recent Active MCC ID" },
];

const DEFAULT_COLUMNS: ColumnKey[] = ["recordId", "voName", "department", "score", "appealStatus"];

function emptyRule(): CriteriaRule { return { field: "score", operator: "less_than", value: "100" }; }
function emptySection(): ReportSection { return { header: "New Section", columns: [...DEFAULT_COLUMNS], criteria: [] }; }
function emptyConfig(): ReportConfig {
  return {
    name: "",
    recipients: [],
    reportSections: [],
    onlyCompleted: true,
    enabled: true,
    dateRange: { mode: "rolling", hours: 24 },
  };
}
function emptyWeeklyConfig(): ReportConfig {
  return {
    name: "",
    recipients: [],
    reportSections: [],
    onlyCompleted: true,
    enabled: true,
    weeklyType: undefined,
    failedOnly: false,
    sendTimeEst: "20:00",
    dateRange: { mode: "weekly", startDay: 1 },
  };
}

// ── Top-level island ──────────────────────────────────────────────────────────

export default function EmailReportEditor() {
  const [mode, setMode] = useState<"list" | "edit" | "weekly">("list");
  const [configs, setConfigs] = useState<ReportConfig[]>([]);
  const [editing, setEditing] = useState<ReportConfig>(emptyConfig());
  const [isNew, setIsNew] = useState(true);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => { void load(); }, []);
  async function load() {
    try {
      const [cfgRes, tplRes] = await Promise.all([
        fetch("/admin/email-reports").then((r) => r.json()),
        fetch("/admin/email-templates").then((r) => r.json()),
      ]);
      const list = Array.isArray(cfgRes) ? cfgRes : (cfgRes.configs ?? []);
      setConfigs(list);
      const tpls = Array.isArray(tplRes) ? tplRes : (tplRes.templates ?? []);
      setTemplates(tpls.map((t: { id: string; name: string }) => ({ id: t.id, name: t.name })));
    } catch (e) { setMsg({ kind: "err", text: `Load failed: ${(e as Error).message}` }); }
  }

  function startNew() { setEditing(emptyConfig()); setIsNew(true); setMode("edit"); setMsg(null); }
  function startNewWeekly() { setEditing(emptyWeeklyConfig()); setIsNew(true); setMode("weekly"); setMsg(null); }
  function startEdit(c: ReportConfig) {
    setEditing(structuredClone(c));
    setIsNew(false);
    setMode(c.weeklyType ? "weekly" : "edit");
    setMsg(null);
  }
  function backToList() { setMode("list"); setMsg(null); void load(); }
  function cancelEdit() { setMode("list"); setMsg(null); }

  async function save(payload: ReportConfig) {
    if (!payload.name.trim()) { setMsg({ kind: "err", text: "Name is required." }); return; }
    if (!payload.recipients?.length) { setMsg({ kind: "err", text: "At least one recipient required." }); return; }
    setBusy(true);
    try {
      const res = await fetch("/admin/email-reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setMsg({ kind: "ok", text: `Saved "${payload.name}".` });
      backToList();
    } catch (e) { setMsg({ kind: "err", text: `Save failed: ${(e as Error).message}` }); }
    finally { setBusy(false); }
  }

  async function doDelete(c: ReportConfig) {
    if (!c.id) return;
    if (!globalThis.confirm(`Delete "${c.name}"?`)) return;
    setBusy(true);
    try {
      await fetch("/admin/email-reports/delete", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: c.id }),
      });
      backToList();
    } catch (e) { setMsg({ kind: "err", text: `Delete failed: ${(e as Error).message}` }); }
    finally { setBusy(false); }
  }

  async function sendNow(c: ReportConfig) {
    if (!c.id) { setMsg({ kind: "err", text: "Save first, then send." }); return; }
    setBusy(true);
    try {
      const res = await fetch("/admin/email-reports/send-now", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: c.id }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setMsg({ kind: "ok", text: "Sent." });
    } catch (e) { setMsg({ kind: "err", text: `Send failed: ${(e as Error).message}` }); }
    finally { setBusy(false); }
  }

  async function preview(c: ReportConfig) {
    setBusy(true);
    try {
      const res = await fetch("/admin/email-reports/preview-inline", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(c),
      });
      const data = await res.json();
      setPreviewHtml(data.html ?? "");
    } catch (e) { setMsg({ kind: "err", text: `Preview failed: ${(e as Error).message}` }); }
    finally { setBusy(false); }
  }

  return (
    <div>
      {mode === "list" && (
        <ListView
          configs={configs}
          onNew={startNew}
          onNewWeekly={startNewWeekly}
          onEdit={startEdit}
        />
      )}
      {mode === "edit" && (
        <EditView
          config={editing}
          isNew={isNew}
          templates={templates}
          busy={busy}
          msg={msg}
          onChange={setEditing}
          onCancel={cancelEdit}
          onSave={save}
          onDelete={doDelete}
          onSendNow={sendNow}
          onPreview={preview}
        />
      )}
      {mode === "weekly" && (
        <WeeklyEditView
          config={editing}
          isNew={isNew}
          templates={templates}
          busy={busy}
          msg={msg}
          onChange={setEditing}
          onCancel={cancelEdit}
          onSave={save}
          onPreview={preview}
        />
      )}
      {previewHtml !== null && <PreviewOverlay html={previewHtml} onClose={() => setPreviewHtml(null)} />}
    </div>
  );
}

// ── List view ─────────────────────────────────────────────────────────────────

export function ListView(
  { configs, onNew, onNewWeekly, onEdit }: {
    configs: ReportConfig[];
    onNew: () => void;
    onNewWeekly: () => void;
    onEdit: (c: ReportConfig) => void;
  },
) {
  const regular = configs.filter((c) => !c.weeklyType);
  const weekly = configs.filter((c) => !!c.weeklyType);
  return (
    <div style="padding:20px 24px;">
      <div style="display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-bottom:16px;">
        <button
          type="button"
          class="sf-btn"
          style="font-size:11px;background:var(--green);color:#fff;border-color:var(--green);font-weight:600;"
          onClick={onNewWeekly}
        >+ Weekly Report</button>
        <button class="sf-btn primary" style="font-size:11px;" type="button" onClick={onNew}>+ New Report</button>
      </div>
      <table class="data-table">
        <thead><tr><th>Name</th><th>Recipients</th><th>Schedule</th><th>Sections</th><th>Status</th></tr></thead>
        <tbody>
          {regular.length === 0 && weekly.length === 0
            ? <tr class="empty-row"><td colSpan={5}>No email reports configured</td></tr>
            : (
              <>
                {regular.map((c) => (
                  <tr key={c.id ?? c.name} style="cursor:pointer;" onClick={() => onEdit(c)}>
                    <td style="font-weight:600;color:var(--text-bright);">{c.name || "Untitled"}</td>
                    <td class="mono" style="font-size:10px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{c.recipients?.join(", ") || "—"}</td>
                    <td style="font-family:var(--mono);font-size:11px;">{c.schedule?.cron ?? "—"}</td>
                    <td style="font-size:11px;color:var(--text-dim);">{c.reportSections?.length ?? 0}</td>
                    <td><span class={`pill pill-${c.enabled !== false && !c.disabled ? "green" : "red"}`}>{c.enabled !== false && !c.disabled ? "Active" : "Off"}</span></td>
                  </tr>
                ))}
                {weekly.length > 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      style="background:var(--bg);padding:8px 14px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.4px;color:var(--text-dim);border-top:1px solid var(--border);border-bottom:1px solid var(--border);"
                    >Weekly Reports</td>
                  </tr>
                )}
                {weekly.map((c) => (
                  <tr key={c.id ?? c.name} style="cursor:pointer;" onClick={() => onEdit(c)}>
                    <td style="font-weight:600;color:var(--text-bright);">{c.name || "Untitled"}</td>
                    <td class="mono" style="font-size:10px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{c.recipients?.join(", ") || "—"}</td>
                    <td style="font-family:var(--mono);font-size:11px;">{c.sendTimeEst ? `${c.sendTimeEst} EST nightly` : "weekly"}</td>
                    <td style="font-size:11px;color:var(--text-dim);">{c.reportSections?.length ?? 0}</td>
                    <td><span class={`pill pill-${c.enabled !== false && !c.disabled ? "green" : "red"}`}>{c.enabled !== false && !c.disabled ? "Active" : "Off"}</span></td>
                  </tr>
                ))}
              </>
            )}
        </tbody>
      </table>
      <div style="border-top:1px solid var(--border);margin-top:16px;padding-top:12px;text-align:center;">
        <a href="/admin/weekly-builder" style="font-size:11px;color:var(--text-muted);text-decoration:none;">Build Weekly Reports →</a>
      </div>
    </div>
  );
}

// ── Pill input (chips) ────────────────────────────────────────────────────────

function ChipInput(
  { label, value, onChange, placeholder }: {
    label: string;
    value: string[];
    onChange: (v: string[]) => void;
    placeholder?: string;
  },
) {
  const [draft, setDraft] = useState("");

  function commit(raw: string) {
    const parts = raw.split(/[,\s\n;]+/).map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) return;
    const merged = [...value];
    for (const p of parts) if (!merged.includes(p)) merged.push(p);
    onChange(merged);
    setDraft("");
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(draft);
    } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  function remove(i: number) { onChange(value.filter((_, idx) => idx !== i)); }

  return (
    <div class="sf">
      <label class="sf-label">{label}</label>
      <div
        style="display:flex;flex-wrap:wrap;gap:5px;padding:6px 8px;min-height:38px;background:var(--bg);border:1px solid var(--border);border-radius:6px;align-items:center;"
      >
        {value.map((v, i) => (
          <span
            key={`${v}-${i}`}
            style="display:inline-flex;align-items:center;gap:5px;padding:3px 6px 3px 9px;background:var(--blue-bg);border:1px solid rgba(88,166,255,0.35);border-radius:14px;font-size:11px;color:var(--blue);font-family:var(--mono);"
          >
            {v}
            <button
              type="button"
              onClick={() => remove(i)}
              style="background:none;border:none;color:var(--blue);cursor:pointer;font-size:13px;line-height:1;padding:0 2px;"
              aria-label={`Remove ${v}`}
            >×</button>
          </span>
        ))}
        <input
          type="text"
          value={draft}
          placeholder={value.length === 0 ? (placeholder ?? "type and press Enter") : ""}
          onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
          onKeyDown={onKeyDown}
          onBlur={() => draft.trim() && commit(draft)}
          onPaste={(e) => {
            const text = e.clipboardData?.getData("text") ?? "";
            if (text.match(/[,\s\n;]/)) {
              e.preventDefault();
              commit(text);
            }
          }}
          style="flex:1;min-width:140px;background:transparent;border:none;outline:none;color:var(--text);font-size:12px;font-family:var(--mono);padding:3px 0;"
        />
      </div>
    </div>
  );
}

// ── Toggle (green slider — er-toggle equivalent) ──────────────────────────────

function GreenToggle(
  { checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string },
) {
  return (
    <div style="display:flex;align-items:center;gap:10px;padding:10px 0;">
      <label
        style="position:relative;display:inline-block;width:36px;height:20px;cursor:pointer;flex-shrink:0;"
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
          style="opacity:0;width:0;height:0;"
        />
        <span
          style={`position:absolute;inset:0;background:${checked ? "var(--green)" : "#3a3f4b"};border-radius:20px;transition:background 0.18s;`}
        />
        <span
          style={`position:absolute;top:2px;left:${checked ? "18px" : "2px"};width:16px;height:16px;background:#fff;border-radius:50%;transition:left 0.18s;box-shadow:0 1px 2px rgba(0,0,0,0.4);`}
        />
      </label>
      <span style="font-size:12px;color:var(--text);font-weight:500;">{label}</span>
    </div>
  );
}

// ── Edit view (regular report) ────────────────────────────────────────────────

export function EditView(props: {
  config: ReportConfig;
  isNew: boolean;
  templates: EmailTemplate[];
  busy: boolean;
  msg: { kind: "ok" | "err"; text: string } | null;
  onChange: (c: ReportConfig) => void;
  onCancel: () => void;
  onSave: (c: ReportConfig) => void;
  onDelete: (c: ReportConfig) => void;
  onSendNow: (c: ReportConfig) => void;
  onPreview: (c: ReportConfig) => void;
}) {
  const c = props.config;
  const set = <K extends keyof ReportConfig>(k: K, v: ReportConfig[K]) => props.onChange({ ...c, [k]: v });

  return (
    <div style="padding:20px 24px;">
      {/* Header bar */}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <button
            type="button"
            onClick={props.onCancel}
            aria-label="Back"
            style="background:transparent;border:1px solid var(--border);color:var(--text-bright);width:30px;height:30px;border-radius:6px;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;"
          >←</button>
          <div class="modal-title" style="margin-bottom:0;">{props.isNew ? "New Report" : "Edit Report"}</div>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="sf-btn secondary" type="button" disabled={props.busy} onClick={() => props.onPreview(c)} style="font-size:11px;">👁 Preview</button>
          {!props.isNew && (
            <>
              <button class="sf-btn secondary" type="button" disabled={props.busy} onClick={() => props.onSendNow(c)} style="font-size:11px;">▶ Send Now</button>
              <button class="sf-btn danger" type="button" disabled={props.busy} onClick={() => props.onDelete(c)} style="font-size:11px;">Delete</button>
            </>
          )}
        </div>
      </div>

      {/* Status toggle */}
      <GreenToggle
        checked={c.enabled !== false && !c.disabled}
        onChange={(v) => props.onChange({ ...c, enabled: v, disabled: !v })}
        label={c.enabled !== false && !c.disabled ? "Active — will send on schedule" : "Disabled — will not auto-send"}
      />

      {/* Name */}
      <div class="sf">
        <label class="sf-label">Report Name</label>
        <input
          class="sf-input"
          type="text"
          value={c.name}
          onInput={(e) => set("name", (e.target as HTMLInputElement).value)}
          placeholder="e.g. Daily MCC Non-Compliant"
        />
      </div>

      {/* Schedule */}
      <ScheduleField
        cron={c.schedule?.cron ?? ""}
        onChange={(cron) => set("schedule", cron ? { cron } : undefined)}
      />

      {/* Template */}
      <div class="sf">
        <label class="sf-label">Email Template</label>
        <select
          class="sf-input"
          value={c.templateId ?? ""}
          onChange={(e) => set("templateId", (e.target as HTMLSelectElement).value || undefined)}
        >
          <option value="">None (use default dark template)</option>
          {props.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <div style="font-size:10px;color:var(--text-dim);margin-top:4px;">
          Add <code style="background:var(--bg-surface);padding:1px 5px;border-radius:3px;">{"{{sections}}"}</code> in your template where the report tables should appear.
        </div>
      </div>

      {/* Recipients / CC / BCC */}
      <ChipInput label="Recipients" value={c.recipients ?? []} onChange={(v) => set("recipients", v)} placeholder="alice@example.com" />
      <ChipInput label="CC" value={c.cc ?? []} onChange={(v) => set("cc", v.length ? v : undefined)} placeholder="cc@example.com" />
      <ChipInput label="BCC" value={c.bcc ?? []} onChange={(v) => set("bcc", v.length ? v : undefined)} placeholder="bcc@example.com" />

      {/* Completed-only toggle */}
      <div style="border-top:1px solid var(--border);margin:14px 0;" />
      <GreenToggle
        checked={c.onlyCompleted !== false}
        onChange={(v) => set("onlyCompleted", v)}
        label={c.onlyCompleted !== false ? "Completed audits only" : "All audits — in-review rows labeled"}
      />

      {/* Date range card */}
      <DateRangeCard value={c.dateRange ?? { mode: "rolling", hours: 24 }} onChange={(dr) => set("dateRange", dr)} />

      {/* Top-level filters card */}
      <FilterCard
        title="TOP-LEVEL FILTERS"
        subtitle="Return only audits matching all of these rules. Each section then further narrows this set."
        rules={c.topLevelFilters ?? []}
        onChange={(rules) => set("topLevelFilters", rules.length ? rules : undefined)}
      />

      {/* Sections */}
      <SectionList sections={c.reportSections} onChange={(sections) => set("reportSections", sections)} />

      {/* Action bar */}
      <div class="modal-actions">
        <button class="sf-btn secondary" type="button" disabled={props.busy} onClick={props.onCancel}>Cancel</button>
        <button class="sf-btn primary" type="button" disabled={props.busy} onClick={() => props.onSave(c)}>
          {props.busy ? "Saving…" : "Save Report"}
        </button>
      </div>
      {props.msg && (
        <div style={`margin-top:8px;font-size:11px;color:var(--${props.msg.kind === "ok" ? "green" : "red"});`}>
          {props.msg.text}
        </div>
      )}
    </div>
  );
}

// ── Schedule field (cron) ─────────────────────────────────────────────────────

function ScheduleField({ cron, onChange }: { cron: string; onChange: (v: string) => void }) {
  const [enabled, setEnabled] = useState(!!cron);
  // Keep parent in sync if user toggles off.
  useEffect(() => { if (!enabled && cron) onChange(""); /* eslint-disable-next-line */ }, [enabled]);
  return (
    <div style="margin-bottom:12px;">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:6px;">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled((e.target as HTMLInputElement).checked)}
          style="accent-color:var(--blue);"
        />
        <span class="sf-label" style="margin-bottom:0;cursor:pointer;">Enable Schedule</span>
      </label>
      {enabled && (
        <div style="border:1px solid var(--border);border-left:3px solid var(--blue);border-radius:8px;padding:12px 14px;background:rgba(88,166,255,0.04);">
          <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:var(--blue);margin-bottom:8px;">Schedule</div>
          <input
            class="sf-input"
            type="text"
            value={cron}
            placeholder="0 8 * * 1"
            onInput={(e) => onChange((e.target as HTMLInputElement).value)}
            style="font-family:var(--mono);"
          />
          <div style="font-size:10px;color:var(--text-dim);margin-top:4px;">
            e.g. <code>0 8 * * 1</code> = Every Monday 8 AM UTC. Five fields: minute, hour, day-of-month, month, day-of-week.
          </div>
        </div>
      )}
    </div>
  );
}

// ── Date range card (Rolling / Fixed pill toggle) ─────────────────────────────

function DateRangeCard({ value, onChange }: { value: DateRange; onChange: (v: DateRange) => void }) {
  const isFixed = value.mode === "fixed";
  const isRolling = value.mode === "rolling";

  // Hours stored canonically; UI shows either days or hours.
  const initHours = isRolling ? (value.hours || 24) : 24;
  const initUnit: "hours" | "days" = initHours % 24 === 0 && initHours >= 24 ? "days" : "hours";
  const initInputN = initUnit === "days" ? initHours / 24 : initHours;

  const [hoursN, setHoursN] = useState<number>(initInputN);
  const [unit, setUnit] = useState<"hours" | "days">(initUnit);

  function emitRolling(n: number, u: "hours" | "days") {
    onChange({ mode: "rolling", hours: u === "days" ? n * 24 : n });
  }

  return (
    <div
      style="border:1px solid var(--border);border-left:3px solid var(--blue);border-radius:8px;padding:14px 16px;margin-bottom:14px;background:rgba(88,166,255,0.04);"
    >
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:var(--blue);margin-bottom:10px;">DATE RANGE</div>
      <div style="display:flex;gap:6px;margin-bottom:12px;">
        <button
          type="button"
          class={`wh-tab${isRolling ? " active" : ""}`}
          onClick={() => onChange({ mode: "rolling", hours: unit === "days" ? hoursN * 24 : hoursN })}
        >Rolling</button>
        <button
          type="button"
          class={`wh-tab${isFixed ? " active" : ""}`}
          onClick={() => {
            const now = Date.now();
            onChange({ mode: "fixed", from: now - 7 * 86_400_000, to: now });
          }}
        >Fixed</button>
      </div>
      {isRolling && (
        <div style="display:flex;align-items:center;gap:8px;">
          <input
            class="sf-input num"
            type="number"
            min={1}
            value={hoursN}
            onInput={(e) => {
              const n = parseInt((e.target as HTMLInputElement).value, 10) || 1;
              setHoursN(n); emitRolling(n, unit);
            }}
          />
          <select
            class="sf-input"
            style="width:auto;padding:6px 9px;"
            value={unit}
            onChange={(e) => {
              const u = (e.target as HTMLSelectElement).value as "hours" | "days";
              setUnit(u); emitRolling(hoursN, u);
            }}
          >
            <option value="hours">hours</option>
            <option value="days">days</option>
          </select>
        </div>
      )}
      {isFixed && (
        <div style="display:flex;flex-direction:column;gap:8px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <label class="sf-label" style="margin-bottom:0;min-width:36px;">From</label>
            <input
              class="sf-input"
              type="datetime-local"
              style="flex:1;font-size:12px;padding:5px 8px;color-scheme:dark;"
              value={tsToLocal(value.from)}
              onInput={(e) => onChange({ ...value, from: localToTs((e.target as HTMLInputElement).value) })}
            />
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <label class="sf-label" style="margin-bottom:0;min-width:36px;">To</label>
            <input
              class="sf-input"
              type="datetime-local"
              style="flex:1;font-size:12px;padding:5px 8px;color-scheme:dark;"
              value={tsToLocal(value.to)}
              onInput={(e) => onChange({ ...value, to: localToTs((e.target as HTMLInputElement).value) })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function tsToLocal(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts); const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localToTs(s: string): number { return new Date(s).getTime() || Date.now(); }

// ── Filter card (yellow accent) ───────────────────────────────────────────────

function FilterCard(
  { title, subtitle, rules, onChange }: {
    title: string;
    subtitle?: string;
    rules: CriteriaRule[];
    onChange: (rules: CriteriaRule[]) => void;
  },
) {
  return (
    <div
      style="border:1px solid var(--border);border-left:3px solid var(--yellow);border-radius:8px;padding:14px 16px;margin-bottom:14px;background:rgba(210,153,34,0.04);"
    >
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:var(--yellow);margin-bottom:6px;">{title}</div>
      {subtitle && <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;line-height:1.4;">{subtitle}</div>}
      <RuleList rules={rules} onChange={onChange} />
    </div>
  );
}

function RuleList({ rules, onChange }: { rules: CriteriaRule[]; onChange: (r: CriteriaRule[]) => void }) {
  const add = () => onChange([...rules, emptyRule()]);
  const update = (i: number, patch: Partial<CriteriaRule>) =>
    onChange(rules.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const remove = (i: number) => onChange(rules.filter((_, idx) => idx !== i));
  return (
    <div>
      {rules.length === 0
        ? <div style="font-size:11px;color:var(--text-dim);padding:6px 0 10px;">No rules — all rows pass.</div>
        : (
          <div class="er-rule-list" style="display:flex;flex-direction:column;gap:6px;margin-bottom:8px;">
            {rules.map((r, i) => (
              <div key={i} class="er-rule-row" style="display:flex;gap:6px;align-items:center;">
                <select
                  class="sf-input"
                  style="flex:1;font-size:11px;"
                  value={r.field}
                  onChange={(e) => update(i, { field: (e.target as HTMLSelectElement).value })}
                >
                  {FIELD_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
                <select
                  class="sf-input"
                  style="width:140px;font-size:11px;"
                  value={r.operator}
                  onChange={(e) => update(i, { operator: (e.target as HTMLSelectElement).value as Operator })}
                >
                  {(Object.keys(OPERATOR_LABELS) as Operator[]).map((op) => <option key={op} value={op}>{OPERATOR_LABELS[op]}</option>)}
                </select>
                <input
                  class="sf-input er-rule-val"
                  style="flex:1;font-size:11px;"
                  type="text"
                  value={r.value}
                  placeholder="value"
                  onInput={(e) => update(i, { value: (e.target as HTMLInputElement).value })}
                />
                <button
                  type="button"
                  class="sf-btn danger"
                  style="font-size:11px;padding:4px 8px;"
                  onClick={() => remove(i)}
                  aria-label="Remove filter"
                >×</button>
              </div>
            ))}
          </div>
        )}
      <button type="button" class="sf-btn" style="font-size:11px;" onClick={add}>+ Add Filter</button>
    </div>
  );
}

// ── Section list ──────────────────────────────────────────────────────────────

function SectionList({ sections, onChange }: { sections: ReportSection[]; onChange: (s: ReportSection[]) => void }) {
  const add = () => onChange([...sections, emptySection()]);
  const update = (i: number, patch: Partial<ReportSection>) =>
    onChange(sections.map((s, idx) => idx === i ? { ...s, ...patch } : s));
  const remove = (i: number) => onChange(sections.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= sections.length) return;
    const next = sections.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div style="margin-bottom:14px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <div class="sf-label" style="margin-bottom:0;">Report Sections</div>
        <button type="button" class="sf-btn secondary" style="font-size:11px;" onClick={add}>+ Add Section</button>
      </div>
      {sections.length === 0
        ? <div style="font-size:11px;color:var(--text-dim);padding:14px;border:1px dashed var(--border);border-radius:8px;text-align:center;">No sections yet — add one to get rows into the email.</div>
        : (
          <div style="display:flex;flex-direction:column;gap:10px;">
            {sections.map((s, i) => (
              <SectionCard
                key={i}
                section={s}
                index={i}
                total={sections.length}
                onChange={(patch) => update(i, patch)}
                onRemove={() => remove(i)}
                onMove={(dir) => move(i, dir)}
              />
            ))}
          </div>
        )}
    </div>
  );
}

function SectionCard(
  { section, index, total, onChange, onRemove, onMove }: {
    section: ReportSection;
    index: number;
    total: number;
    onChange: (patch: Partial<ReportSection>) => void;
    onRemove: () => void;
    onMove: (dir: -1 | 1) => void;
  },
) {
  const [open, setOpen] = useState(true);
  const toggleColumn = (col: ColumnKey) => {
    const has = section.columns.includes(col);
    onChange({ columns: has ? section.columns.filter((c) => c !== col) : [...section.columns, col] });
  };
  return (
    <div class="er-section-card" style="border:1px solid var(--border);border-radius:8px;background:var(--bg);">
      <div style="display:flex;align-items:center;gap:6px;padding:10px 12px;border-bottom:1px solid var(--border);">
        <button
          type="button"
          class="sf-btn ghost"
          style="font-size:10px;padding:2px 6px;"
          onClick={() => setOpen(!open)}
          aria-label={open ? "Collapse section" : "Expand section"}
        >{open ? "▾" : "▸"}</button>
        <div style="flex:1;display:flex;flex-direction:column;gap:2px;">
          <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:var(--text-dim);">SECTION HEADER</div>
          <input
            class="sf-input er-sec-hdr"
            type="text"
            value={section.header}
            placeholder="Section header"
            onInput={(e) => onChange({ header: (e.target as HTMLInputElement).value })}
            style="font-size:12px;font-weight:600;"
          />
        </div>
        <button type="button" class="sf-btn ghost" disabled={index === 0} onClick={() => onMove(-1)} style="font-size:10px;padding:2px 6px;">↑</button>
        <button type="button" class="sf-btn ghost" disabled={index === total - 1} onClick={() => onMove(1)} style="font-size:10px;padding:2px 6px;">↓</button>
        <button type="button" class="sf-btn danger" onClick={onRemove} style="font-size:10px;padding:2px 6px;">Remove</button>
      </div>
      {open && (
        <div style="padding:14px;display:flex;flex-direction:column;gap:14px;">
          <div>
            <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:var(--text-dim);margin-bottom:8px;">CRITERIA</div>
            <RuleList rules={section.criteria} onChange={(criteria) => onChange({ criteria })} />
          </div>
          <div class="er-sec-cols">
            <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:var(--text-dim);margin-bottom:8px;">COLUMNS</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;">
              {ALL_COLUMNS.map((col) => (
                <label
                  key={col.key}
                  style={`display:flex;align-items:center;gap:5px;padding:4px 10px;border-radius:14px;border:1px solid var(--border);background:${section.columns.includes(col.key) ? "var(--bg-surface)" : "transparent"};font-size:11px;cursor:pointer;color:var(--text);`}
                >
                  <input
                    type="checkbox"
                    value={col.key}
                    checked={section.columns.includes(col.key)}
                    onChange={() => toggleColumn(col.key)}
                    style="width:12px;height:12px;accent-color:var(--blue);"
                  />
                  {col.label}
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Weekly editor ─────────────────────────────────────────────────────────────

export function WeeklyEditView(props: {
  config: ReportConfig;
  isNew: boolean;
  templates: EmailTemplate[];
  busy: boolean;
  msg: { kind: "ok" | "err"; text: string } | null;
  onChange: (c: ReportConfig) => void;
  onCancel: () => void;
  onSave: (c: ReportConfig) => void;
  onPreview: (c: ReportConfig) => void;
}) {
  const c = props.config;
  const set = <K extends keyof ReportConfig>(k: K, v: ReportConfig[K]) => props.onChange({ ...c, [k]: v });

  const [auditDims, setAuditDims] = useState<AuditDims | null>(null);
  const [partnerDims, setPartnerDims] = useState<PartnerDims | null>(null);
  const [scopes, setScopes] = useState<Record<string, ManagerScope>>({});

  // Lazy-load dims when an internal/partner type is chosen.
  useEffect(() => {
    let cancelled = false;
    if (c.weeklyType === "internal" && !auditDims) {
      (async () => {
        try {
          const [d, s] = await Promise.all([
            fetch("/admin/audit-dimensions").then((r) => r.json()),
            fetch("/admin/manager-scopes").then((r) => r.json()).catch(() => ({})),
          ]);
          if (!cancelled) {
            setAuditDims(d);
            setScopes((s as Record<string, ManagerScope>) ?? {});
          }
        } catch { /* fall through with empty options */ }
      })();
    }
    if (c.weeklyType === "partner" && !partnerDims) {
      (async () => {
        try {
          const d = await fetch("/admin/partner-dimensions").then((r) => r.json());
          if (!cancelled) setPartnerDims(d);
        } catch { /* fall through */ }
      })();
    }
    return () => { cancelled = true; };
  }, [c.weeklyType]);

  const deptEmails = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const [email, scope] of Object.entries(scopes)) {
      for (const dept of (scope?.departments ?? [])) {
        if (!out[dept]) out[dept] = [];
        if (!out[dept].includes(email)) out[dept].push(email);
      }
    }
    return out;
  }, [scopes]);

  function autoName(): string {
    if (!c.weeklyType) return "";
    if (c.weeklyType === "both") return "All Audits";
    if (c.weeklyType === "partner") return c.weeklyOffice ?? "Partner";
    const parts: string[] = [];
    if (c.weeklyDepartment) parts.push(c.weeklyDepartment);
    if (c.weeklyShift) parts.push(c.weeklyShift);
    return parts.length ? parts.join(" — ") : "Internal";
  }

  function selectType(t: "internal" | "partner" | "both") {
    const next: ReportConfig = {
      ...c,
      weeklyType: t,
      weeklyDepartment: undefined,
      weeklyShift: undefined,
      weeklyOffice: undefined,
    };
    if (t === "both" && !next.name) next.name = "All Audits";
    props.onChange(next);
  }

  function selectDept(dept: string) {
    const recipients = deptEmails[dept] ?? [];
    props.onChange({
      ...c,
      weeklyDepartment: dept || undefined,
      recipients: c.recipients?.length ? c.recipients : recipients,
      name: c.name || (dept ? dept : ""),
    });
  }

  function selectOffice(office: string) {
    const recipients = (partnerDims?.offices ?? {})[office] ?? [];
    props.onChange({
      ...c,
      weeklyOffice: office || undefined,
      recipients: c.recipients?.length ? c.recipients : recipients,
      name: c.name || office,
    });
  }

  const showSecondStep = c.weeklyType === "internal" || c.weeklyType === "partner";
  const showEditForm = c.weeklyType === "both"
    || (c.weeklyType === "internal" && !!c.weeklyDepartment)
    || (c.weeklyType === "partner" && !!c.weeklyOffice);

  return (
    <div style="padding:20px 24px;">
      {/* Header */}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <button
            type="button"
            onClick={props.onCancel}
            aria-label="Back"
            style="background:transparent;border:1px solid var(--border);color:var(--text-bright);width:30px;height:30px;border-radius:6px;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;"
          >←</button>
          <div class="modal-title" style="margin-bottom:0;">{props.isNew ? "New Weekly Report" : "Edit Weekly Report"}</div>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="sf-btn secondary" type="button" disabled={props.busy} onClick={() => props.onPreview(c)} style="font-size:11px;">👁 Preview</button>
        </div>
      </div>

      {/* Step 1: type pills */}
      <div style="display:flex;flex-direction:column;align-items:center;padding:24px 0 12px;gap:14px;">
        <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1.4px;color:var(--text);">What type of audit?</div>
        <div style="display:flex;gap:10px;">
          {(["internal", "partner", "both"] as const).map((t) => (
            <button
              key={t}
              type="button"
              class={`wh-tab${c.weeklyType === t ? " active" : ""}`}
              style="padding:10px 28px;font-size:13px;"
              onClick={() => selectType(t)}
            >{t.charAt(0).toUpperCase() + t.slice(1)}</button>
          ))}
        </div>
      </div>

      {/* Step 2a: Internal — dept + shift */}
      {showSecondStep && c.weeklyType === "internal" && (
        <div style="margin-bottom:20px;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:var(--text-muted);margin-bottom:10px;">Department &amp; Shift</div>
          <div style="display:flex;gap:10px;">
            <select
              class="sf-input"
              style="flex:1;"
              value={c.weeklyDepartment ?? ""}
              onChange={(e) => selectDept((e.target as HTMLSelectElement).value)}
            >
              <option value="">{auditDims ? "Select department..." : "Loading..."}</option>
              {(auditDims?.departments ?? []).map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <select
              class="sf-input"
              style="flex:1;"
              value={c.weeklyShift ?? ""}
              onChange={(e) => set("weeklyShift", (e.target as HTMLSelectElement).value || undefined)}
            >
              <option value="">Any shift</option>
              {(auditDims?.shifts ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* Step 2b: Partner — office */}
      {showSecondStep && c.weeklyType === "partner" && (
        <div style="margin-bottom:20px;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:var(--text-muted);margin-bottom:10px;">Office</div>
          <select
            class="sf-input"
            value={c.weeklyOffice ?? ""}
            onChange={(e) => selectOffice((e.target as HTMLSelectElement).value)}
          >
            <option value="">{partnerDims ? "Select office..." : "Loading..."}</option>
            {Object.keys(partnerDims?.offices ?? {}).sort().map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      )}

      {/* Edit form (gated) */}
      {showEditForm && (
        <>
          {/* Failed-only toggle */}
          <div style="border-top:1px solid var(--border);margin:14px 0;" />
          <GreenToggle
            checked={!!c.failedOnly}
            onChange={(v) => set("failedOnly", v)}
            label="Failed audits only (score < 100)"
          />

          {/* Name */}
          <div class="sf">
            <label class="sf-label">Report Name</label>
            <input
              class="sf-input"
              type="text"
              value={c.name}
              placeholder={autoName() || "Auto-generated from selections"}
              onInput={(e) => set("name", (e.target as HTMLInputElement).value)}
            />
          </div>

          {/* Recipients / CC / BCC */}
          <ChipInput label="Recipients" value={c.recipients ?? []} onChange={(v) => set("recipients", v)} placeholder="alice@example.com" />
          <ChipInput label="CC" value={c.cc ?? []} onChange={(v) => set("cc", v.length ? v : undefined)} placeholder="cc@example.com" />
          <ChipInput label="BCC" value={c.bcc ?? []} onChange={(v) => set("bcc", v.length ? v : undefined)} placeholder="bcc@example.com" />

          {/* Template */}
          <div class="sf">
            <label class="sf-label">Email Template</label>
            <select
              class="sf-input"
              value={c.templateId ?? ""}
              onChange={(e) => set("templateId", (e.target as HTMLSelectElement).value || undefined)}
            >
              <option value="">None (use default dark template)</option>
              {props.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>

          {/* Schedule banner */}
          <div
            style="margin-top:16px;padding:12px 14px;background:rgba(99,102,241,0.07);border:1px solid rgba(99,102,241,0.2);border-radius:8px;font-size:12px;color:#c9d1d9;line-height:1.6;"
          >
            This report covers all audits within the current pay period (Mon–Sun) and sends nightly at{" "}
            <input
              type="time"
              value={c.sendTimeEst ?? "20:00"}
              onInput={(e) => set("sendTimeEst", (e.target as HTMLInputElement).value || "20:00")}
              style="background:#0a0e14;border:1px solid #1e2736;border-radius:5px;color:#c9d1d9;font-size:12px;padding:2px 6px;margin:0 4px;"
            />
            EST
          </div>

          {/* Sections */}
          <div style="margin-top:14px;">
            <SectionList sections={c.reportSections} onChange={(s) => set("reportSections", s)} />
          </div>

          {/* Action bar */}
          <div class="modal-actions">
            <button class="sf-btn secondary" type="button" disabled={props.busy} onClick={props.onCancel}>Cancel</button>
            <button
              class="sf-btn primary"
              type="button"
              disabled={props.busy}
              onClick={() => props.onSave({
                ...c,
                name: c.name || autoName(),
                dateRange: { mode: "weekly", startDay: 1 },
              })}
            >{props.busy ? "Saving…" : "Save Report"}</button>
          </div>
          {props.msg && (
            <div style={`margin-top:8px;font-size:11px;color:var(--${props.msg.kind === "ok" ? "green" : "red"});`}>
              {props.msg.text}
            </div>
          )}
        </>
      )}

      {/* Footer link to legacy weekly builder */}
      <div style="border-top:1px solid var(--border);margin-top:18px;padding-top:12px;text-align:center;">
        <a href="/admin/weekly-builder" style="font-size:11px;color:var(--text-muted);text-decoration:none;">Build Weekly Reports →</a>
      </div>
    </div>
  );
}

// ── Preview overlay ──────────────────────────────────────────────────────────

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
