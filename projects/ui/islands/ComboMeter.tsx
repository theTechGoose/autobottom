import { useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";

interface ComboMeterProps {
  combo: number;
  streakThreshold: number; // seconds; 0 = flat-timeout mode
  timeBank: number; // seconds remaining in bank (only used when threshold > 0)
}

function getComboClass(combo: number): string {
  if (combo <= 0) return "combo-dim";
  if (combo >= 23) return "combo-godlike";
  if (combo >= 12) return "combo-inferno";
  if (combo >= 5) return "combo-fire";
  if (combo >= 3) return "combo-hot";
  return "combo-dim";
}

function getBankClass(timeBank: number, threshold: number): string {
  if (timeBank > threshold * 2) return "tb-green";
  if (timeBank > threshold * 0.5) return "tb-yellow";
  return "tb-red";
}

export default function ComboMeter({ combo, streakThreshold, timeBank }: ComboMeterProps) {
  const bankPct = streakThreshold > 0
    ? Math.min(100, (timeBank / (streakThreshold * 3)) * 100)
    : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
      <span
        class={`combo-counter ${getComboClass(combo)}`}
        style={{
          fontSize: "12px", fontWeight: "800", fontVariantNumeric: "tabular-nums",
          minWidth: "28px", textAlign: "center", letterSpacing: "-0.5px",
        }}
      >
        {combo > 0 ? `${combo}x` : ""}
      </span>
      {streakThreshold > 0 && (
        <div
          style={{
            width: "40px", height: "3px", background: "#1a1f2b",
            borderRadius: "2px", overflow: "hidden",
          }}
        >
          <div
            class={`time-bank-fill ${getBankClass(timeBank, streakThreshold)}`}
            style={{ height: "100%", width: `${bankPct}%`, borderRadius: "2px", transition: "width 0.3s linear" }}
          />
        </div>
      )}

      <style>{`
        .combo-counter { transition: all 0.2s; }
        .combo-dim { color: #3d4452; }
        .combo-hot { color: #8b5cf6; text-shadow: 0 0 8px rgba(139,92,246,0.4); }
        .combo-fire { color: #fab005; text-shadow: 0 0 10px rgba(250,176,5,0.5); animation: comboPulse 1.5s ease infinite; }
        .combo-inferno { color: #ef4444; text-shadow: 0 0 14px rgba(239,68,68,0.6); animation: comboPulse 0.8s ease infinite; }
        .combo-godlike { color: #a855f7; text-shadow: 0 0 18px rgba(168,85,247,0.7), 0 0 40px rgba(168,85,247,0.3); animation: comboPulse 0.5s ease infinite; }
        @keyframes comboPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.7; } }
        .tb-green { background: #3fb950; }
        .tb-yellow { background: #d29922; }
        .tb-red { background: #f85149; }
      `}</style>
    </div>
  );
}
