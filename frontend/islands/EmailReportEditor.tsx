/** Island: Email Reports admin editor — full prod parity (matches the form
 *  surface in main:dashboard/page.ts at lines ~3500-5100). Replaces the prior
 *  thin HTMX modal that only exposed name+recipients+schedule+enabled.
 *
 *  Flow:
 *    list  → table of configs, Edit/Send/Delete inline, "+ New Report"
 *    edit  → full form (recipients/cc/bcc, schedule, date range, top-level
 *            filters, dynamic report sections w/ column picker + per-section
 *            criteria, template picker, onlyCompleted/active toggles)
 *    preview → opens iframe overlay rendered from the live form state via
 *              POST /admin/email-reports/preview-inline (no save side-effect)
 *
 *  All interactivity client-side because the form has dynamic add/remove
 *  rows (rules + sections) and needs live preview without server round-trips
 *  per row. Save POSTs the full payload to /admin/email-reports. */
import { useEffect, useState } from "preact/hooks";

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
}

interface EmailTemplate { id: string; name: string; }

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
  { key: "findingId", label: "Finding ID" },
  { key: "guestName", label: "Guest Name" },
  { key: "voName", label: "Team Member" },
  { key: "department", label: "Department" },
  { key: "score", label: "Score" },
  { key: "appealStatus", label: "Appeal" },
  { key: "finalizedAt", label: "Timestamp" },
  { key: "markedForReview", label: "In Review" },
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
  };
}

// ── Top-level island ──────────────────────────────────────────────────────────

export default function EmailReportEditor() {
  const [mode, setMode] = useState<"list" | "edit">("list");
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
      setConfigs(cfgRes.configs ?? []);
      const tpls = Array.isArray(tplRes) ? tplRes : (tplRes.templates ?? []);
      setTemplates(tpls.map((t: { id: string; name: string }) => ({ id: t.id, name: t.name })));
    } catch (e) { setMsg({ kind: "err", text: `Load failed: ${(e as Error).message}` }); }
  }

  function startNew() { setEditing(emptyConfig()); setIsNew(true); setMode("edit"); setMsg(null); }
  function startEdit(c: ReportConfig) { setEditing(structuredClone(c)); setIsNew(false); setMode("edit"); setMsg(null); }
  function backToList() { setMode("list"); setMsg(null); void load(); }

  async function save() {
    if (!editing.name.trim()) { setMsg({ kind: "err", text: "Name is required." }); return; }
    setBusy(true);
    try {
      const res = await fetch("/admin/email-reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(editing),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setMsg({ kind: "ok", text: `Saved "${editing.name}".` });
      if (data.config?.id) setEditing({ ...editing, id: data.config.id });
      setIsNew(false);
    } catch (e) { setMsg({ kind: "err", text: `Save failed: ${(e as Error).message}` }); }
    finally { setBusy(false); }
  }

  async function doDelete() {
    if (!editing.id) return;
    if (!globalThis.confirm(`Delete "${editing.name}"?`)) return;
    setBusy(true);
    try {
      await fetch("/admin/email-reports/delete", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: editing.id }),
      });
      backToList();
    } catch (e) { setMsg({ kind: "err", text: `Delete failed: ${(e as Error).message}` }); }
    finally { setBusy(false); }
  }

  async function sendNow() {
    if (!editing.id) { setMsg({ kind: "err", text: "Save first, then send." }); return; }
    setBusy(true);
    try {
      const res = await fetch("/admin/email-reports/send-now", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: editing.id }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setMsg({ kind: "ok", text: "Sent." });
    } catch (e) { setMsg({ kind: "err", text: `Send failed: ${(e as Error).message}` }); }
    finally { setBusy(false); }
  }

  async function preview() {
    setBusy(true);
    try {
      const res = await fetch("/admin/email-reports/preview-inline", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(editing),
      });
      const data = await res.json();
      setPreviewHtml(data.html ?? "");
    } catch (e) { setMsg({ kind: "err", text: `Preview failed: ${(e as Error).message}` }); }
    finally { setBusy(false); }
  }

  return (
    <div>
      {mode === "list"
        ? <ListView configs={configs} onNew={startNew} onEdit={startEdit} />
        : <EditView
            config={editing}
            isNew={isNew}
            templates={templates}
            busy={busy}
            msg={msg}
            onChange={setEditing}
            onBack={backToList}
            onSave={save}
            onDelete={doDelete}
            onSendNow={sendNow}
            onPreview={preview}
          />}
      {previewHtml !== null && <PreviewOverlay html={previewHtml} onClose={() => setPreviewHtml(null)} />}
    </div>
  );
}

