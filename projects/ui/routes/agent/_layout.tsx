import { define } from "@/utils.ts";

export default define.layout(function AgentLayout({ Component }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Agent Dashboard</title>
        <style>{`
          * { margin: 0; padding: 0; box-sizing: border-box; }
          :root {
            --bg: #0a0e14; --bg-raised: #111820; --bg-surface: #161c28;
            --border: #1c2333; --border-hover: #2a3346;
            --text: #c9d1d9; --text-muted: #6e7681; --text-dim: #484f58; --text-bright: #e6edf3;
            --accent: #f97316; --accent-dim: #ea580c; --accent-bg: rgba(249,115,22,0.10);
            --green: #3fb950; --red: #f85149; --yellow: #d29922;
            --green-bg: rgba(63,185,80,0.10); --red-bg: rgba(248,81,73,0.10); --yellow-bg: rgba(210,153,34,0.10);
            --sidebar-w: 280px;
            --mono: 'SF Mono', 'Fira Code', monospace;
          }
          body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; min-height: 100vh; }
          .layout { display: flex; min-height: 100vh; }
          .sidebar {
            width: var(--sidebar-w); min-width: var(--sidebar-w); background: var(--bg-raised);
            border-right: 1px solid var(--border); display: flex; flex-direction: column;
            position: fixed; top: 0; left: 0; bottom: 0; z-index: 10;
            overflow-y: auto; overflow-x: hidden;
          }
          .sidebar::-webkit-scrollbar { width: 3px; }
          .sidebar::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
          .sb-brand { padding: 20px 18px 16px; border-bottom: 1px solid var(--border); }
          .sb-brand h1 { font-size: 14px; font-weight: 700; color: var(--text-bright); letter-spacing: -0.3px; }
          .sb-brand .sb-sub { font-size: 10px; color: var(--text-dim); margin-top: 4px; }
          .sb-section { padding: 14px 14px 6px; }
          .sb-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: var(--text-dim); margin-bottom: 8px; padding: 0 4px; }
          .sb-link {
            display: flex; align-items: center; gap: 8px; padding: 10px 12px; cursor: pointer;
            user-select: none; border-radius: 8px; margin-bottom: 8px; background: var(--bg);
            border: 1px solid var(--border); transition: border-color 0.15s; text-decoration: none; color: inherit;
          }
          .sb-link:hover { border-color: var(--border-hover); }
          .sb-link.active { border-color: var(--accent-dim); background: var(--accent-bg); }
          .sb-link .icon { width: 24px; height: 24px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 11px; flex-shrink: 0; }
          .sb-link .icon.accent { background: var(--accent-bg); color: var(--accent); }
          .sb-link .title { font-size: 12px; font-weight: 600; color: var(--text-bright); flex: 1; }
          .sb-link .arrow { font-size: 10px; color: var(--text-dim); }
          .sb-footer { margin-top: auto; border-top: 1px solid var(--border); }
          .sb-footer .sb-user { padding: 14px 18px 8px; display: flex; align-items: center; gap: 8px; }
          .sb-footer .sb-avatar { width: 28px; height: 28px; border-radius: 50%; background: var(--accent-bg); color: var(--accent); display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0; }
          .sb-footer .sb-email { font-size: 11px; color: var(--text-bright); font-weight: 600; word-break: break-all; line-height: 1.3; }
          .sb-footer .sb-role { font-size: 9px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; }
          .sb-footer .sb-settings { padding: 6px 14px 14px; }
          .main { margin-left: var(--sidebar-w); flex: 1; padding: 24px 32px; }
          @media (max-width: 900px) { .sidebar { display: none; } .main { margin-left: 0; padding: 16px; } }
        `}</style>
      </head>
      <body>
        <div class="layout">
          <aside class="sidebar">
            <div class="sb-brand">
              <h1>Auto-Bot</h1>
              <div class="sb-sub">Agent Panel</div>
            </div>
            <div class="sb-section">
              <div class="sb-label">Navigation</div>
              <a href="/agent" class="sb-link active">
                <div class="icon accent">&#9776;</div>
                <span class="title">Dashboard</span>
                <span class="arrow">&#8250;</span>
              </a>
              <a href="/chat" class="sb-link">
                <div class="icon" style="background:rgba(57,208,216,0.10);color:#39d0d8;">&#128172;</div>
                <span class="title">Chat</span>
                <span class="arrow">&#8250;</span>
              </a>
              <a href="/store" class="sb-link">
                <div class="icon" style="background:rgba(236,72,153,0.10);color:#ec4899;">&#128717;</div>
                <span class="title">Store</span>
                <span class="arrow">&#8250;</span>
              </a>
            </div>
            <div class="sb-footer">
              <div class="sb-user">
                <div class="sb-avatar" id="nav-avatar">A</div>
                <div>
                  <div class="sb-email" id="nav-username">--</div>
                  <div class="sb-role">Agent</div>
                </div>
              </div>
              <div class="sb-settings">
                <button id="logout-btn" class="sb-link" style="width:100%;background:none;cursor:pointer;">
                  <div class="icon" style="background:var(--red-bg);color:var(--red);">&#10006;</div>
                  <span class="title">Logout</span>
                </button>
              </div>
            </div>
          </aside>
          <main class="main">
            <Component />
          </main>
        </div>
        <script>{`
          var logoutBtn = document.getElementById('logout-btn');
          if (logoutBtn) {
            logoutBtn.addEventListener('click', function() {
              fetch('/logout', { method: 'POST' }).finally(function() {
                window.location.href = '/login';
              });
            });
          }
        `}</script>
      </body>
    </html>
  );
});
