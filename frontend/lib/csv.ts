/** Tiny CSV parser tailored to QLab imports.
 *  Supports quoted fields with embedded commas/newlines/escaped quotes ("").
 *  Always assumes the first row is a header. Returns an array of objects
 *  keyed by lowercased header name. */

export type CsvRow = Record<string, string>;

export function parseCsv(input: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  let inQuotes = false;
  const text = input.replace(/^\uFEFF/, ""); // strip BOM if present

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      cell += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ",") { row.push(cell); cell = ""; i++; continue; }
    if (ch === "\r") { i++; continue; }
    if (ch === "\n") {
      row.push(cell); rows.push(row);
      row = []; cell = ""; i++; continue;
    }
    cell += ch; i++;
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }

  if (rows.length === 0) return [];

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const out: CsvRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (cells.length === 1 && cells[0].trim() === "") continue; // skip blank lines
    const obj: CsvRow = {};
    for (let c = 0; c < header.length; c++) obj[header[c]] = (cells[c] ?? "").trim();
    out.push(obj);
  }
  return out;
}

export interface QlabImportRow {
  name: string;
  text: string;
  autoYesExp?: string;
  egregious?: boolean;
  weight?: number;
  temperature?: number;
}

/** Convert raw CSV rows into the shape the backend's /api/qlab/configs/import
 *  endpoint expects. Required columns: name, text. Optional: autoyesexp,
 *  egregious, weight, temperature. */
export function csvToQuestions(rows: CsvRow[]): QlabImportRow[] {
  const out: QlabImportRow[] = [];
  for (const r of rows) {
    const name = r.name ?? r.header ?? "";
    const text = r.text ?? r.question ?? "";
    if (!name || !text) continue;
    const q: QlabImportRow = { name, text };
    const auto = r.autoyesexp ?? r["auto-yes"] ?? r.autoyes ?? "";
    if (auto) q.autoYesExp = auto;
    if (r.egregious) q.egregious = /^(true|yes|1|y)$/i.test(r.egregious);
    if (r.weight) { const n = Number(r.weight); if (!Number.isNaN(n)) q.weight = n; }
    if (r.temperature) { const n = Number(r.temperature); if (!Number.isNaN(n)) q.temperature = n; }
    out.push(q);
  }
  return out;
}