// ── List view ─────────────────────────────────────────────────────────────────

function ListView({ configs, onNew, onEdit }: { configs: ReportConfig[]; onNew: () => void; onEdit: (c: ReportConfig) => void }) {
  return (
    <div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <div class="modal-title" style="margin-bottom:0;">Email Reports</div>
        <button class="sf-btn primary" style="font-size:11px;" type="button" onClick={onNew}>+ New Report</button>
      </div>
      <table class="data-table">
        <thead><tr><th>Name</th><th>Recipients</th><th>Schedule</th><th>Sections</th><th>Status</th></tr></thead>
        <tbody>
          {configs.length === 0
            ? <tr class="empty-row"><td colSpan={5}>No email reports configured</td></tr>
            : configs.map((c) => (
              <tr key={c.id ?? c.name} style="cursor:pointer;" onClick={() => onEdit(c)}>
                <td style="font-weight:600;color:var(--text-bright);">{c.name || "Untitled"}</td>
                <td class="mono" style="font-size:10px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{c.recipients?.join(", ") || "—"}</td>
                <td style="font-family:var(--mono);font-size:11px;">{c.schedule?.cron ?? "—"}</td>
                <td style="font-size:11px;color:var(--text-dim);">{c.reportSections?.length ?? 0}</td>
                <td><span class={`pill pill-${c.enabled !== false ? "green" : "red"}`}>{c.enabled !== false ? "Active" : "Off"}</span></td>
              </tr>
            ))}
        </tbody>
      </table>
      <div style="border-top:1px solid var(--border);margin-top:16px;padding-top:12px;text-align:center;">
        <a href="/admin/weekly-builder" style="font-size:11px;color:var(--text-muted);text-decoration:none;">Build Weekly Reports →</a>
      </div>
    </div>
  );
}

// ── Edit view ─────────────────────────────────────────────────────────────────

