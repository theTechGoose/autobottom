/** Island: CSV import wizard for /question-lab. Mirrors prod's 5-step flow
 *  (main:question-lab/page.ts buildPreview + runImport):
 *    1. Upload      — pick a CSV file, parse client-side
 *    2. Map Columns — assign CSV columns to: Question Text, Report Label,
 *                     Auto-Yes, Group By + Internal/Partner toggle
 *    3. Preview     — group rows by chosen column, dedupe by Question Text,
 *                     show summary + dupe-mode picker
 *    4. Run         — sequentially POST each grouped config to
 *                     /api/qlab/configs/import with retry-on-503
 *    5. Done        — summary + reload
 *  All client-side because prod's UX (FileReader, grouping, sequential POST
 *  with progress + log) is inherently interactive — same precedent as
 *  AppealModal and AudioPlayer islands. */
import { useState } from "preact/hooks";
import { parseCsv } from "../lib/csv.ts";

type Step = "closed" | "upload" | "map" | "preview" | "run" | "done";
type DupeMode = "skip" | "overwrite" | "duplicate";
type ConfigType = "internal" | "partner";

interface QuestionRow {
  name: string;
  text: string;
  autoYesExp: string;
}
interface GroupedConfig {
  name: string;
  type: ConfigType;
  questions: QuestionRow[];
}
interface ImportResponse {
  ok?: boolean;
  skipped?: boolean;
  overwritten?: boolean;
  configName?: string;
  configId?: string;
  questions?: number;
  error?: string;
}

// Match prod's auto-default detection — strip non-letters and compare.
const DEFAULT_HEADERS: Record<keyof Mappings, string> = {
  text: "question",
  name: "reportlabel",
  autoyes: "autoyes",
  group: "destination",
};
interface Mappings { text: number; name: number; autoyes: number; group: number; }

function findDefaultHeader(headers: string[], target: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const t = norm(target);
  return headers.findIndex((h) => norm(h) === t);
}

