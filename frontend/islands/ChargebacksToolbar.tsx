/** Chargebacks modal toolbar — handles Pull Report, Download (CSV/XLSX),
 *  and Post to Sheet. Replaces the disabled stub buttons.
 *
 *  The data fetch goes through a new JSON proxy (`/api/admin/chargebacks-json`)
 *  so the island can transform to CSV/XLSX/Sheets without scraping the DOM. */
import { useEffect, useRef, useState } from "preact/hooks";

type Tab = "cb" | "wire";

interface CbItem { date?: string; teamMember?: string; revenue?: string; crmLink?: string; findingId?: string; type?: string; failedQuestions?: string[]; }
interface WireItem { date?: string; score?: number; questions?: number; passed?: number; crmLink?: string; findingId?: string; office?: string; auditor?: string; guestName?: string; }

declare global {
  // deno-lint-ignore no-explicit-any
  interface Window { XLSX?: any; }
}

function toISODate(input: string): string {
  // cb-date-from / cb-date-to come back as YYYY-MM-DD
  return input.trim();
}
function toMs(date: string, endOfDay = false): number {
  const [y, m, d] = date.split("-").map((n) => Number(n));
  const t = new Date(y, (m ?? 1) - 1, d ?? 1, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0);
  return t.getTime();
}

function cbToRows(cbs: CbItem[]): (string | number)[][] {
  const header = ["Date", "Team Member", "Revenue", "CRM", "Audit", "Type", "Failed Questions"];
  const body = cbs.map((c) => [
    c.date ?? "",
    c.teamMember ?? "",
    c.revenue ?? "",
    c.crmLink ?? "",
    c.findingId ?? "",
    c.type ?? "",
    (c.failedQuestions ?? []).join("; "),
  ]);
  return [header, ...body];
}
function wireToRows(ws: WireItem[]): (string | number)[][] {
  const header = ["Date", "Score %", "Questions", "Passed", "CRM", "Audit", "Office", "Auditor", "Guest"];
  const body = ws.map((w) => [
    w.date ?? "",
    w.score ?? "",
    w.questions ?? "",
    w.passed ?? "",
    w.crmLink ?? "",
    w.findingId ?? "",
    w.office ?? "",
    w.auditor ?? "",
    w.guestName ?? "",
  ]);
  return [header, ...body];
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function rowsToCsv(rows: (string | number)[][]): string {
  return rows.map((row) =>
    row.map((cell) => {
      const s = String(cell ?? "");
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    }).join(",")
  ).join("\n");
}

async function loadXlsxLib(): Promise<void> {
  if (globalThis.window?.XLSX) return;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("failed to load xlsx library"));
    document.head.appendChild(s);
  });
}

interface Props { tab: Tab; }