function EditView(props: {
  config: ReportConfig;
  isNew: boolean;
  templates: EmailTemplate[];
  busy: boolean;
  msg: { kind: "ok" | "err"; text: string } | null;
  onChange: (c: ReportConfig) => void;
  onBack: () => void;
  onSave: () => void;
  onDelete: () => void;
  onSendNow: () => void;
  onPreview: () => void;
}) {
  const c = props.config;
  const set = <K extends keyof ReportConfig>(k: K, v: ReportConfig[K]) => props.onChange({ ...c, [k]: v });

  return (
    <div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
        <button class="sf-btn ghost" type="button" onClick={props.onBack} style="font-size:11px;">← Back</button>
        <div class="modal-title" style="margin-bottom:0;">{props.isNew ? "New Report" : `Edit: ${c.name || "Report"}`}</div>
      </div>

      {/* Name + active toggle */}
      <div class="sf">
        <label class="sf-label">Name</label>
        <input class="sf-input" type="text" value={c.name} onInput={(e) => set("name", (e.target as HTMLInputElement).value)} placeholder="Report name" />
      </div>

      {/* Recipients + cc + bcc */}
      <ChipField label="Recipients (one per line, or comma-separated)" value={c.recipients} onChange={(v) => set("recipients", v)} placeholder="alice@example.com" />
      <ChipField label="CC" value={c.cc ?? []} onChange={(v) => set("cc", v.length ? v : undefined)} placeholder="cc@example.com" />
      <ChipField label="BCC" value={c.bcc ?? []} onChange={(v) => set("bcc", v.length ? v : undefined)} placeholder="bcc@example.com" />

      {/* Schedule */}
      <ScheduleField value={c.schedule?.cron ?? ""} onChange={(cron) => set("schedule", cron ? { cron } : undefined)} />

      {/* Date range */}
      <DateRangeField value={c.dateRange} onChange={(dr) => set("dateRange", dr)} />

      {/* Template + toggles row */}
      <div style="display:grid;grid-template-columns:1fr auto auto;gap:14px;align-items:end;margin-bottom:14px;">
        <div class="sf" style="margin-bottom:0;">
          <label class="sf-label">Email Template</label>
          <select class="sf-input" value={c.templateId ?? ""} onChange={(e) => set("templateId", (e.target as HTMLSelectElement).value || undefined)}>
            <option value="">— Default dark template —</option>
            {props.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <Toggle label="Only completed" checked={c.onlyCompleted ?? true} onChange={(v) => set("onlyCompleted", v)} />
        <Toggle label="Active" checked={c.enabled !== false} onChange={(v) => set("enabled", v)} />
      </div>

      {/* Top-level filters */}
      <RuleBuilder
        title="Top-level Filters"
        subtitle="Applied across all sections before per-section criteria run."
        rules={c.topLevelFilters ?? []}
        onChange={(rules) => set("topLevelFilters", rules.length ? rules : undefined)}
      />

      {/* Sections */}
      <SectionList sections={c.reportSections} onChange={(sections) => set("reportSections", sections)} />

      {/* Action bar */}
      <div class="sf-actions" style="margin-top:18px;">
        {!props.isNew && <button class="sf-btn danger" type="button" disabled={props.busy} onClick={props.onDelete}>Delete</button>}
        {!props.isNew && <button class="sf-btn ghost" type="button" disabled={props.busy} onClick={props.onSendNow}>Send Now</button>}
        <button class="sf-btn" type="button" disabled={props.busy} onClick={props.onPreview}>Preview</button>
        <button class="sf-btn primary" type="button" disabled={props.busy} onClick={props.onSave}>{props.busy ? "Saving…" : "Save"}</button>
      </div>
      {props.msg && (
        <div style={`margin-top:8px;font-size:11px;color:var(--${props.msg.kind === "ok" ? "green" : "red"});`}>{props.msg.text}</div>
      )}
    </div>
  );
}

// ── Reusable form pieces ──────────────────────────────────────────────────────

function ChipField({ label, value, onChange, placeholder }: { label: string; value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const text = value.join("\n");
  return (
    <div class="sf">
      <label class="sf-label">{label}</label>
      <textarea
        class="sf-input"
        rows={Math.min(4, Math.max(2, value.length + 1))}
        style="height:auto;font-size:12px;"
        placeholder={placeholder}
        value={text}
        onInput={(e) => onChange(parseChips((e.target as HTMLTextAreaElement).value))}
      />
    </div>
  );
}
function parseChips(raw: string): string[] {
  return raw.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--bg);border:1px solid var(--border);border-radius:8px;font-size:11px;font-weight:600;color:var(--text-bright);cursor:pointer;white-space:nowrap;">
      <input type="checkbox" checked={checked} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} style="width:14px;height:14px;" />
      {label}
    </label>
  );
}

function ScheduleField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div class="sf">
      <label class="sf-label">Schedule (cron expression — leave blank to send only manually)</label>
      <input class="sf-input" type="text" value={value} placeholder="0 8 * * 1" onInput={(e) => onChange((e.target as HTMLInputElement).value)} style="font-family:var(--mono);" />
      <div style="font-size:10px;color:var(--text-dim);margin-top:4px;">
        e.g. <code>0 8 * * 1</code> = Every Monday 8 AM UTC. Five fields: minute, hour, day-of-month, month, day-of-week.
      </div>
    </div>
  );
}

