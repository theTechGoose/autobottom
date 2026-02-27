import * as icons from "../shared/icons.ts";

export function getChatPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Chat - Auto-Bot</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
:root{
  --bg:#0a0e14;--bg-raised:#111820;--bg-surface:#161c28;
  --border:#1c2333;--border-hover:#2a3346;
  --text:#c9d1d9;--text-muted:#6e7681;--text-dim:#484f58;--text-bright:#e6edf3;
  --cyan:#39d0d8;--cyan-bg:rgba(57,208,216,0.10);--cyan-dim:rgba(57,208,216,0.25);
  --green:#3fb950;--red:#f85149;--red-bg:rgba(248,81,73,0.10);
  --sidebar-w:260px;
}
body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.5;overflow:hidden;height:100vh;}
.layout{display:flex;height:100vh;}

/* ============ SIDEBAR ============ */
.sidebar{width:var(--sidebar-w);min-width:var(--sidebar-w);background:var(--bg-raised);border-right:1px solid var(--border);display:flex;flex-direction:column;position:fixed;top:0;left:0;bottom:0;z-index:10;overflow-y:auto;overflow-x:hidden;}
.sb-brand{padding:20px 16px 12px;border-bottom:1px solid var(--border);}
.sb-brand h1{font-size:16px;font-weight:700;color:var(--text-bright);letter-spacing:-0.3px;}
.sb-brand .sb-sub{font-size:11px;color:var(--text-muted);margin-top:2px;}
.sb-section{padding:12px;flex:1;}
.sb-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-dim);padding:0 12px 8px;}
.sb-link{display:flex;align-items:center;gap:8px;padding:10px 12px;cursor:pointer;user-select:none;border-radius:8px;margin-bottom:8px;background:var(--bg);border:1px solid var(--border);transition:all 0.2s;text-decoration:none;color:inherit;}
.sb-link:hover{border-color:var(--border-hover);transform:translateX(2px);}
.sb-link.active{border-color:var(--cyan-dim);background:var(--cyan-bg);}
.sb-link .icon{width:24px;height:24px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0;}
.sb-link .title{font-size:12px;font-weight:600;color:var(--text-bright);flex:1;}
.sb-link .arrow{font-size:10px;color:var(--text-dim);}
.sb-footer{padding:12px;border-top:1px solid var(--border);margin-top:auto;}
.sb-user{display:flex;align-items:center;gap:10px;padding:8px 12px;}
.sb-email{font-size:11px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px;}
.sb-role{font-size:10px;color:var(--text-muted);text-transform:capitalize;}

