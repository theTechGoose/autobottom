import { define } from "@/utils.ts";

export default define.layout(function ChatLayout({ Component }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Chat - Auto-Bot</title>
        <style>{`
          *,*::before,*::after { box-sizing: border-box; margin: 0; padding: 0; }
          :root {
            --bg: #0a0e14; --bg-raised: #111820; --bg-surface: #161c28;
            --border: #1c2333; --border-hover: #2a3346;
            --text: #c9d1d9; --text-muted: #6e7681; --text-dim: #484f58; --text-bright: #e6edf3;
            --cyan: #39d0d8; --cyan-bg: rgba(57,208,216,0.10); --cyan-dim: rgba(57,208,216,0.25);
            --green: #3fb950; --red: #f85149; --red-bg: rgba(248,81,73,0.10);
            --sidebar-w: 260px;
          }
          body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.5; overflow: hidden; height: 100vh; }
          .layout { display: flex; height: 100vh; }
          .sidebar { width: var(--sidebar-w); min-width: var(--sidebar-w); background: var(--bg-raised); border-right: 1px solid var(--border); display: flex; flex-direction: column; position: fixed; top: 0; left: 0; bottom: 0; z-index: 10; overflow-y: auto; overflow-x: hidden; }
          .sb-brand { padding: 20px 16px 12px; border-bottom: 1px solid var(--border); }
          .sb-brand h1 { font-size: 16px; font-weight: 700; color: var(--text-bright); letter-spacing: -0.3px; }
          .sb-brand .sb-sub { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
          .sb-section { padding: 12px; flex: 1; }
          .sb-label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-dim); padding: 0 12px 8px; }
          .sb-link { display: flex; align-items: center; gap: 8px; padding: 10px 12px; cursor: pointer; user-select: none; border-radius: 8px; margin-bottom: 8px; background: var(--bg); border: 1px solid var(--border); transition: all 0.2s; text-decoration: none; color: inherit; }
          .sb-link:hover { border-color: var(--border-hover); }
          .sb-link.active { border-color: var(--cyan-dim); background: var(--cyan-bg); }
          .sb-link .icon { width: 24px; height: 24px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 11px; flex-shrink: 0; }
          .sb-link .title { font-size: 12px; font-weight: 600; color: var(--text-bright); flex: 1; }
          .sb-link .arrow { font-size: 10px; color: var(--text-dim); }
          .sb-footer { padding: 12px; border-top: 1px solid var(--border); margin-top: auto; }
          .sb-user { display: flex; align-items: center; gap: 10px; padding: 8px 12px; }
          .sb-avatar { width: 28px; height: 28px; border-radius: 50%; background: var(--cyan-bg); color: var(--cyan); display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0; }
          .sb-email { font-size: 11px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 150px; }
          .sb-role { font-size: 10px; color: var(--text-muted); text-transform: capitalize; }
          .main { margin-left: var(--sidebar-w); flex: 1; display: flex; height: 100vh; overflow: hidden; }
        `}</style>
      </head>
      <body>
        <div class="layout">
          <aside class="sidebar">
            <div class="sb-brand">
              <h1>Auto-Bot</h1>
              <div class="sb-sub">Chat</div>
            </div>
            <div class="sb-section">
              <div class="sb-label">Navigation</div>
              <a href="/chat" class="sb-link active">
                <div class="icon" style="background:var(--cyan-bg);color:var(--cyan);">&#128172;</div>
                <span class="title">Chat</span>
                <span class="arrow">&#8250;</span>
              </a>
              <a href="/agent" class="sb-link" id="dashboard-link">
                <div class="icon" style="background:var(--bg-surface);color:var(--text-muted);">&#9776;</div>
                <span class="title">Dashboard</span>
                <span class="arrow">&#8250;</span>
              </a>
            </div>
            <div class="sb-footer">
              <div class="sb-user">
                <div class="sb-avatar" id="nav-avatar">U</div>
                <div>
                  <div class="sb-email" id="nav-username">--</div>
                  <div class="sb-role" id="nav-role">--</div>
                </div>
              </div>
              <button id="logout-btn" class="sb-link" style="width:100%;background:none;cursor:pointer;margin-top:4px;">
                <div class="icon" style="background:var(--red-bg);color:var(--red);">&#10006;</div>
                <span class="title">Logout</span>
              </button>
            </div>
          </aside>
          <div class="main">
            <Component />
          </div>
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
