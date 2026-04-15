/** CSS-only donut chart — conic-gradient circle with legend. */

interface DonutChartProps {
  title: string;
  segments: { label: string; value: number; color: string }[];
}

export function DonutChart({ title, segments }: DonutChartProps) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) {
    return (
      <div class="chart-panel">
        <div class="chart-title">{title}</div>
        <div style="text-align:center;color:var(--text-dim);padding:30px;">No data</div>
      </div>
    );
  }

  // Build conic-gradient stops
  let angle = 0;
  const stops = segments.map((seg) => {
    const pct = (seg.value / total) * 100;
    const start = angle;
    angle += pct;
    return `${seg.color} ${start}% ${angle}%`;
  }).join(", ");

  const mainPct = total > 0 ? Math.round((segments.filter(s => s.color.includes("3fb950"))[0]?.value ?? segments[segments.length - 1]?.value ?? 0) / total * 100) : 0;

  return (
    <div class="chart-panel">
      <div class="chart-title">{title}</div>
      <div class="donut-wrap">
        <div class="donut" style={`background: conic-gradient(${stops})`}>
          <div class="donut-hole">{mainPct}%</div>
        </div>
        <div class="donut-legend">
          {segments.map((seg) => (
            <div key={seg.label} class="donut-item">
              <span class="donut-dot" style={`background:${seg.color}`}></span>
              <span>{seg.label}</span>
              <span class="donut-val">{seg.value.toLocaleString()}</span>
            </div>
          ))}
          <div class="donut-item" style="border-top:1px solid var(--border);padding-top:6px;margin-top:4px;">
            <span></span>
            <span style="color:var(--text-dim);">Total</span>
            <span class="donut-val">{total.toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
