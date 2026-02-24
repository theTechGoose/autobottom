/**
 * Auto-Bot Overlay Bridge
 *
 * Connects to the SSE /api/events endpoint and bridges events
 * to Tauri's native notification system + in-overlay toasts.
 *
 * This script is injected into the webview via a Tauri initialization script,
 * or loaded by including a <script> tag in the served HTML.
 */

(function () {
  // Only run inside Tauri
  if (!window.__TAURI__) return;

  const { sendNotification, isPermissionGranted, requestPermission } =
    window.__TAURI__.notification;

  let eventSource = null;
  let retryTimer = null;
  let unreadCount = 0;

  const EVENT_LABELS = {
    "audit-completed": "Audit Completed",
    "review-decided": "Review Decision",
    "appeal-decided": "Appeal Decision",
    "remediation-submitted": "Remediation Submitted",
    "message-received": "New Message",
  };

  const BROADCAST_ICONS = {
    sale_completed: "\uD83D\uDCB0",
    perfect_score: "\uD83D\uDCAF",
    ten_audits_day: "\uD83D\uDD25",
    level_up: "\u2B06\uFE0F",
    badge_earned: "\uD83C\uDFC5",
    streak_milestone: "\uD83D\uDD25",
    queue_cleared: "\uD83D\uDDE1\uFE0F",
    weekly_accuracy_100: "\uD83C\uDFAF",
  };

  async function ensurePermission() {
    let granted = await isPermissionGranted();
    if (!granted) {
      const result = await requestPermission();
      granted = result === "granted";
    }
    return granted;
  }

  function notify(title, body) {
    ensurePermission().then((ok) => {
      if (ok) sendNotification({ title, body });
    });
  }

  // -- Overlay toast (top-right, always visible in webview) --
  let toastContainer = null;

  function ensureToastContainer() {
    if (toastContainer && document.body.contains(toastContainer)) return;
    toastContainer = document.createElement("div");
    toastContainer.id = "bridge-toast-stack";
    toastContainer.style.cssText =
      "position:fixed;top:16px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;";
    document.body.appendChild(toastContainer);
  }

  function showOverlayToast(icon, message, hasAnimation) {
    ensureToastContainer();
    const el = document.createElement("div");
    el.style.cssText =
      "pointer-events:auto;display:flex;align-items:center;gap:10px;" +
      "padding:12px 18px;background:rgba(18,22,30,0.95);" +
      "border:1px solid rgba(139,92,246,0.35);border-radius:12px;" +
      "color:#e6edf3;font-size:13px;font-weight:600;max-width:340px;" +
      "backdrop-filter:blur(12px);box-shadow:0 8px 32px rgba(0,0,0,0.5);" +
      "transform:translateX(120%);transition:transform 0.35s cubic-bezier(0.22,1,0.36,1);";
    el.innerHTML =
      '<span style="font-size:20px;flex-shrink:0;">' + icon + "</span>" +
      '<span style="line-height:1.4;">' + escapeHtml(message) + "</span>";
    toastContainer.appendChild(el);
    // Slide in
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.style.transform = "translateX(0)";
      });
    });
    // Auto dismiss
    setTimeout(() => {
      el.style.transform = "translateX(120%)";
      setTimeout(() => el.remove(), 400);
    }, 5000);
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  // -- Canvas animation player --
  function playBroadcastAnimation(animId) {
    // Skip if the page already has its own animation player
    if (document.querySelector("canvas[data-bridge-anim]")) return;
    const canvas = document.createElement("canvas");
    canvas.setAttribute("data-bridge-anim", "1");
    canvas.style.cssText =
      "position:fixed;inset:0;width:100%;height:100%;z-index:9998;pointer-events:none;";
    document.body.appendChild(canvas);
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext("2d");
    const particles = [];
    const count = 60;
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: -10 - Math.random() * canvas.height * 0.3,
        vx: (Math.random() - 0.5) * 4,
        vy: Math.random() * 4 + 2,
        size: Math.random() * 7 + 3,
        color: "hsl(" + Math.floor(Math.random() * 360) + ",80%,65%)",
        angle: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 0.15,
      });
    }
    let frame = 0;
    function tick() {
      if (frame >= 120) {
        canvas.remove();
        return;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const fade = Math.max(0, 1 - frame / 120);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.08;
        p.angle += p.spin;
        ctx.globalAlpha = fade;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size, -p.size * 0.4, p.size * 2, p.size * 0.8);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      frame++;
      requestAnimationFrame(tick);
    }
    tick();
  }

  function connect() {
    if (eventSource) {
      eventSource.close();
    }

    eventSource = new EventSource("/api/events");

    eventSource.addEventListener("connected", () => {
      console.log("[overlay-bridge] SSE connected");
    });

    // -- Personal events -> native notifications --

    eventSource.addEventListener("audit-completed", (e) => {
      const data = JSON.parse(e.data);
      notify(
        "Audit Completed",
        `Score: ${data.payload.score}% - ${data.payload.findingId.slice(0, 8)}`
      );
    });

    eventSource.addEventListener("review-decided", (e) => {
      const data = JSON.parse(e.data);
      notify(
        "Review Decision",
        `Finding ${data.payload.findingId.slice(0, 8)} reviewed`
      );
    });

    eventSource.addEventListener("appeal-decided", (e) => {
      const data = JSON.parse(e.data);
      notify(
        "Appeal Decided",
        `Finding ${data.payload.findingId.slice(0, 8)} judged`
      );
    });

    eventSource.addEventListener("remediation-submitted", (e) => {
      const data = JSON.parse(e.data);
      notify(
        "Remediation Submitted",
        `Finding ${data.payload.findingId.slice(0, 8)} remediated`
      );
    });

    eventSource.addEventListener("message-received", (e) => {
      const data = JSON.parse(e.data);
      unreadCount++;
      notify(
        `Message from ${data.payload.from}`,
        data.payload.preview || "New message"
      );
    });

    // -- Broadcast events -> native notification + overlay toast + animation --

    eventSource.addEventListener("prefab-broadcast", (e) => {
      try {
        const data = JSON.parse(e.data);
        const icon = BROADCAST_ICONS[data.type] || "\uD83D\uDD14";
        const message = data.message || data.displayName + " triggered " + data.type;

        // Native OS push notification (shows even when overlay is hidden)
        const label = (data.type || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        notify(label || "Broadcast", message);

        // In-overlay toast (top-right corner of the webview)
        showOverlayToast(icon, message, !!data.animationId);

        // Play animation if the triggering user has one configured
        if (data.animationId) {
          playBroadcastAnimation(data.animationId);
        }
      } catch (err) {
        console.error("[overlay-bridge] Broadcast parse error:", err);
      }
    });

    eventSource.onerror = () => {
      console.warn("[overlay-bridge] SSE error, reconnecting in 5s...");
      eventSource.close();
      retryTimer = setTimeout(connect, 5000);
    };
  }

  // Start SSE connection after a short delay to let the page load
  setTimeout(connect, 2000);

  // Clean up on page unload
  window.addEventListener("beforeunload", () => {
    if (eventSource) eventSource.close();
    if (retryTimer) clearTimeout(retryTimer);
  });
})();