export default function CsvImportWizard() {
  const [step, setStep] = useState<Step>("closed");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [fileInfo, setFileInfo] = useState("");
  const [mappings, setMappings] = useState<Mappings>({ text: -1, name: -1, autoyes: -1, group: -1 });
  const [importType, setImportType] = useState<ConfigType>("internal");
  const [grouped, setGrouped] = useState<GroupedConfig[]>([]);
  const [previewSummary, setPreviewSummary] = useState("");
  const [dupeMode, setDupeMode] = useState<DupeMode>("skip");
  const [progress, setProgress] = useState({ pct: 0, label: "", log: "" });
  const [result, setResult] = useState({ created: 0, overwritten: 0, skipped: 0, totalQ: 0, errors: 0 });

  const open = () => { reset(); setStep("upload"); };
  const close = () => setStep("closed");

  function reset() {
    setHeaders([]); setRows([]); setFileInfo("");
    setMappings({ text: -1, name: -1, autoyes: -1, group: -1 });
    setImportType("internal");
    setGrouped([]); setPreviewSummary(""); setDupeMode("skip");
    setProgress({ pct: 0, label: "", log: "" });
    setResult({ created: 0, overwritten: 0, skipped: 0, totalQ: 0, errors: 0 });
  }

  async function onFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();
    // Re-use the existing parser. Convert its row-of-objects shape back into
    // header[]+row[][] because the wizard works in column indices, not names.
    const cells = rawParse(text);
    if (cells.length === 0) {
      setFileInfo("CSV appears empty.");
      return;
    }
    const hdrs = cells[0].map((h) => h.trim());
    const data = cells.slice(1).filter((r) => r.some((c) => c.trim() !== ""));
    setHeaders(hdrs);
    setRows(data);
    setFileInfo(`${hdrs.length} columns, ${data.length} rows detected.`);

    // Auto-default mappings using prod's matcher.
    setMappings({
      text: findDefaultHeader(hdrs, DEFAULT_HEADERS.text),
      name: findDefaultHeader(hdrs, DEFAULT_HEADERS.name),
      autoyes: findDefaultHeader(hdrs, DEFAULT_HEADERS.autoyes),
      group: findDefaultHeader(hdrs, DEFAULT_HEADERS.group),
    });
    setStep("map");
  }

  function buildPreview() {
    const { text: ti, name: ni, autoyes: ai, group: gi } = mappings;
    if (ti < 0 || ni < 0 || gi < 0) {
      alert("Map all required fields (Question Text, Report Label, Group By).");
      return;
    }
    const groups = new Map<string, Map<string, QuestionRow>>();
    let dupes = 0;
    for (const row of rows) {
      const group = (row[gi] ?? "").trim();
      const text = (row[ti] ?? "").trim();
      const name = (row[ni] ?? "").trim();
      const autoYes = ai >= 0 ? (row[ai] ?? "").trim() : "";
      if (!group || !text || !name) continue;
      let bucket = groups.get(group);
      if (!bucket) { bucket = new Map(); groups.set(group, bucket); }
      // Dedupe by composite name+text. Two rows with the same Question Text
      // but different Report Labels are distinct questions (prod CSVs do this
      // routinely — e.g. multiple "Did the agent..." prompts that surface
      // under different report headings). Earlier dedupe-by-text-only was
      // collapsing 25-row groups down to 6.
      const key = `${name}\u0000${text}`;
      if (bucket.has(key)) { dupes++; continue; }
      bucket.set(key, { name, text, autoYesExp: autoYes });
    }
    const configs: GroupedConfig[] = Array.from(groups.entries()).map(([name, bucket]) => ({
      name, type: importType, questions: Array.from(bucket.values()),
    }));
    if (configs.length === 0) {
      alert("No valid rows found. Make sure your column choices are correct.");
      return;
    }
    const totalQ = configs.reduce((s, c) => s + c.questions.length, 0);
    setGrouped(configs);
    setPreviewSummary(`${configs.length} configs, ${totalQ} unique questions${dupes > 0 ? ` (${dupes} duplicates removed)` : ""}`);
    setStep("preview");
  }

  async function runImport() {
    if (grouped.length === 0) return;
    setStep("run");
    let created = 0, overwritten = 0, skipped = 0, totalQ = 0, errors = 0;
    let log = `Starting import of ${grouped.length} configs (duplicate mode: ${dupeMode})\n`;
    setProgress({ pct: 0, label: "", log });

    for (let i = 0; i < grouped.length; i++) {
      const cfg = grouped[i];
      const pct = Math.round(((i + 1) / grouped.length) * 100);
      setProgress((p) => ({ ...p, pct, label: `${i + 1} / ${grouped.length} — ${cfg.name}` }));

      let ok = false;
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        try {
          if (attempt > 0) {
            log += `  Retry ${attempt}/2 for ${cfg.name}...\n`;
            setProgress((p) => ({ ...p, log }));
            await new Promise((r) => setTimeout(r, 1500 * attempt));
          }
          const res = await fetch("/api/qlab/configs/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: cfg.name, type: cfg.type, questions: cfg.questions, dupeMode }),
          });
          if (res.status === 503) { log += `  503 on ${cfg.name}, retrying...\n`; setProgress((p) => ({ ...p, log })); continue; }
          const d = await res.json() as ImportResponse;
          ok = true;
          if (d.ok) {
            if (d.skipped) { skipped++; log += `Skipped: ${cfg.name}\n`; }
            else if (d.overwritten) { overwritten++; totalQ += d.questions ?? 0; log += `Overwritten: ${cfg.name} (${d.questions ?? 0}q)\n`; }
            else { created++; totalQ += d.questions ?? 0; log += `Created: ${d.configName ?? cfg.name} (${d.questions ?? 0}q)\n`; }
          } else {
            errors++; log += `ERROR: ${cfg.name} — ${d.error ?? "unknown"}\n`;
          }
        } catch (e) {
          if (attempt === 2) { errors++; log += `FAILED: ${cfg.name} — ${(e as Error).message}\n`; }
        }
      }
      setProgress((p) => ({ ...p, log }));
    }

    log += `\nDone! ${[
      created && `${created} created`, overwritten && `${overwritten} overwritten`,
      skipped && `${skipped} skipped`, errors && `${errors} errors`,
    ].filter(Boolean).join(", ")} — ${totalQ} total questions\n`;
    setProgress((p) => ({ ...p, log, pct: 100 }));
    setResult({ created, overwritten, skipped, totalQ, errors });
    setStep("done");
  }

  if (step === "closed") {
    return (
      <button class="sf-btn" style="font-size:11px;" type="button" onClick={open}>Import CSV</button>
    );
  }

  return (
    <>
      <button class="sf-btn" style="font-size:11px;" type="button" onClick={open}>Import CSV</button>
      <div class="modal-overlay open" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
        <div class="modal" style="width:min(720px, 96vw);max-width:96vw;max-height:88vh;display:flex;flex-direction:column;overflow:hidden;">
          {step === "upload" && (
            <Section title="Import from CSV" onClose={close}>
              <div style="font-size:11px;color:var(--text-dim);margin-bottom:14px;">
                Upload a CSV that contains a question per row. The next step will let you map your CSV columns to <code>Question Text</code>, <code>Report Label / Name</code>, <code>Auto-Yes Expression</code>, and a <code>Group By</code> column. The Group By column splits your rows into one config per unique value (e.g. one config per destination).
              </div>
              <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.8px;">CSV File</label>
              <input class="sf-input" type="file" accept=".csv,text/csv" onChange={onFileChange} style="width:100%;font-size:12px;" />
              {fileInfo && <div style="margin-top:8px;font-size:11px;color:var(--text-dim);">{fileInfo}</div>}
            </Section>
          )}

          {step === "map" && (
            <Section title="Map Columns" onClose={close} backTo={() => setStep("upload")}>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
                <Mapping label="Question Text *" value={mappings.text} headers={headers} onChange={(v) => setMappings({ ...mappings, text: v })} />
                <Mapping label="Report Label / Name *" value={mappings.name} headers={headers} onChange={(v) => setMappings({ ...mappings, name: v })} />
                <Mapping label="Auto-Yes Expression" value={mappings.autoyes} headers={headers} onChange={(v) => setMappings({ ...mappings, autoyes: v })} />
                <Mapping label="Group By (Config Name) *" value={mappings.group} headers={headers} onChange={(v) => setMappings({ ...mappings, group: v })} />
              </div>
              <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.8px;">Config Type</label>
              <div style="display:flex;gap:6px;margin-bottom:14px;">
                <button type="button" class={`sf-btn ${importType === "internal" ? "primary" : ""}`} style="font-size:11px;" onClick={() => setImportType("internal")}>Internal</button>
                <button type="button" class={`sf-btn ${importType === "partner" ? "primary" : ""}`} style="font-size:11px;" onClick={() => setImportType("partner")}>Partner</button>
              </div>
              <div style="display:flex;justify-content:flex-end;">
                <button type="button" class="sf-btn primary" style="font-size:11px;" onClick={buildPreview}>Preview Import</button>
              </div>
            </Section>
          )}

          {step === "preview" && (
            <Section title="Preview" onClose={close} backTo={() => setStep("map")}>
              <div style="font-size:13px;color:var(--text);margin-bottom:14px;font-weight:500;">{previewSummary}</div>
              <div style="max-height:240px;overflow:auto;margin-bottom:16px;border:1px solid var(--border);border-radius:8px;">
                <table style="width:100%;font-size:12px;">
                  <thead style="position:sticky;top:0;background:var(--bg-raised);">
                    <tr style="text-align:left;color:var(--text-dim);font-size:10px;text-transform:uppercase;letter-spacing:1px;">
                      <th style="padding:8px;">Config Name</th>
                      <th style="padding:8px;">Questions</th>
                      <th style="padding:8px;">Sample</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grouped.map((c) => (
                      <tr key={c.name} style="border-top:1px solid var(--border);">
                        <td style="padding:8px;font-weight:600;">{c.name}</td>
                        <td style="padding:8px;color:var(--text-dim);">{c.questions.length}</td>
                        <td style="padding:8px;color:var(--text-dim);max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{c.questions[0]?.name ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.8px;">If config name already exists</label>
              <div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;">
                <DupeOpt mode="skip" label="Skip" desc="Keep existing" active={dupeMode === "skip"} onPick={setDupeMode} />
                <DupeOpt mode="overwrite" label="Overwrite" desc="Replace existing" active={dupeMode === "overwrite"} onPick={setDupeMode} />
                <DupeOpt mode="duplicate" label="Duplicate" desc="Add numbered copy" active={dupeMode === "duplicate"} onPick={setDupeMode} />
              </div>
              <div style="display:flex;justify-content:flex-end;">
                <button type="button" class="sf-btn primary" style="font-size:11px;" onClick={runImport}>Import</button>
              </div>
            </Section>
          )}

          {step === "run" && (
            <Section title="Importing…" onClose={close}>
              <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
                <span style="font-size:12px;color:var(--text);font-weight:500;">{progress.label}</span>
                <span style="font-size:11px;color:var(--text-dim);">{progress.pct}%</span>
              </div>
              <div style="height:6px;background:var(--bg);border-radius:3px;overflow:hidden;border:1px solid var(--border);margin-bottom:8px;">
                <div style={`height:100%;background:var(--green);width:${progress.pct}%;transition:width 0.2s;border-radius:3px;`}></div>
              </div>
              <pre style="margin:0;max-height:220px;overflow:auto;font-size:11px;font-family:var(--mono);color:var(--text-dim);background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:8px;white-space:pre-wrap;">{progress.log}</pre>
            </Section>
          )}

          {step === "done" && (
            <Section title="Import Complete" onClose={close}>
              <div style="font-size:14px;color:var(--green);padding:6px 0 18px;text-align:center;">
                {result.totalQ} questions across {result.created + result.overwritten} configs
                {result.skipped > 0 ? ` (${result.skipped} skipped)` : ""}
                {result.overwritten > 0 ? ` (${result.overwritten} overwritten)` : ""}
                {result.errors > 0 ? ` (${result.errors} errors)` : ""}
              </div>
              <pre style="margin:0 0 14px;max-height:220px;overflow:auto;font-size:11px;font-family:var(--mono);color:var(--text-dim);background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:8px;white-space:pre-wrap;">{progress.log}</pre>
              <div style="display:flex;justify-content:flex-end;">
                <button type="button" class="sf-btn primary" style="font-size:11px;" onClick={() => globalThis.location.reload()}>Done</button>
              </div>
            </Section>
          )}
        </div>
      </div>
    </>
  );
}

function Section({ title, onClose, backTo, children }: { title: string; onClose: () => void; backTo?: () => void; children: preact.ComponentChildren }) {
  return (
    <>
      <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 24px 14px;border-bottom:1px solid var(--border);flex-shrink:0;">
        <div class="modal-title" style="margin:0;">{title}</div>
        <div style="display:flex;gap:6px;">
          {backTo && <button type="button" class="sf-btn ghost" style="font-size:10px;" onClick={backTo}>Back</button>}
          <button type="button" class="sf-btn ghost" style="font-size:10px;" onClick={onClose}>Close</button>
        </div>
      </div>
      <div style="flex:1;overflow:auto;padding:18px 24px;">{children}</div>
    </>
  );
}

function Mapping({ label, value, headers, onChange }: { label: string; value: number; headers: string[]; onChange: (v: number) => void }) {
  return (
    <div>
      <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.8px;">{label}</label>
      <select class="sf-input" style="width:100%;font-size:12px;" value={String(value)} onChange={(e) => onChange(Number((e.target as HTMLSelectElement).value))}>
        <option value="-1">— select —</option>
        {headers.map((h, i) => <option key={i} value={String(i)}>{h}</option>)}
      </select>
    </div>
  );
}

function DupeOpt({ mode, label, desc, active, onPick }: { mode: DupeMode; label: string; desc: string; active: boolean; onPick: (m: DupeMode) => void }) {
  const ring = active ? "var(--blue)" : "var(--border)";
  const bg = active ? "var(--bg-surface)" : "transparent";
  return (
    <button type="button" onClick={() => onPick(mode)} style={`flex:1;min-width:140px;border:1px solid ${ring};background:${bg};padding:10px 12px;border-radius:8px;text-align:left;cursor:pointer;`}>
      <div style="font-size:12px;font-weight:600;color:var(--text-bright);">{label}</div>
      <div style="font-size:10px;color:var(--text-dim);margin-top:2px;">{desc}</div>
    </button>
  );
}

// Tiny rawParse — same parser as frontend/lib/csv.ts but returning string[][]
// so we can keep header → index addressing without converting through objects.
function rawParse(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const text = input.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; continue; } inQuotes = false; continue; }
      cell += ch; continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ",") { row.push(cell); cell = ""; continue; }
    if (ch === "\r") continue;
    if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
    cell += ch;
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

// Re-export for tests so we can verify parser parity.
export { rawParse, parseCsv };