/* ============ AVATAR FRAME SYSTEM ============ */
.av{position:relative;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;}
.av-ring{position:absolute;inset:0;border-radius:50%;z-index:0;}
.av-face{border-radius:50%;background:var(--bg-surface);color:var(--text-muted);display:flex;align-items:center;justify-content:center;font-weight:700;position:relative;z-index:1;}
/* Sizes -- 3px ring: thin + classy, glow pulses carry the animation */
.av-lg{width:42px;height:42px;}.av-lg .av-face{width:36px;height:36px;font-size:14px;}
.av-md{width:36px;height:36px;}.av-md .av-face{width:30px;height:30px;font-size:12px;}
.av-sm{width:32px;height:32px;}.av-sm .av-face{width:26px;height:26px;font-size:11px;}
/* No frame */
.av:not([class*="fr-"]) .av-ring{display:none;}
.av:not([class*="fr-"]) .av-face{width:100%;height:100%;}
/* Bronze */
.fr-bronze .av-ring{background:conic-gradient(from 0deg,#cd7f32,#e8a54b,#b8700a,#e8a54b,#cd7f32);animation:ring-spin 4s linear infinite;}
.fr-bronze .av-face{box-shadow:0 0 8px rgba(205,127,50,0.3);}
/* Silver */
.fr-silver .av-ring{background:conic-gradient(from 0deg,#e8e8e8,#888,#e8e8e8,#bbb,#e8e8e8);animation:ring-spin 5s linear infinite;}
.fr-silver .av-face{box-shadow:0 0 10px rgba(200,200,200,0.25);}
/* Neon */
.fr-neon .av-ring{background:var(--cyan);animation:neon-glow 2s ease-in-out infinite;}
.fr-neon .av-face{box-shadow:0 0 10px rgba(57,208,216,0.35);}
.fr-neon::after{content:'';position:absolute;inset:-4px;border-radius:50%;border:2px solid transparent;animation:neon-outer 2s ease-in-out infinite;pointer-events:none;}
/* Fire */
.fr-fire .av-ring{background:conic-gradient(from 0deg,#f97316,#ef4444,#fbbf24,#ef4444,#f97316);animation:ring-spin 2.5s linear infinite;}
.fr-fire .av-face{box-shadow:0 0 10px rgba(249,115,22,0.4);}
.fr-fire::after{content:'';position:absolute;inset:-3px;border-radius:50%;box-shadow:0 0 8px rgba(249,115,22,0.4),0 0 16px rgba(239,68,68,0.2);animation:fire-pulse 1.5s ease-in-out infinite;pointer-events:none;}
/* Diamond */
.fr-diamond .av-ring{background:conic-gradient(from 0deg,#a78bfa,#60a5fa,#e0e7ff,#818cf8,#a78bfa);animation:ring-spin 3s linear infinite;}
.fr-diamond .av-face{box-shadow:0 0 14px rgba(167,139,250,0.35),0 0 28px rgba(96,165,250,0.12);}
.fr-diamond::after{content:'';position:absolute;inset:-4px;border-radius:50%;box-shadow:0 0 10px rgba(167,139,250,0.3),0 0 20px rgba(96,165,250,0.15);animation:diamond-pulse 3s ease-in-out infinite;pointer-events:none;}
/* Legendary */
.fr-legendary .av-ring{background:conic-gradient(from 0deg,#f59e0b,#fbbf24,#fef3c7,#f59e0b,#d97706,#f59e0b);animation:ring-spin 2s linear infinite;}
.fr-legendary .av-face{box-shadow:0 0 16px rgba(245,158,11,0.5),0 0 32px rgba(245,158,11,0.15);}
.fr-legendary::after{content:'';position:absolute;inset:-5px;border-radius:50%;background:conic-gradient(from 90deg,transparent 50%,rgba(251,191,36,0.2) 75%,transparent 100%);box-shadow:0 0 12px rgba(251,191,36,0.3),0 0 24px rgba(251,191,36,0.1);animation:ring-spin 3s linear infinite reverse;z-index:0;pointer-events:none;}
/* Emerald */
.fr-emerald .av-ring{background:conic-gradient(from 0deg,#22c55e,#86efac,#16a34a,#86efac,#22c55e);animation:ring-spin 4s linear infinite;}
.fr-emerald .av-face{box-shadow:0 0 10px rgba(34,197,94,0.3);}
/* Frost */
.fr-frost .av-ring{background:conic-gradient(from 0deg,#7dd3fc,#e0f2fe,#38bdf8,#bae6fd,#7dd3fc);animation:ring-spin 6s linear infinite;}
.fr-frost .av-face{box-shadow:0 0 12px rgba(125,211,252,0.35);}
.fr-frost::after{content:'';position:absolute;inset:-3px;border-radius:50%;box-shadow:0 0 8px rgba(125,211,252,0.3),0 0 16px rgba(186,230,253,0.15);animation:frost-pulse 4s ease-in-out infinite;pointer-events:none;}
/* Toxic */
.fr-toxic .av-ring{background:conic-gradient(from 0deg,#84cc16,#22c55e,#a3e635,#16a34a,#84cc16);animation:ring-spin 3s linear infinite;}
.fr-toxic .av-face{box-shadow:0 0 12px rgba(132,204,22,0.45),0 0 24px rgba(132,204,22,0.15);}
.fr-toxic::after{content:'';position:absolute;inset:-4px;border-radius:50%;box-shadow:0 0 10px rgba(132,204,22,0.35),0 0 20px rgba(34,197,94,0.15);animation:toxic-pulse 2s ease-in-out infinite;pointer-events:none;}
/* Galaxy */
.fr-galaxy .av-ring{background:conic-gradient(from 0deg,#818cf8,#6366f1,#c4b5fd,#4f46e5,#a78bfa,#818cf8);animation:ring-spin 5s linear infinite;}
.fr-galaxy .av-face{box-shadow:0 0 16px rgba(129,140,248,0.4),0 0 32px rgba(99,102,241,0.12);}
.fr-galaxy::after{content:'';position:absolute;inset:-5px;border-radius:50%;background:conic-gradient(from 180deg,transparent 30%,rgba(167,139,250,0.15) 50%,transparent 70%);box-shadow:0 0 12px rgba(129,140,248,0.25),0 0 24px rgba(99,102,241,0.1);animation:ring-spin 4s linear infinite reverse;z-index:0;pointer-events:none;}

@keyframes ring-spin{to{transform:rotate(360deg);}}
@keyframes neon-glow{
  0%,100%{box-shadow:0 0 6px rgba(57,208,216,0.4);opacity:0.85;}
  50%{box-shadow:0 0 18px rgba(57,208,216,0.7),0 0 36px rgba(57,208,216,0.25);opacity:1;}
}
@keyframes neon-outer{
  0%,100%{box-shadow:0 0 4px rgba(57,208,216,0.2);}
  50%{box-shadow:0 0 14px rgba(57,208,216,0.5),0 0 28px rgba(57,208,216,0.15);}
}
@keyframes fire-pulse{
  0%,100%{opacity:0.6;transform:scale(1);}
  50%{opacity:1;transform:scale(1.05);}
}
@keyframes diamond-pulse{
  0%,100%{opacity:0.5;box-shadow:0 0 10px rgba(167,139,250,0.3),0 0 20px rgba(96,165,250,0.1);}
  50%{opacity:1;box-shadow:0 0 16px rgba(167,139,250,0.5),0 0 32px rgba(96,165,250,0.2);}
}
@keyframes frost-pulse{
  0%,100%{opacity:0.5;box-shadow:0 0 6px rgba(125,211,252,0.2);}
  50%{opacity:1;box-shadow:0 0 14px rgba(125,211,252,0.45),0 0 28px rgba(186,230,253,0.2);}
}
@keyframes toxic-pulse{
  0%,100%{opacity:0.6;box-shadow:0 0 8px rgba(132,204,22,0.25);}
  50%{opacity:1;box-shadow:0 0 16px rgba(132,204,22,0.5),0 0 30px rgba(34,197,94,0.2);}
}
@keyframes shimmer-bg{0%{background-position:0% 0%;}50%{background-position:100% 100%;}100%{background-position:0% 0%;}}

/* Plasma */
.fr-plasma .av-ring{background:conic-gradient(from 0deg,#a855f7,#7c3aed,#c084fc,#7c3aed,#a855f7);animation:ring-spin 2s linear infinite;}
.fr-plasma .av-face{box-shadow:0 0 12px rgba(168,85,247,0.4),0 0 24px rgba(168,85,247,0.1);}
/* Aurora */
.fr-aurora .av-ring{background:conic-gradient(from 0deg,#3fb950,#22d3ee,#a78bfa,#3fb950);animation:ring-spin 5s linear infinite;}
.fr-aurora .av-face{box-shadow:0 0 10px rgba(63,185,80,0.3),0 0 20px rgba(34,211,238,0.1);}
/* Obsidian */
.fr-obsidian .av-ring{background:conic-gradient(from 0deg,#1e1e2e,#4a4a5a,#1e1e2e,#6a6a7a,#1e1e2e);animation:ring-spin 6s linear infinite;}
.fr-obsidian .av-face{box-shadow:0 0 8px rgba(30,30,46,0.5),inset 0 0 4px rgba(255,255,255,0.05);}
/* Crimson */
.fr-crimson .av-ring{background:conic-gradient(from 0deg,#dc2626,#ef4444,#b91c1c,#ef4444,#dc2626);animation:ring-spin 2.5s linear infinite;}
.fr-crimson .av-face{box-shadow:0 0 12px rgba(220,38,38,0.4),0 0 24px rgba(220,38,38,0.1);}
/* Hologram */
.fr-hologram .av-ring{background:conic-gradient(from 0deg,#06b6d4,#a78bfa,#f0abfc,#06b6d4,#22d3ee);animation:ring-spin 3s linear infinite;}
.fr-hologram .av-face{box-shadow:0 0 14px rgba(6,182,212,0.35),0 0 28px rgba(167,139,250,0.15);}
/* Sakura */
.fr-sakura .av-ring{background:conic-gradient(from 0deg,#f9a8d4,#fce7f3,#f472b6,#fce7f3,#f9a8d4);animation:ring-spin 4s linear infinite;}
.fr-sakura .av-face{box-shadow:0 0 10px rgba(249,168,212,0.35);}
/* Storm */
.fr-storm .av-ring{background:conic-gradient(from 0deg,#3b82f6,#1d4ed8,#60a5fa,#93c5fd,#3b82f6);animation:ring-spin 1.5s linear infinite;}
.fr-storm .av-face{box-shadow:0 0 14px rgba(59,130,246,0.5),0 0 30px rgba(59,130,246,0.15);}
.fr-storm::after{content:'';position:absolute;inset:-3px;border-radius:50%;background:conic-gradient(from 90deg,transparent 50%,rgba(96,165,250,0.2) 75%,transparent 100%);animation:ring-spin 2s linear infinite reverse;z-index:0;pointer-events:none;}
/* Void */
.fr-void .av-ring{background:conic-gradient(from 0deg,#6d28d9,#1e1b4b,#7c3aed,#1e1b4b,#6d28d9);animation:ring-spin 4s linear infinite;}
.fr-void .av-face{box-shadow:0 0 16px rgba(109,40,217,0.5),0 0 40px rgba(109,40,217,0.15);}
.fr-void::after{content:'';position:absolute;inset:-4px;border-radius:50%;background:conic-gradient(from 180deg,transparent 30%,rgba(124,58,237,0.15) 50%,transparent 70%);animation:ring-spin 3s linear infinite reverse;z-index:0;pointer-events:none;}

/* Custom frame (dynamic inline gradient) */
.fr-custom .av-face{box-shadow:0 0 10px rgba(57,208,216,0.3);}

/* Bubble color gradient text */
.av-face-grad{-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;}
.av-face-rainbow{background-size:200% auto;animation:rainbow-scroll 3s linear infinite;}

/* Title tag */
.user-title{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--cyan);background:var(--cyan-bg);padding:1px 5px;border-radius:4px;margin-right:4px;vertical-align:middle;}

/* Broadcast toast */
.broadcast-toast{position:fixed;top:20px;right:20px;background:rgba(22,28,40,0.95);border:1px solid var(--cyan-dim);border-radius:12px;padding:14px 20px;color:var(--text-bright);font-size:13px;font-weight:600;z-index:9000;transform:translateX(120%);transition:transform 0.4s ease;backdrop-filter:blur(12px);max-width:360px;box-shadow:0 8px 32px rgba(0,0,0,0.4);}
.broadcast-toast.show{transform:translateX(0);}
.broadcast-toast .bt-icon{font-size:18px;margin-right:8px;}
.broadcast-toast .bt-msg{font-size:12px;color:var(--text-muted);margin-top:4px;font-weight:400;}

/* Flair badge */
.flair{display:inline-block;font-size:11px;margin-left:3px;animation:flair-bob 3s ease-in-out infinite;filter:drop-shadow(0 0 3px rgba(255,200,50,0.35));}
@keyframes flair-bob{0%,100%{transform:translateY(0);}50%{transform:translateY(-1.5px);}}

/* Name color (gradient text) */
.name-grad{-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;}
.name-rainbow{background-size:200% auto;animation:rainbow-scroll 3s linear infinite;}
@keyframes rainbow-scroll{to{background-position:200% center;}}

/* ============ MAIN ============ */
.main{margin-left:var(--sidebar-w);flex:1;display:flex;height:100vh;overflow:hidden;}

/* ============ CONV LIST ============ */
.conv-panel{width:320px;min-width:320px;border-right:1px solid var(--border);display:flex;flex-direction:column;background:var(--bg);}
.conv-header{padding:16px;border-bottom:1px solid var(--border);}
.conv-header h2{font-size:14px;font-weight:700;color:var(--text-bright);margin-bottom:12px;}
.btn-new{width:100%;padding:9px 12px;border:none;background:linear-gradient(135deg,rgba(57,208,216,0.15),rgba(57,208,216,0.08));color:var(--cyan);border-radius:10px;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;transition:all 0.2s;position:relative;overflow:hidden;}
.btn-new::before{content:'';position:absolute;inset:0;border-radius:10px;border:1px solid var(--cyan-dim);transition:border-color 0.2s;}
.btn-new::after{content:'';position:absolute;top:0;left:-100%;width:100%;height:100%;background:linear-gradient(90deg,transparent,rgba(57,208,216,0.08),transparent);transition:left 0.5s;}
.btn-new:hover::after{left:100%;}
.btn-new:hover{background:linear-gradient(135deg,rgba(57,208,216,0.22),rgba(57,208,216,0.12));transform:translateY(-1px);box-shadow:0 4px 16px rgba(57,208,216,0.12);}
.btn-new:active{transform:translateY(0);box-shadow:none;}
.conv-search{width:100%;padding:8px 12px;background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:12px;margin-top:10px;outline:none;transition:border-color 0.2s,box-shadow 0.2s;}
.conv-search:focus{border-color:var(--cyan-dim);box-shadow:0 0 0 3px rgba(57,208,216,0.08);}
.conv-search::placeholder{color:var(--text-dim);}
.conv-list{flex:1;overflow-y:auto;padding:6px 8px;scroll-behavior:smooth;}
.conv-item{display:flex;align-items:center;gap:10px;padding:10px 10px;border-radius:10px;cursor:pointer;border:1px solid transparent;transition:all 0.2s;margin-bottom:2px;}
.conv-item:hover{background:var(--bg-surface);border-color:var(--border);transform:translateX(2px);}
.conv-item.active{background:var(--cyan-bg);border-color:var(--cyan-dim);}
.conv-item.active .av-face{background:rgba(57,208,216,0.15);color:var(--cyan);}
.conv-info{flex:1;min-width:0;}
.conv-email{font-size:12px;font-weight:600;color:var(--text-bright);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;}
.conv-preview{font-size:11px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px;}
.conv-meta{display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;}
.conv-time{font-size:10px;color:var(--text-dim);}
.conv-unread{width:8px;height:8px;border-radius:50%;background:var(--cyan);animation:unread-pulse 2s ease-in-out infinite;box-shadow:0 0 6px rgba(57,208,216,0.5);}
@keyframes unread-pulse{0%,100%{opacity:1;transform:scale(1);}50%{opacity:0.7;transform:scale(1.2);}}
.conv-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--text-dim);font-size:13px;padding:24px;text-align:center;gap:8px;}
.conv-empty svg{opacity:0.2;animation:empty-float 4s ease-in-out infinite;}
@keyframes empty-float{0%,100%{transform:translateY(0);}50%{transform:translateY(-6px);}}

/* ============ THREAD ============ */
.thread-panel{flex:1;display:flex;flex-direction:column;background:var(--bg);}
.thread-header{padding:14px 24px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;min-height:56px;background:var(--bg-raised);}
.thread-header .th-email{font-size:13px;font-weight:600;color:var(--text-bright);display:flex;align-items:center;}
.thread-header .th-role{font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;background:var(--cyan-bg);color:var(--cyan);text-transform:capitalize;}
.thread-messages{flex:1;overflow-y:auto;padding:20px 24px;display:flex;flex-direction:column;gap:2px;scroll-behavior:smooth;}
.msg-date-sep{text-align:center;font-size:10px;color:var(--text-dim);margin:20px 0 12px;font-weight:600;letter-spacing:0.5px;position:relative;display:flex;align-items:center;gap:16px;}
.msg-date-sep::before,.msg-date-sep::after{content:'';flex:1;height:1px;background:linear-gradient(90deg,transparent,var(--border),transparent);}
.msg-row{display:flex;margin-bottom:2px;opacity:0;animation:msg-slide-in 0.35s cubic-bezier(0.22,1,0.36,1) forwards;}
.msg-row:nth-last-child(1){animation-delay:0s;}
.msg-row:nth-last-child(2){animation-delay:0.03s;}
.msg-row:nth-last-child(3){animation-delay:0.06s;}
.msg-row.sent{justify-content:flex-end;}
.msg-row.received{justify-content:flex-start;}
.msg-row .msg-wrap{max-width:65%;display:flex;flex-direction:column;}
.msg-row.sent .msg-wrap{align-items:flex-end;}
.msg-row.received .msg-wrap{align-items:flex-start;}
@keyframes msg-slide-in{
  from{opacity:0;transform:translateY(12px) scale(0.95);}
  to{opacity:1;transform:translateY(0) scale(1);}
}
.msg-bubble{padding:10px 14px;border-radius:18px;font-size:13.5px;line-height:1.5;overflow-wrap:break-word;word-wrap:break-word;white-space:pre-wrap;position:relative;}
.msg-row.sent .msg-bubble{background:linear-gradient(135deg,#2dd4bf,var(--cyan));color:#0a0e14;border-bottom-right-radius:4px;box-shadow:0 1px 6px rgba(57,208,216,0.15);}
.msg-row.received .msg-bubble{background:var(--bg-surface);color:var(--text);border:1px solid var(--border);border-bottom-left-radius:4px;box-shadow:0 1px 4px rgba(0,0,0,0.15);}
.msg-row.sent + .msg-row.sent .msg-bubble{border-top-right-radius:8px;}
.msg-row.received + .msg-row.received .msg-bubble{border-top-left-radius:8px;}
.msg-time{font-size:9px;color:var(--text-dim);margin-top:3px;padding:0 4px;opacity:0;transition:opacity 0.15s;}
.msg-row:hover .msg-time{opacity:1;}
.msg-row:last-child .msg-time{opacity:1;}
.msg-row.sent .msg-time{text-align:right;}
.thread-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--text-dim);font-size:13px;padding:24px;text-align:center;gap:8px;}
.thread-empty svg{opacity:0.15;animation:empty-float 4s ease-in-out infinite;}
.thread-input{padding:14px 24px;border-top:1px solid var(--border);display:flex;gap:10px;align-items:flex-end;background:var(--bg-raised);}
.thread-input textarea{flex:1;background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;color:var(--text);font-size:13px;padding:10px 14px;resize:none;outline:none;max-height:120px;min-height:42px;font-family:inherit;line-height:1.4;transition:border-color 0.2s,box-shadow 0.2s;}
.thread-input textarea:focus{border-color:var(--cyan-dim);box-shadow:0 0 0 3px rgba(57,208,216,0.06);}
.thread-input textarea::placeholder{color:var(--text-dim);}
.btn-send{width:42px;height:42px;border-radius:12px;background:var(--cyan);color:#0a0e14;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all 0.2s;position:relative;overflow:hidden;}
.btn-send:hover:not(:disabled){transform:scale(1.05);box-shadow:0 4px 16px rgba(57,208,216,0.3);}
.btn-send:active:not(:disabled){transform:scale(0.95);}
.btn-send:disabled{opacity:0.3;cursor:not-allowed;background:var(--bg-surface);color:var(--text-dim);}
.btn-send.pop{animation:send-pop 0.35s ease;}
@keyframes send-pop{0%{transform:scale(1);}30%{transform:scale(0.85);}60%{transform:scale(1.1);}100%{transform:scale(1);}}

/* ============ MODAL ============ */
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.55);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);z-index:100;display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity 0.2s;}
.modal-overlay.show{opacity:1;pointer-events:auto;}
.modal{background:var(--bg-raised);border:1px solid var(--border);border-radius:14px;width:380px;max-height:480px;display:flex;flex-direction:column;overflow:hidden;transform:translateY(12px) scale(0.97);transition:transform 0.25s cubic-bezier(0.34,1.56,0.64,1);box-shadow:0 24px 48px rgba(0,0,0,0.4);}
.modal-overlay.show .modal{transform:translateY(0) scale(1);}
.modal-header{padding:16px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;}
.modal-header h3{font-size:14px;font-weight:700;color:var(--text-bright);}
.modal-close{background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:18px;line-height:1;padding:4px;border-radius:6px;transition:all 0.15s;}
.modal-close:hover{background:var(--bg-surface);color:var(--text);}
.modal-search{padding:12px 16px 8px;}
.modal-search input{width:100%;padding:9px 12px;background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:12px;outline:none;transition:border-color 0.2s,box-shadow 0.2s;}
.modal-search input:focus{border-color:var(--cyan-dim);box-shadow:0 0 0 3px rgba(57,208,216,0.08);}
.modal-search input::placeholder{color:var(--text-dim);}
.modal-list{flex:1;overflow-y:auto;padding:4px 8px 8px;}
.modal-user{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;cursor:pointer;transition:all 0.15s;border:1px solid transparent;}
.modal-user:hover{background:var(--bg-surface);border-color:var(--border);transform:translateX(3px);}
.mu-info{flex:1;min-width:0;}
.mu-email{font-size:12px;color:var(--text-bright);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;}
.mu-role{font-size:10px;padding:2px 6px;border-radius:8px;background:var(--bg-surface);color:var(--text-muted);text-transform:capitalize;flex-shrink:0;}
.modal-empty{padding:24px;text-align:center;color:var(--text-dim);font-size:12px;}
</style>
</head>
<body>
<div class="layout">

  <!-- Sidebar -->
  <aside class="sidebar">
    <div class="sb-brand">
      <h1>Auto-Bot</h1>
      <div class="sb-sub">Chat</div>
    </div>
    <div class="sb-section">
      <div class="sb-label">Navigation</div>
      <a href="/chat" class="sb-link active">
        <div class="icon" style="background:var(--cyan-bg);color:var(--cyan);">${icons.messageCircle24}</div>
        <span class="title">Chat</span>
        <span class="arrow">${icons.chevronRight}</span>
      </a>
      <a href="#" class="sb-link" id="dashboard-link">
        <div class="icon" style="background:var(--bg-surface);color:var(--text-muted);">${icons.layoutDashboard}</div>
        <span class="title">Dashboard</span>
        <span class="arrow">${icons.chevronRight}</span>
      </a>
    </div>
    <div class="sb-footer">
      <div class="sb-user">
        <div id="sb-avatar-wrap"></div>
        <div>
          <div class="sb-email" id="user-email">--</div>
          <div class="sb-role" id="user-role">--</div>
        </div>
      </div>
      <div style="padding:4px 12px;">
        <div class="sb-link" id="logout-btn">
          <div class="icon" style="background:var(--red-bg);color:var(--red);">${icons.logIn}</div>
          <span class="title">Logout</span>
        </div>
      </div>
    </div>
  </aside>

  <!-- Main -->
  <div class="main">
    <!-- Conversation List -->
    <div class="conv-panel">
      <div class="conv-header">
        <h2>Messages</h2>
        <button class="btn-new" id="btn-new-msg">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" x2="12" y1="5" y2="19"/><line x1="5" x2="19" y1="12" y2="12"/></svg>
          New Message
        </button>
        <input type="text" class="conv-search" id="conv-search" placeholder="Search conversations..." />
      </div>
      <div class="conv-list" id="conv-list">
        <div class="conv-empty" id="conv-empty">
          ${icons.messageCircle24}
          <span>No conversations yet</span>
        </div>
      </div>
    </div>

    <!-- Message Thread -->
    <div class="thread-panel">
      <div class="thread-header" id="thread-header" style="display:none;">
        <div id="thread-av-wrap"></div>
        <div>
          <span class="th-email" id="thread-email"></span>
          <span class="th-role" id="thread-role" style="margin-left:6px;"></span>
        </div>
      </div>
      <div class="thread-messages" id="thread-messages">
        <div class="thread-empty" id="thread-empty">
          ${icons.messageCircle24}
          <span>Select a conversation to start messaging</span>
        </div>
      </div>
      <div class="thread-input" id="thread-input" style="display:none;">
        <textarea id="msg-input" rows="1" placeholder="Type a message..."></textarea>
        <button class="btn-send" id="btn-send" disabled>
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
        </button>
      </div>
    </div>
  </div>
</div>

<!-- New Message Modal -->
<div class="modal-overlay" id="new-msg-modal">
  <div class="modal">
    <div class="modal-header">
      <h3>New Message</h3>
      <button class="modal-close" id="modal-close">&times;</button>
    </div>
    <div class="modal-search">
      <input type="text" id="modal-search-input" placeholder="Search users..." />
    </div>
    <div class="modal-list" id="modal-user-list"></div>
  </div>
</div>

<script>
(function() {
  const ROLE_HOME = {
    admin: "/admin/dashboard",
    judge: "/judge/dashboard",
    manager: "/manager",
    reviewer: "/review/dashboard",
    user: "/agent",
  };

  const FRAME_CSS = {
    frame_bronze: "fr-bronze",
    frame_silver: "fr-silver",
    frame_emerald: "fr-emerald",
    frame_neon: "fr-neon",
    frame_fire: "fr-fire",
    frame_frost: "fr-frost",
    frame_toxic: "fr-toxic",
    frame_diamond: "fr-diamond",
    frame_galaxy: "fr-galaxy",
    frame_legendary: "fr-legendary",
    frame_plasma: "fr-plasma",
    frame_aurora: "fr-aurora",
    frame_obsidian: "fr-obsidian",
    frame_crimson: "fr-crimson",
    frame_hologram: "fr-hologram",
    frame_sakura: "fr-sakura",
    frame_storm: "fr-storm",
    frame_void: "fr-void",
  };

  let me = null;
  let activeEmail = null;
  let conversations = [];
  let allUsers = [];
  let userRoleMap = {};
  let cosmetics = {};  // email -> { frame, flair, flairIcon, nameColor, nameColorCSS, font, fontCSS, avatarIcon }

  // --- DOM refs ---
  const $ = (id) => document.getElementById(id);
  const $convList = $("conv-list");
  const $convEmpty = $("conv-empty");
  const $convSearch = $("conv-search");
  const $threadHeader = $("thread-header");
  const $threadEmail = $("thread-email");
  const $threadRole = $("thread-role");
  const $threadAvWrap = $("thread-av-wrap");
  const $threadMessages = $("thread-messages");
  const $threadEmpty = $("thread-empty");
  const $threadInput = $("thread-input");
  const $msgInput = $("msg-input");
  const $btnSend = $("btn-send");
  const $btnNewMsg = $("btn-new-msg");
  const $modal = $("new-msg-modal");
  const $modalClose = $("modal-close");
  const $modalSearch = $("modal-search-input");
  const $modalUserList = $("modal-user-list");

  // --- Helpers ---
  function initial(email) {
    return (email || "?")[0].toUpperCase();
  }

  function relTime(ts) {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "now";
    if (mins < 60) return mins + "m";
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + "h";
    const days = Math.floor(hrs / 24);
    if (days < 7) return days + "d";
    return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function dateLabel(ts) {
    const d = new Date(ts);
    const today = new Date();
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  }

  function timeStr(ts) {
    return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  // --- Avatar HTML builder ---
  function avatarHtml(email, size) {
    const c = cosmetics[email] || {};
    const frameClass = c.frame ? (FRAME_CSS[c.frame] || "") : "";
    const sizeClass = size === "lg" ? "av-lg" : size === "sm" ? "av-sm" : "av-md";
    const face = c.avatarIcon || initial(email);
    const faceStyles = [];
    if (c.bubbleFontCSS) faceStyles.push("font-family:" + c.bubbleFontCSS);
    let faceCls = "av-face";
    const bcs = c.bubbleColorCSS || "";
    if (bcs) {
      if (bcs.startsWith("linear-gradient")) {
        faceStyles.push("background-image:" + bcs);
        faceCls += " av-face-grad";
        if (c.bubbleColor === "bcolor_rainbow" || c.bubbleColor === "bcolor_prismatic") faceCls += " av-face-rainbow";
      } else if (bcs.startsWith("#")) {
        faceStyles.push("color:" + bcs);
      }
    }
    const faceStyle = faceStyles.length ? ' style="' + faceStyles.join(";") + '"' : '';
    // Custom frame fallback: if frame has no CSS class but frameColor exists, apply inline conic-gradient
    let ringStyle = "";
    const isCustomFrame = c.frame && !FRAME_CSS[c.frame] && c.frameColor;
    if (isCustomFrame) {
      ringStyle = ' style="background:conic-gradient(from 0deg,' + c.frameColor + ',#fff,' + c.frameColor + ');animation:ring-spin 4s linear infinite;"';
    }
    const customFrameClass = isCustomFrame ? "fr-custom" : "";
    return '<div class="av ' + sizeClass + ' ' + frameClass + ' ' + customFrameClass + '">'
      + '<div class="av-ring"' + ringStyle + '></div>'
      + '<div class="' + faceCls + '"' + faceStyle + '>' + face + '</div>'
      + '</div>';
  }

  // --- Name HTML with title + color + flair + font ---
  function nameHtml(email, extraClass) {
    const c = cosmetics[email] || {};
    const styles = [];
    let cls = extraClass || "";
    const css = c.nameColorCSS || "";
    if (css) {
      if (css.startsWith("linear-gradient")) {
        styles.push("background-image:" + css);
        cls += " name-grad";
        if (c.nameColor === "color_rainbow" || c.nameColor === "color_prismatic") cls += " name-rainbow";
      } else if (css.startsWith("#")) {
        styles.push("color:" + css);
      }
    }
    if (c.fontCSS) styles.push("font-family:" + c.fontCSS);
    const nameStyle = styles.length ? ' style="' + styles.join(";") + ';"' : "";
    let out = '';
    if (c.titleLabel) {
      out += '<span class="user-title">' + esc(c.titleLabel) + '</span>';
    }
    out += '<span class="' + cls.trim() + '"' + nameStyle + '>' + esc(email) + '</span>';
    if (c.flairIcon) {
      out += '<span class="flair">' + c.flairIcon + '</span>';
    }
    return out;
  }

  // --- Render conversation list ---
  function renderConversations(filter) {
    const q = (filter || "").toLowerCase();
    const filtered = q ? conversations.filter(c => c.email.toLowerCase().includes(q)) : conversations;

    if (filtered.length === 0) {
      $convEmpty.style.display = "";
      $convEmpty.querySelector("span").textContent = q ? "No matches" : "No conversations yet";
      $convList.querySelectorAll(".conv-item").forEach(el => el.remove());
      return;
    }
    $convEmpty.style.display = "none";

    let html = "";
    for (const c of filtered) {
      const isActive = c.email === activeEmail;
      html += '<div class="conv-item' + (isActive ? " active" : "") + '" data-email="' + esc(c.email) + '">'
        + avatarHtml(c.email, "lg")
        + '<div class="conv-info">'
        + '<div class="conv-email">' + nameHtml(c.email) + '</div>'
        + '<div class="conv-preview">' + esc(c.lastMessage?.body || "") + '</div>'
        + '</div>'
        + '<div class="conv-meta">'
        + '<div class="conv-time">' + (c.lastMessage ? relTime(c.lastMessage.ts) : "") + '</div>'
        + (c.unread > 0 ? '<div class="conv-unread"></div>' : '')
        + '</div>'
        + '</div>';
    }
    $convList.querySelectorAll(".conv-item").forEach(el => el.remove());
    $convList.insertAdjacentHTML("beforeend", html);

    $convList.querySelectorAll(".conv-item").forEach(el => {
      el.addEventListener("click", () => openConversation(el.dataset.email));
    });
  }

  // --- Render messages ---
  function renderMessages(messages) {
    if (!messages || messages.length === 0) {
      $threadMessages.innerHTML = '<div class="thread-empty">${icons.messageCircle24}<span>No messages yet. Say hello!</span></div>';
      return;
    }

    const sorted = [...messages].sort((a, b) => a.ts - b.ts);
    let html = "";
    let lastDate = "";

    for (const m of sorted) {
      const dl = dateLabel(m.ts);
      if (dl !== lastDate) {
        lastDate = dl;
        html += '<div class="msg-date-sep">' + esc(dl) + '</div>';
      }
      const isSent = m.from === me.username;
      html += '<div class="msg-row ' + (isSent ? "sent" : "received") + '">'
        + '<div class="msg-wrap"><div class="msg-bubble">' + esc(m.body) + '</div>'
        + '<div class="msg-time">' + timeStr(m.ts) + '</div></div>'
        + '</div>';
    }
    $threadMessages.innerHTML = html;
    $threadMessages.scrollTop = $threadMessages.scrollHeight;
  }

  // --- Open conversation ---
  async function openConversation(email) {
    activeEmail = email;
    $threadHeader.style.display = "";
    $threadInput.style.display = "";
    $threadEmpty.style.display = "none";

    // Render header avatar + name
    $threadAvWrap.innerHTML = avatarHtml(email, "md");
    $threadEmail.innerHTML = nameHtml(email, "th-email");
    const role = userRoleMap[email] || "";
    $threadRole.textContent = role;
    $threadRole.style.display = role ? "" : "none";

    renderConversations($convSearch.value);

    try {
      const res = await fetch("/api/messages/" + encodeURIComponent(email));
      if (!res.ok) throw new Error("Failed to load messages");
      const msgs = await res.json();
      renderMessages(msgs);

      const conv = conversations.find(c => c.email === email);
      if (conv) { conv.unread = 0; renderConversations($convSearch.value); }
    } catch (err) {
      console.error("Failed to load conversation:", err);
      $threadMessages.innerHTML = '<div class="thread-empty">Failed to load messages</div>';
    }

    $msgInput.focus();
  }

  // --- Send message ---
  async function sendMsg() {
    const body = $msgInput.value.trim();
    if (!body || !activeEmail) return;

    $msgInput.value = "";
    $msgInput.style.height = "auto";
    $btnSend.disabled = true;

    // Pop animation on send button
    $btnSend.classList.add("pop");
    setTimeout(() => $btnSend.classList.remove("pop"), 350);

    const now = Date.now();
    const msgHtml = '<div class="msg-row sent"><div class="msg-wrap"><div class="msg-bubble">' + esc(body) + '</div>'
      + '<div class="msg-time">' + timeStr(now) + '</div></div></div>';

    const empty = $threadMessages.querySelector(".thread-empty");
    if (empty) empty.remove();

    const lastSep = $threadMessages.querySelector(".msg-date-sep:last-of-type");
    const todayLabel = dateLabel(now);
    if (!lastSep || lastSep.textContent !== todayLabel) {
      $threadMessages.insertAdjacentHTML("beforeend", '<div class="msg-date-sep">' + esc(todayLabel) + '</div>');
    }

    $threadMessages.insertAdjacentHTML("beforeend", msgHtml);
    $threadMessages.scrollTop = $threadMessages.scrollHeight;

    const existing = conversations.find(c => c.email === activeEmail);
    if (existing) {
      existing.lastMessage = { body, ts: now, from: me.username };
    } else {
      conversations.unshift({ email: activeEmail, lastMessage: { body, ts: now, from: me.username }, unread: 0 });
    }
    conversations.sort((a, b) => (b.lastMessage?.ts || 0) - (a.lastMessage?.ts || 0));
    renderConversations($convSearch.value);

    try {
      await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: activeEmail, body }),
      });
    } catch (err) {
      console.error("Failed to send:", err);
    }
  }

  // --- SSE ---
  function connectSSE() {
    const es = new EventSource("/api/events");
    es.addEventListener("message-received", (e) => {
      try {
        const data = JSON.parse(e.data);
        const fromEmail = data.from;
        const preview = data.preview || "";

        const conv = conversations.find(c => c.email === fromEmail);
        if (conv) {
          conv.lastMessage = { body: preview, ts: Date.now(), from: fromEmail };
          if (fromEmail !== activeEmail) conv.unread = (conv.unread || 0) + 1;
        } else {
          conversations.unshift({
            email: fromEmail,
            lastMessage: { body: preview, ts: Date.now(), from: fromEmail },
            unread: fromEmail === activeEmail ? 0 : 1,
          });
        }
        conversations.sort((a, b) => (b.lastMessage?.ts || 0) - (a.lastMessage?.ts || 0));
        renderConversations($convSearch.value);

        if (fromEmail === activeEmail) {
          const now = Date.now();
          const lastSep = $threadMessages.querySelector(".msg-date-sep:last-of-type");
          const todayLabel = dateLabel(now);
          if (!lastSep || lastSep.textContent !== todayLabel) {
            $threadMessages.insertAdjacentHTML("beforeend", '<div class="msg-date-sep">' + esc(todayLabel) + '</div>');
          }
          const msgHtml = '<div class="msg-row received"><div class="msg-wrap"><div class="msg-bubble">' + esc(preview) + '</div>'
            + '<div class="msg-time">' + timeStr(now) + '</div></div></div>';
          const empty = $threadMessages.querySelector(".thread-empty");
          if (empty) empty.remove();
          $threadMessages.insertAdjacentHTML("beforeend", msgHtml);
          $threadMessages.scrollTop = $threadMessages.scrollHeight;

          fetch("/api/messages/" + encodeURIComponent(fromEmail)).catch(() => {});
        }
      } catch { /* ignore parse errors */ }
    });
    // Broadcast events
    es.addEventListener("prefab-broadcast", (e) => {
      if (window.__TAURI__) return; // bridge.js handles broadcasts in Tauri overlay
      try {
        const data = JSON.parse(e.data);
        showBroadcastToast(data);
        if (data.animationId) playAnimation(data.animationId);
      } catch { /* ignore */ }
    });

    es.onerror = () => {
      es.close();
      setTimeout(connectSSE, 5000);
    };
  }

  // --- Broadcast Toast ---
  function showBroadcastToast(data) {
    let el = document.getElementById("broadcast-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "broadcast-toast";
      el.className = "broadcast-toast";
      document.body.appendChild(el);
    }
    el.innerHTML = '<span class="bt-icon">' + (data.type === "perfect_score" ? "\\u{1F4AF}" : data.type === "level_up" ? "\\u{2B06}" : data.type === "badge_earned" ? "\\u{1F3C5}" : data.type === "queue_cleared" ? "\\u{1F5E1}" : "\\u{1F514}") + '</span>'
      + '<span>' + esc(data.message || (data.displayName + " triggered " + data.type)) + '</span>';
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 5000);
  }

  // --- Animation Player ---
  function playAnimation(animId) {
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;z-index:8000;pointer-events:none;";
    document.body.appendChild(canvas);
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    let frame = 0;
    const maxFrames = 120;

    const ANIM_MAP = {
      anim_sparkle: drawSparkle,
      anim_confetti: drawConfetti,
      anim_petals: drawPetals,
      anim_fireworks: drawFireworks,
      anim_matrix: drawMatrix,
      anim_lightning: drawLightning,
      anim_snowfall: drawSnowfall,
      anim_shockwave: drawShockwave,
      anim_nova: drawNova,
    };

    const particles = [];
    const drawFn = ANIM_MAP[animId] || drawConfetti;
    initParticles(animId, particles, w, h);

    function tick() {
      if (frame >= maxFrames) { canvas.remove(); return; }
      ctx.clearRect(0, 0, w, h);
      drawFn(ctx, particles, frame, w, h);
      frame++;
      requestAnimationFrame(tick);
    }
    tick();
  }

  function initParticles(animId, particles, w, h) {
    const count = animId === "anim_matrix" ? 60 : animId === "anim_snowfall" ? 80 : 50;
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * w, y: animId === "anim_snowfall" ? -Math.random() * h : Math.random() * h,
        vx: (Math.random() - 0.5) * 4, vy: -Math.random() * 6 - 2,
        size: Math.random() * 6 + 2,
        color: "hsl(" + Math.floor(Math.random() * 360) + ",80%,65%)",
        alpha: 1, char: String.fromCharCode(0x30A0 + Math.random() * 96),
        angle: Math.random() * Math.PI * 2,
      });
    }
  }

  function drawSparkle(ctx, particles, frame) {
    const fade = Math.max(0, 1 - frame / 120);
    particles.forEach(p => {
      p.y += p.vy * 0.5;
      p.alpha = fade * (0.5 + 0.5 * Math.sin(frame * 0.2 + p.x));
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = "#fbbf24";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 0.5, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function drawConfetti(ctx, particles, frame) {
    const fade = Math.max(0, 1 - frame / 120);
    particles.forEach(p => {
      p.x += p.vx;
      p.y += (p.vy += 0.15);
      p.angle += 0.1;
      ctx.globalAlpha = fade;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size, -p.size * 0.4, p.size * 2, p.size * 0.8);
      ctx.restore();
    });
    ctx.globalAlpha = 1;
  }

  function drawPetals(ctx, particles, frame) {
    const fade = Math.max(0, 1 - frame / 120);
    particles.forEach(p => {
      p.x += Math.sin(frame * 0.02 + p.vx) * 1.5;
      p.y += 1.5;
      p.angle += 0.03;
      ctx.globalAlpha = fade * 0.8;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = "rgba(244,114,182," + fade + ")";
      ctx.beginPath();
      ctx.ellipse(0, 0, p.size, p.size * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
    ctx.globalAlpha = 1;
  }

  function drawFireworks(ctx, particles, frame, w, h) {
    if (frame < 30) {
      const cx = w / 2, cy = h / 2;
      particles.forEach((p, i) => {
        const angle = (i / particles.length) * Math.PI * 2;
        const dist = frame * 8;
        p.x = cx + Math.cos(angle) * dist;
        p.y = cy + Math.sin(angle) * dist;
        ctx.globalAlpha = Math.max(0, 1 - frame / 30);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    ctx.globalAlpha = 1;
  }

  function drawMatrix(ctx, particles, frame, w, h) {
    ctx.fillStyle = "rgba(0,0,0,0.05)";
    ctx.fillRect(0, 0, w, h);
    const fade = Math.max(0, 1 - frame / 120);
    ctx.globalAlpha = fade;
    ctx.font = "14px monospace";
    ctx.fillStyle = "#3fb950";
    particles.forEach(p => {
      p.y += 4;
      if (p.y > h) { p.y = 0; p.x = Math.random() * w; }
      ctx.fillText(p.char, p.x, p.y);
      if (Math.random() < 0.05) p.char = String.fromCharCode(0x30A0 + Math.random() * 96);
    });
    ctx.globalAlpha = 1;
  }

  function drawLightning(ctx, particles, frame, w, h) {
    if (frame % 8 !== 0 || frame > 60) return;
    ctx.strokeStyle = "rgba(96,165,250," + Math.max(0, 1 - frame / 60) + ")";
    ctx.lineWidth = 3;
    ctx.beginPath();
    let x = Math.random() * w, y = 0;
    ctx.moveTo(x, y);
    while (y < h) {
      x += (Math.random() - 0.5) * 80;
      y += 20 + Math.random() * 40;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function drawSnowfall(ctx, particles, frame) {
    const fade = Math.max(0, 1 - frame / 120);
    particles.forEach(p => {
      p.x += Math.sin(frame * 0.01 + p.vx) * 0.5;
      p.y += 1.2;
      ctx.globalAlpha = fade * 0.7;
      ctx.fillStyle = "#e0f2fe";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 0.4, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function drawShockwave(ctx, particles, frame, w, h) {
    const cx = w / 2, cy = h / 2;
    const radius = frame * 12;
    const fade = Math.max(0, 1 - frame / 60);
    ctx.globalAlpha = fade;
    ctx.strokeStyle = "rgba(168,85,247," + fade + ")";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawNova(ctx, particles, frame, w, h) {
    const cx = w / 2, cy = h / 2;
    const t = frame / 120;
    const radius = t * Math.max(w, h) * 0.6;
    const fade = Math.max(0, 1 - t);
    ctx.globalAlpha = fade * 0.3;
    ctx.fillStyle = "#fbbf24";
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = fade;
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 2;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + frame * 0.05;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * radius * 0.3, cy + Math.sin(a) * radius * 0.3);
      ctx.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // --- New Message Modal ---
  function openModal() {
    $modal.classList.add("show");
    $modalSearch.value = "";
    renderModalUsers("");
    setTimeout(() => $modalSearch.focus(), 100);
  }

  function closeModal() {
    $modal.classList.remove("show");
  }

  function renderModalUsers(filter) {
    const q = (filter || "").toLowerCase();
    const filtered = q ? allUsers.filter(u => u.email.toLowerCase().includes(q)) : allUsers;

    if (filtered.length === 0) {
      $modalUserList.innerHTML = '<div class="modal-empty">No users found</div>';
      return;
    }

    let html = "";
    for (const u of filtered) {
      html += '<div class="modal-user" data-email="' + esc(u.email) + '">'
        + avatarHtml(u.email, "sm")
        + '<div class="mu-info">'
        + '<div class="mu-email">' + nameHtml(u.email) + '</div>'
        + '</div>'
        + '<div class="mu-role">' + esc(u.role) + '</div>'
        + '</div>';
    }
    $modalUserList.innerHTML = html;
    $modalUserList.querySelectorAll(".modal-user").forEach(el => {
      el.addEventListener("click", () => {
        closeModal();
        openConversation(el.dataset.email);
      });
    });
  }

  // --- Event listeners ---
  $btnNewMsg.addEventListener("click", openModal);
  $modalClose.addEventListener("click", closeModal);
  $modal.addEventListener("click", (e) => { if (e.target === $modal) closeModal(); });
  $modalSearch.addEventListener("input", () => renderModalUsers($modalSearch.value));
  $convSearch.addEventListener("input", () => renderConversations($convSearch.value));

  $msgInput.addEventListener("input", () => {
    $btnSend.disabled = !$msgInput.value.trim();
    $msgInput.style.height = "auto";
    $msgInput.style.height = Math.min($msgInput.scrollHeight, 120) + "px";
  });
  $msgInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMsg(); }
  });
  $btnSend.addEventListener("click", sendMsg);

  $("logout-btn").addEventListener("click", async () => {
    await fetch("/logout", { method: "POST" });
    location.href = "/login";
  });

  // Escape closes modal
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $modal.classList.contains("show")) closeModal();
  });

  // --- Load ---
  async function load() {
    try {
      const [meRes, convsRes, usersRes, cosRes] = await Promise.all([
        fetch("/chat/api/me"),
        fetch("/api/messages/conversations"),
        fetch("/api/users"),
        fetch("/chat/api/cosmetics"),
      ]);

      if (!meRes.ok) { location.href = "/login"; return; }

      me = await meRes.json();
      conversations = await convsRes.json();
      allUsers = await usersRes.json();
      cosmetics = cosRes.ok ? await cosRes.json() : {};

      for (const u of allUsers) userRoleMap[u.email] = u.role;

      // Sidebar avatar with frame
      $("sb-avatar-wrap").innerHTML = avatarHtml(me.username, "sm");
      $("user-email").textContent = me.username;
      $("user-role").textContent = me.role;

      const dashLink = ROLE_HOME[me.role] || "/";
      $("dashboard-link").href = dashLink;

      conversations.sort((a, b) => (b.lastMessage?.ts || 0) - (a.lastMessage?.ts || 0));
      renderConversations("");

      connectSSE();
    } catch (err) {
      console.error("Failed to load:", err);
    }
  }

  load();
})();
</script>
</body>
</html>`;
}
