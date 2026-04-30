/** Pipeline Activity (24h) canvas chart.
 *  Renders 24 one-hour buckets — green (completed), yellow (retries), red (errors).
 *  Semantics match prod's drawActivityChart in main:dashboard/page.ts:1710-1829.
 *
 *  Listens for `htmx:afterSwap` on the parent #stats-section so the chart
 *  redraws on the same 10s cadence the stat cards refresh on. Falls back to
 *  initial SSR data if no swap fires. */
import { useEffect, useRef, useState } from "preact/hooks";

interface Props {
  completedTs: number[];
  errorsTs: number[];
  retriesTs: number[];
}

function bucketByHour(ts: number[]): number[] {
  // Returns 24 buckets, oldest→newest. Bucket i covers the hour
  // ending at (now - (23 - i) hours).
  const now = Date.now();
  const buckets = new Array(24).fill(0);
  const floor = now - 24 * 60 * 60 * 1000;
  for (const t of ts) {
    if (t < floor || t > now) continue;
    const ageH = Math.floor((now - t) / (60 * 60 * 1000));
    const idx = 23 - Math.min(23, Math.max(0, ageH));
    buckets[idx]++;
  }
  return buckets;
}

export default function PipelineActivityChart(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Local state so we can update from htmx:afterSwap without re-mounting.
  const [data, setData] = useState<Props>({
    completedTs: props.completedTs,
    errorsTs: props.errorsTs,
    retriesTs: props.retriesTs,
  });
  const { completedTs, errorsTs, retriesTs } = data;

  // Refresh on stat-section HTMX swap. Cheap fetch — same endpoint the page
  // already SSRs against — and reuses the keep-alive connection.
  useEffect(() => {
    const onSwap = async (e: Event) => {
      const target = (e as CustomEvent).detail?.elt as HTMLElement | undefined;
      if (target?.id !== "stats-section") return;
      try {
        const res = await fetch("/api/admin/dashboard/data", { credentials: "include" });
        if (!res.ok) return;
        const fresh = await res.json() as { pipeline?: { completedTs?: number[]; errorsTs?: number[]; retriesTs?: number[] } };
        setData({
          completedTs: fresh.pipeline?.completedTs ?? [],
          errorsTs: fresh.pipeline?.errorsTs ?? [],
          retriesTs: fresh.pipeline?.retriesTs ?? [],
        });
      } catch { /* network blip — keep last data */ }
    };
    document.addEventListener("htmx:afterSwap", onSwap);
    return () => document.removeEventListener("htmx:afterSwap", onSwap);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const dpr = globalThis.devicePixelRatio || 1;
      const cssW = canvas.clientWidth || 600;
      const cssH = canvas.clientHeight || 140;
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, cssW, cssH);

      const cB = bucketByHour(completedTs);
      const eB = bucketByHour(errorsTs);
      const rB = bucketByHour(retriesTs);

      const maxVal = Math.max(1, ...cB, ...eB, ...rB);
      const padL = 28, padR = 8, padT = 10, padB = 22;
      const plotW = cssW - padL - padR;
      const plotH = cssH - padT - padB;
      const slot = plotW / 23; // 24 points → 23 spans

      // Y-axis gridlines (4 lines)
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      ctx.font = "9px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillStyle = "#484f58";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (let g = 0; g <= 4; g++) {
        const y = padT + (plotH * g) / 4;
        const label = Math.round(maxVal * (1 - g / 4));
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(padL + plotW, y);
        ctx.stroke();
        ctx.fillText(String(label), padL - 4, y);
      }

      // X-axis hour labels (every 6 hours) — show -24h, -18h, -12h, -6h, now
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = "#484f58";
      for (let i = 0; i <= 4; i++) {
        const bucketIdx = Math.round((i / 4) * 23);
        const x = padL + slot * bucketIdx;
        const h = 23 - bucketIdx;
        ctx.fillText(h === 0 ? "now" : `-${h}h`, x, padT + plotH + 4);
      }

      // Series lines — completed (green), retries (yellow), errors (red).
      const series: Array<{ data: number[]; color: string }> = [
        { data: cB, color: "#3fb950" },
        { data: rB, color: "#d29922" },
        { data: eB, color: "#f85149" },
      ];
      for (const s of series) {
        ctx.strokeStyle = s.color;
        ctx.fillStyle = s.color;
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        ctx.beginPath();
        for (let i = 0; i < 24; i++) {
          const x = padL + slot * i;
          const y = padT + plotH - (s.data[i] / maxVal) * plotH;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        // Dots at each data point
        for (let i = 0; i < 24; i++) {
          if (s.data[i] === 0) continue;
          const x = padL + slot * i;
          const y = padT + plotH - (s.data[i] / maxVal) * plotH;
          ctx.beginPath();
          ctx.arc(x, y, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Legend
      ctx.font = "10px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.textBaseline = "middle";
      const legend = [
        { c: "#3fb950", label: `Completed ${completedTs.length}` },
        { c: "#d29922", label: `Retries ${retriesTs.length}` },
        { c: "#f85149", label: `Errors ${errorsTs.length}` },
      ];
      let lx = padL;
      const ly = padT / 2 + 2;
      for (const item of legend) {
        ctx.fillStyle = item.c;
        ctx.fillRect(lx, ly - 4, 8, 8);
        ctx.fillStyle = "#8b949e";
        ctx.textAlign = "left";
        ctx.fillText(item.label, lx + 12, ly);
        lx += ctx.measureText(item.label).width + 30;
      }
    };

    draw();
    const onResize = () => draw();
    globalThis.addEventListener("resize", onResize);
    return () => globalThis.removeEventListener("resize", onResize);
  }, [completedTs, errorsTs, retriesTs]);

  return (
    <canvas
      ref={canvasRef}
      style="width:100%;height:140px;display:block;"
    />
  );
}
