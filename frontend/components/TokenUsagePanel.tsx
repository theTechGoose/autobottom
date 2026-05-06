/** Shared token usage panel — rendered by dashboard SSR and the refresh HTMX fragment. */

export interface TokenData {
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  calls: number;
  by_function: Record<string, { total_tokens: number; calls: number }>;
}

export function TokenUsagePanel({ tokens }: { tokens: TokenData }) {
  const entries = Object.entries(tokens.by_function).sort(([, a], [, b]) => b.total_tokens - a.total_tokens);
  return (
    <>
      <div style="font-size:20px;font-weight:700;color:var(--text-bright);margin-bottom:8px;font-variant-numeric:tabular-nums;">
        {tokens.total_tokens.toLocaleString()}{" "}
        <small style="font-size:11px;color:var(--text-dim);font-weight:400;">
          tokens ({tokens.calls.toLocaleString()} calls)
        </small>
      </div>
      <div style="display:flex;flex-direction:column;gap:3px;max-height:140px;overflow-y:auto;">
        {entries.map(([fn, d]) => (
          <div key={fn} style="display:flex;justify-content:space-between;align-items:center;padding:3px 7px;background:var(--bg);border-radius:4px;font-size:10px;">
            <span style="color:var(--text-muted);font-family:var(--mono);">{fn}</span>
            <span>
              <span style="color:var(--text);font-weight:600;font-variant-numeric:tabular-nums;">{d.total_tokens.toLocaleString()}</span>
              <span style="color:var(--text-dim);font-size:9px;margin-left:5px;">{d.calls} calls</span>
            </span>
          </div>
        ))}
        {entries.length === 0 && <div style="color:var(--text-dim);font-size:11px;padding:10px;">No token usage</div>}
      </div>
    </>
  );
}
