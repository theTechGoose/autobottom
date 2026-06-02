/** Email Engagement headline cards — shared by the Reports modal fragment
 *  (routes/api/admin/modal/reports/engagement.tsx) and the full-page drill-down
 *  (routes/admin/email-engagement.tsx) so both render identical cards.
 *  Pure presentational Preact. */

export function RateCard(
  { title, rate, appealLabel, appealRate, accent }: {
    title: string; rate: number; appealLabel: string; appealRate: number; accent: string;
  },
) {
  return (
    <div style={`border:1px solid var(--border);border-left:3px solid ${accent};border-radius:8px;padding:14px;background:var(--bg-2);`}>
      <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">{title}</div>
      <div style={`font-size:28px;font-weight:800;color:${accent};font-variant-numeric:tabular-nums;`}>{rate}%</div>
      <div style="font-size:11px;color:var(--text-dim);margin-top:8px;">{appealLabel} <strong style="color:var(--text-bright);">{appealRate}%</strong></div>
    </div>
  );
}

export function MiniStat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style="border:1px solid var(--border);border-radius:6px;padding:10px;background:var(--bg);">
      <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">{label}</div>
      <div style={`font-size:18px;font-weight:700;color:${color ?? "var(--text-bright)"};font-variant-numeric:tabular-nums;`}>{value.toLocaleString()}</div>
    </div>
  );
}
