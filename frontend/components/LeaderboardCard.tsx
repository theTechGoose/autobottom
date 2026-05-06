/** Shared leaderboard widget — top-N XP earners.
 *  Used on judge / review / agent dashboards. SSR-fetched at page load;
 *  HTMX `every 60s` swap target wraps it for live refresh. */

export interface LeaderboardEntry {
  rank: number;
  email: string;
  totalXp: number;
  level: number;
  dayStreak: number;
}

const MEDAL = ["🥇", "🥈", "🥉"];

export function LeaderboardCard({ entries, accent = "var(--blue)" }: { entries: LeaderboardEntry[]; accent?: string }) {
  return (
    <div class="card" style="padding:16px 18px;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px;">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);">Leaderboard</div>
        <span style={`font-size:10px;color:${accent};font-family:var(--mono);`}>top {entries.length}</span>
      </div>
      {entries.length === 0 ? (
        <div style="text-align:center;color:var(--text-dim);font-size:12px;padding:20px 0;">No XP earned yet.</div>
      ) : (
        <div style="display:flex;flex-direction:column;gap:6px;">
          {entries.map((e) => (
            <div
              key={e.email}
              style="display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:6px;background:var(--bg);"
            >
              <span style={`font-family:var(--mono);font-size:11px;width:24px;text-align:center;color:${e.rank <= 3 ? accent : "var(--text-dim)"};`}>
                {e.rank <= 3 ? MEDAL[e.rank - 1] : `#${e.rank}`}
              </span>
              <span style="flex:1;font-size:12px;color:var(--text-bright);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{e.email}</span>
              <span style={`font-family:var(--mono);font-size:11px;color:${accent};font-weight:600;`}>{e.totalXp.toLocaleString()}<span style="color:var(--text-dim);font-weight:400;"> xp</span></span>
              <span style="font-family:var(--mono);font-size:10px;color:var(--text-dim);min-width:36px;text-align:right;">L{e.level}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