export default function ChargebacksToolbar({ tab }: Props) {
  const [cbs, setCbs] = useState<CbItem[]>([]);
  const [omissions, setOmissions] = useState<CbItem[]>([]);
  const [wires, setWires] = useState<WireItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const formatRef = useRef<HTMLSelectElement | null>(null);

  function readDateInputs(): { since: number; until: number } | null {
    const from = (document.getElementById("cb-date-from") as HTMLInputElement | null)?.value;
    const to = (document.getElementById("cb-date-to") as HTMLInputElement | null)?.value;
    if (!from || !to) { setMsg({ kind: "err", text: "Pick a date range first." }); return null; }
    return { since: toMs(toISODate(from)), until: toMs(toISODate(to), true) };
  }

  async function pull() {
    const range = readDateInputs();
    if (!range) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/chargebacks-json?tab=${tab}&since=${range.since}&until=${range.until}`, {
        credentials: "include",
      });
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok || (data as { error?: string }).error) {
        throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      if (tab === "wire") {
        setWires(((data as { items?: WireItem[] }).items) ?? []);
        setCbs([]); setOmissions([]);
      } else {
        const d = data as { chargebacks?: CbItem[]; omissions?: CbItem[] };
        setCbs(d.chargebacks ?? []);
        setOmissions(d.omissions ?? []);
        setWires([]);
      }
      setLoaded(true);
      setMsg({ kind: "ok", text: "Report loaded." });
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  function downloadCsv() {
    if (!loaded) { setMsg({ kind: "err", text: "Pull the report first." }); return; }
    const now = new Date().toISOString().slice(0, 10);
    if (tab === "wire") {
      downloadBlob(new Blob([rowsToCsv(wireToRows(wires))], { type: "text/csv;charset=utf-8" }), `wire-deductions-${now}.csv`);
    } else {
      const combined = [...cbToRows(cbs), [], ["Omissions"], ...cbToRows(omissions).slice(1)];
      downloadBlob(new Blob([rowsToCsv(combined)], { type: "text/csv;charset=utf-8" }), `chargebacks-${now}.csv`);
    }
    setMsg({ kind: "ok", text: "CSV downloaded." });
  }

  async function downloadXlsx() {
    if (!loaded) { setMsg({ kind: "err", text: "Pull the report first." }); return; }
    setBusy(true);
    setMsg(null);
    try {
      await loadXlsxLib();
      // deno-lint-ignore no-explicit-any
      const XLSX = (globalThis as any).XLSX;
      if (!XLSX) throw new Error("XLSX library not available");
      const wb = XLSX.utils.book_new();
      const now = new Date().toISOString().slice(0, 10);
      if (tab === "wire") {
        const ws = XLSX.utils.aoa_to_sheet(wireToRows(wires));
        XLSX.utils.book_append_sheet(wb, ws, "Wire Deductions");
        XLSX.writeFile(wb, `wire-deductions-${now}.xlsx`);
      } else {
        if (cbs.length) {
          XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cbToRows(cbs)), "Chargebacks");
        }
        if (omissions.length) {
          XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cbToRows(omissions)), "Omissions");
        }
        if (!cbs.length && !omissions.length) {
          XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["No data"]]), "Empty");
        }
        XLSX.writeFile(wb, `chargebacks-${now}.xlsx`);
      }
      setMsg({ kind: "ok", text: "XLSX downloaded." });
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function postToSheet() {
    if (!loaded) { setMsg({ kind: "err", text: "Pull the report first." }); return; }
    const range = readDateInputs();
    if (!range) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/post-to-sheet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          since: range.since,
          until: range.until,
          tabs: tab === "wire" ? "wire" : "cb,om",
        }),
      });
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      const d = data as { ok?: boolean; appended?: number; message?: string; error?: string };
      if (!res.ok || d.error) throw new Error(d.error ?? `HTTP ${res.status}`);
      setMsg({ kind: "ok", text: d.appended != null ? `Posted ${d.appended} row${d.appended === 1 ? "" : "s"} to sheet.` : (d.message ?? "Posted.") });
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  // Message auto-clear
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(t);
  }, [msg]);

  return (
    <>
      <button
        type="button"
        class="sf-btn primary"
        style="font-size:11px;"
        onClick={pull}
        disabled={busy}
      >{busy ? "Loading…" : "Pull Report"}</button>
      <select ref={formatRef} class="sf-input" style="font-size:11px;padding:5px 8px;width:70px;">
        <option value="csv">CSV</option>
        <option value="xlsx">XLSX</option>
      </select>
      <button
        type="button"
        class="sf-btn ghost"
        style="font-size:11px;"
        onClick={() => {
          const fmt = formatRef.current?.value ?? "csv";
          if (fmt === "xlsx") downloadXlsx(); else downloadCsv();
        }}
        disabled={busy || !loaded}
      >Download</button>
      <button
        type="button"
        class="sf-btn ghost"
        style="font-size:11px;"
        onClick={postToSheet}
        disabled={busy || !loaded}
      >Post to Sheet</button>
      {msg && (
        <span
          style={`font-size:10px;margin-left:8px;color:${msg.kind === "ok" ? "var(--green)" : "var(--red)"};`}
        >{msg.text}</span>
      )}
      {/* Rendered tables — island owns the render so we can feed the same
          dataset to CSV/XLSX/Sheets without a separate fetch. */}
      <div id="cb-island-body" style="display:none">{/* mounted by effect */}</div>
      <BodyRenderer tab={tab} cbs={cbs} omissions={omissions} wires={wires} loaded={loaded} />
    </>
  );
}

function BodyRenderer({ tab, cbs, omissions, wires, loaded }: { tab: Tab; cbs: CbItem[]; omissions: CbItem[]; wires: WireItem[]; loaded: boolean }) {
  // Render into #cb-body (the element sits outside this island so we teleport
  // via a portal-effect using a small client-side rerender hook).
  useEffect(() => {
    const body = document.getElementById("cb-body");
    if (!body) return;
    if (!loaded) return; // leave existing placeholder
    // Wipe + render
    body.innerHTML = "";
    const frag = document.createElement("div");
    if (tab === "wire") {
      if (!wires.length) {
        frag.innerHTML = `<div style="color:var(--text-dim);font-size:12px;text-align:center;padding:40px 0;">No wire deductions for this period.</div>`;
      } else {
        const rows = wires.map((w) => `<tr>
          <td>${w.date ?? "—"}</td>
          <td style="font-weight:700;">${w.score != null ? w.score + "%" : "—"}</td>
          <td>${w.questions ?? "—"}</td><td>${w.passed ?? "—"}</td>
          <td>${w.crmLink ? `<a href="${w.crmLink}" target="_blank" class="tbl-link">CRM</a>` : "—"}</td>
          <td>${w.findingId ? `<a href="/audit/report?id=${w.findingId}" class="tbl-link">${w.findingId.slice(0, 8)}</a>` : "—"}</td>
          <td>${w.office ?? "—"}</td><td>${w.auditor ?? "—"}</td><td>${w.guestName ?? "—"}</td>
        </tr>`).join("");
        frag.innerHTML = `<div><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--cyan);margin-bottom:10px;">Wire Deductions (${wires.length})</div><table class="data-table"><thead><tr><th>Date</th><th>Score</th><th>Qs</th><th>Passed</th><th>CRM</th><th>Audit</th><th>Office</th><th>Auditor</th><th>Guest</th></tr></thead><tbody>${rows}</tbody></table></div>`;
      }
    } else {
      const cbRows = cbs.map((c) => `<tr>
        <td>${c.date ?? "—"}</td><td style="font-weight:600;">${c.teamMember ?? "—"}</td>
        <td>${c.revenue ?? "—"}</td>
        <td>${c.crmLink ? `<a href="${c.crmLink}" target="_blank" class="tbl-link">CRM</a>` : "—"}</td>
        <td>${c.findingId ? `<a href="/audit/report?id=${c.findingId}" class="tbl-link">${c.findingId.slice(0, 8)}</a>` : "—"}</td>
        <td><span class="pill pill-red">${c.type ?? "CB"}</span></td>
        <td style="font-size:10px;max-width:200px;">${(c.failedQuestions ?? []).join(", ") || "—"}</td>
      </tr>`).join("");
      const omRows = omissions.map((o) => `<tr>
        <td>${o.date ?? "—"}</td><td style="font-weight:600;">${o.teamMember ?? "—"}</td>
        <td>${o.revenue ?? "—"}</td>
        <td>${o.crmLink ? `<a href="${o.crmLink}" target="_blank" class="tbl-link">CRM</a>` : "—"}</td>
        <td>${o.findingId ? `<a href="/audit/report?id=${o.findingId}" class="tbl-link">${o.findingId.slice(0, 8)}</a>` : "—"}</td>
        <td><span class="pill pill-yellow">${o.type ?? "OM"}</span></td>
        <td style="font-size:10px;max-width:200px;">${(o.failedQuestions ?? []).join(", ") || "—"}</td>
      </tr>`).join("");
      if (!cbs.length && !omissions.length) {
        frag.innerHTML = `<div style="color:var(--text-dim);font-size:12px;text-align:center;padding:40px 0;">No chargebacks or omissions for this period.</div>`;
      } else {
        const cbBlock = cbs.length ? `<div style="margin-bottom:32px;"><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--red);margin-bottom:10px;">Chargebacks (${cbs.length})</div><table class="data-table"><thead><tr><th>Date</th><th>Team Member</th><th>Revenue</th><th>CRM</th><th>Audit</th><th>Type</th><th>Failed Qs</th></tr></thead><tbody>${cbRows}</tbody></table></div>` : "";
        const omBlock = omissions.length ? `<div><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--yellow);margin-bottom:10px;">Omissions (${omissions.length})</div><table class="data-table"><thead><tr><th>Date</th><th>Team Member</th><th>Revenue</th><th>CRM</th><th>Audit</th><th>Type</th><th>Failed Qs</th></tr></thead><tbody>${omRows}</tbody></table></div>` : "";
        frag.innerHTML = `<div>${cbBlock}${omBlock}</div>`;
      }
    }
    body.appendChild(frag);
  }, [tab, cbs, omissions, wires, loaded]);
  return null;
}
