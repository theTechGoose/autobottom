/** Month-bucket range presets + resolution for the Question Failures report.
 *
 *  QF data is stored monthly per (configKey, questionKey, yyyymm), so ranges
 *  resolve to YYYYMM bounds (no Today / sub-monthly — see the modal note).
 *  Shared by the modal fragment (routes/api/admin/modal/reports/question-failures*)
 *  and the full-page report (routes/admin/question-failures.tsx). */

export const QF_PRESETS: Array<{ key: string; label: string }> = [
  { key: "this-month", label: "This Month" },
  { key: "last-month", label: "Last Month" },
  { key: "last-3", label: "Last 3 Months" },
  { key: "last-6", label: "Last 6 Months" },
  { key: "all-time", label: "All Time" },
];

export function currentYyyymm(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function shiftMonths(yyyymm: string, delta: number): string {
  const y = Number(yyyymm.slice(0, 4));
  const m = Number(yyyymm.slice(4, 6));
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}${String(nm).padStart(2, "0")}`;
}

function dateToYyyymm(dateStr: string): string | null {
  if (!dateStr) return null;
  const m = dateStr.match(/^(\d{4})-(\d{2})-/);
  if (!m) return null;
  return `${m[1]}${m[2]}`;
}

export interface QfResolved { from: string; to: string; label: string }

export function resolveQfRange(preset: string, customFrom: string, customTo: string): QfResolved {
  const now = currentYyyymm();
  switch (preset) {
    case "this-month": return { from: now, to: now, label: "This Month" };
    case "last-month": {
      const prev = shiftMonths(now, -1);
      return { from: prev, to: prev, label: "Last Month" };
    }
    case "last-3": return { from: shiftMonths(now, -2), to: now, label: "Last 3 Months" };
    case "last-6": return { from: shiftMonths(now, -5), to: now, label: "Last 6 Months" };
    case "all-time": return { from: "000000", to: now, label: "All Time" };
    case "custom": {
      const from = dateToYyyymm(customFrom);
      const to = dateToYyyymm(customTo);
      if (from && to) return { from, to, label: `${from} → ${to}` };
      if (from) return { from, to: now, label: `${from} → now` };
      if (to) return { from: "000000", to, label: `epoch → ${to}` };
      return { from: now, to: now, label: "This Month (no custom range)" };
    }
    default: return { from: now, to: now, label: "This Month" };
  }
}