function DateRangeField({ value, onChange }: { value: DateRange | undefined; onChange: (v: DateRange | undefined) => void }) {
  const mode = value?.mode ?? "rolling";
  return (
    <div class="sf">
      <label class="sf-label">Date Range</label>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <select
          class="sf-input"
          style="width:auto;font-size:12px;"
          value={mode}
          onChange={(e) => {
            const m = (e.target as HTMLSelectElement).value as DateRange["mode"];
            if (m === "rolling") onChange({ mode: "rolling", hours: 24 });
            else if (m === "weekly") onChange({ mode: "weekly", startDay: 1 });
            else onChange({ mode: "fixed", from: Date.now() - 7 * 86_400_000, to: Date.now() });
          }}
        >
          <option value="rolling">Rolling</option>
          <option value="weekly">Weekly</option>
          <option value="fixed">Fixed</option>
        </select>
        {value?.mode === "rolling" && (
          <>
            <input class="sf-input" type="number" min={1} value={value.hours} style="width:90px;font-size:12px;" onInput={(e) => onChange({ mode: "rolling", hours: parseInt((e.target as HTMLInputElement).value, 10) || 24 })} />
            <span style="font-size:11px;color:var(--text-dim);">hours back from now</span>
          </>
        )}
        {value?.mode === "weekly" && (
          <>
            <select class="sf-input" style="width:auto;font-size:12px;" value={value.startDay} onChange={(e) => onChange({ mode: "weekly", startDay: parseInt((e.target as HTMLSelectElement).value, 10) || 1 })}>
              <option value={1}>Mon</option><option value={2}>Tue</option><option value={3}>Wed</option><option value={4}>Thu</option><option value={5}>Fri</option><option value={6}>Sat</option><option value={0}>Sun</option>
            </select>
            <span style="font-size:11px;color:var(--text-dim);">week-of, starting</span>
          </>
        )}
        {value?.mode === "fixed" && (
          <>
            <input class="sf-input" type="datetime-local" style="font-size:12px;" value={tsToLocal(value.from)} onInput={(e) => onChange({ ...value, from: localToTs((e.target as HTMLInputElement).value) })} />
            <span style="font-size:11px;color:var(--text-dim);">to</span>
            <input class="sf-input" type="datetime-local" style="font-size:12px;" value={tsToLocal(value.to)} onInput={(e) => onChange({ ...value, to: localToTs((e.target as HTMLInputElement).value) })} />
          </>
        )}
      </div>
    </div>
  );
}
function tsToLocal(ts: number): string {
  const d = new Date(ts); const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localToTs(s: string): number { return new Date(s).getTime() || Date.now(); }

// ── Rule builder ──────────────────────────────────────────────────────────────

function RuleBuilder({ title, subtitle, rules, onChange }: { title: string; subtitle?: string; rules: CriteriaRule[]; onChange: (rules: CriteriaRule[]) => void }) {
  const add = () => onChange([...rules, emptyRule()]);
  const update = (i: number, patch: Partial<CriteriaRule>) => onChange(rules.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const remove = (i: number) => onChange(rules.filter((_, idx) => idx !== i));
  return (
    <div class="sf">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
        <div>
          <label class="sf-label" style="margin-bottom:0;">{title}</label>
          {subtitle && <div style="font-size:10px;color:var(--text-dim);margin-top:2px;">{subtitle}</div>}
        </div>
        <button type="button" class="sf-btn" style="font-size:10px;" onClick={add}>+ Rule</button>
      </div>
      {rules.length === 0
        ? <div style="font-size:11px;color:var(--text-dim);padding:6px 0;">No rules — all rows pass.</div>
        : (
          <div style="display:flex;flex-direction:column;gap:6px;">
            {rules.map((r, i) => (
              <div key={i} style="display:flex;gap:6px;align-items:center;">
                <select class="sf-input" style="flex:1;font-size:11px;" value={r.field} onChange={(e) => update(i, { field: (e.target as HTMLSelectElement).value })}>
                  {FIELD_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
                <select class="sf-input" style="width:120px;font-size:11px;" value={r.operator} onChange={(e) => update(i, { operator: (e.target as HTMLSelectElement).value as Operator })}>
                  {(Object.keys(OPERATOR_LABELS) as Operator[]).map((op) => <option key={op} value={op}>{OPERATOR_LABELS[op]}</option>)}
                </select>
                <input class="sf-input" style="flex:1;font-size:11px;" type="text" value={r.value} placeholder="value" onInput={(e) => update(i, { value: (e.target as HTMLInputElement).value })} />
                <button type="button" class="sf-btn danger" style="font-size:10px;padding:4px 8px;" onClick={() => remove(i)}>×</button>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

// ── Section list ──────────────────────────────────────────────────────────────

function SectionList({ sections, onChange }: { sections: ReportSection[]; onChange: (s: ReportSection[]) => void }) {
  const add = () => onChange([...sections, emptySection()]);
  const update = (i: number, patch: Partial<ReportSection>) => onChange(sections.map((s, idx) => idx === i ? { ...s, ...patch } : s));
  const remove = (i: number) => onChange(sections.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= sections.length) return;
    const next = sections.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div class="sf">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <div>
          <label class="sf-label" style="margin-bottom:0;">Report Sections</label>
          <div style="font-size:10px;color:var(--text-dim);margin-top:2px;">Each section is a separate table in the email. Rows enter a section if they match its criteria.</div>
        </div>
        <button type="button" class="sf-btn primary" style="font-size:10px;" onClick={add}>+ Section</button>
      </div>
      {sections.length === 0
        ? <div style="font-size:11px;color:var(--text-dim);padding:10px;border:1px dashed var(--border);border-radius:8px;text-align:center;">No sections yet — add one to get rows into the email.</div>
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

function SectionCard({ section, index, total, onChange, onRemove, onMove }: { section: ReportSection; index: number; total: number; onChange: (patch: Partial<ReportSection>) => void; onRemove: () => void; onMove: (dir: -1 | 1) => void }) {
  const [open, setOpen] = useState(true);
  const toggleColumn = (col: ColumnKey) => {
    const has = section.columns.includes(col);
    onChange({ columns: has ? section.columns.filter((c) => c !== col) : [...section.columns, col] });
  };
  return (
    <div style="border:1px solid var(--border);border-radius:8px;background:var(--bg);">
      <div style="display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid var(--border);">
        <button type="button" class="sf-btn ghost" style="font-size:10px;padding:2px 6px;" onClick={() => setOpen(!open)}>{open ? "▾" : "▸"}</button>
        <input class="sf-input" type="text" value={section.header} placeholder="Section header" onInput={(e) => onChange({ header: (e.target as HTMLInputElement).value })} style="flex:1;font-size:12px;font-weight:600;" />
        <button type="button" class="sf-btn ghost" disabled={index === 0} onClick={() => onMove(-1)} style="font-size:10px;padding:2px 6px;">↑</button>
        <button type="button" class="sf-btn ghost" disabled={index === total - 1} onClick={() => onMove(1)} style="font-size:10px;padding:2px 6px;">↓</button>
        <button type="button" class="sf-btn danger" onClick={onRemove} style="font-size:10px;padding:2px 6px;">Remove</button>
      </div>
      {open && (
        <div style="padding:10px 12px;display:flex;flex-direction:column;gap:10px;">
          <div>
            <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.8px;">Columns</label>
            <div style="display:flex;flex-wrap:wrap;gap:6px;">
              {ALL_COLUMNS.map((col) => (
                <label key={col.key} style={`display:flex;align-items:center;gap:4px;padding:3px 8px;border-radius:14px;border:1px solid var(--border);background:${section.columns.includes(col.key) ? "var(--bg-surface)" : "transparent"};font-size:10px;cursor:pointer;`}>
                  <input type="checkbox" checked={section.columns.includes(col.key)} onChange={() => toggleColumn(col.key)} style="width:12px;height:12px;" />
                  {col.label}
                </label>
              ))}
            </div>
          </div>
          <RuleBuilder
            title="Criteria"
            subtitle="A row enters this section only if every rule passes."
            rules={section.criteria}
            onChange={(criteria) => onChange({ criteria })}
          />
        </div>
      )}
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
