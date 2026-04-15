/** 280px fixed sidebar — role-aware navigation links. */
import type { User, Role } from "../lib/auth.ts";

interface SidebarProps {
  user: User;
  section: string;
}

interface NavLink {
  href: string;
  label: string;
  icon: string;
}

const NAV: Record<Role, NavLink[]> = {
  admin: [
    { href: "/admin/dashboard", label: "Dashboard", icon: "layout-dashboard" },
    { href: "/admin/users", label: "Users", icon: "users" },
    { href: "/admin/audits", label: "Audits", icon: "file-text" },
    { href: "/admin/weekly-builder", label: "Weekly Builder", icon: "mail" },
    { href: "/question-lab", label: "Question Lab", icon: "flask" },
    { href: "/store", label: "Badge Store", icon: "trophy" },
    { href: "/chat", label: "Chat", icon: "message" },
  ],
  reviewer: [
    { href: "/review", label: "Review Queue", icon: "play-circle" },
    { href: "/review/dashboard", label: "Dashboard", icon: "layout-dashboard" },
    { href: "/store", label: "Store", icon: "trophy" },
    { href: "/chat", label: "Chat", icon: "message" },
  ],
  judge: [
    { href: "/judge", label: "Judge Queue", icon: "scale" },
    { href: "/judge/dashboard", label: "Dashboard", icon: "layout-dashboard" },
    { href: "/store", label: "Store", icon: "trophy" },
    { href: "/chat", label: "Chat", icon: "message" },
  ],
  manager: [
    { href: "/manager", label: "Queue", icon: "clipboard-list" },
    { href: "/store", label: "Store", icon: "trophy" },
    { href: "/chat", label: "Chat", icon: "message" },
  ],
  user: [
    { href: "/agent", label: "Dashboard", icon: "bar-chart" },
    { href: "/store", label: "Store", icon: "trophy" },
    { href: "/chat", label: "Chat", icon: "message" },
  ],
};

export function Sidebar({ user, section }: SidebarProps) {
  const links = NAV[user.role] ?? NAV.user;
  const initials = user.email.slice(0, 2).toUpperCase();

  return (
    <aside class="sidebar">
      <div class="sb-brand">
        <h1>Auto-Bot</h1>
        <div class="sb-status">
          <span class="dot"></span>
          <span>Operational</span>
        </div>
      </div>

      <nav class="sb-nav">
        <div class="sb-section">
          <div class="sb-label">Navigation</div>
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              class={`sb-nav-link ${section && link.href.includes(section) ? "active" : ""}`}
            >
              <span class="sb-nav-icon">{link.icon === "layout-dashboard" ? "📊" : link.icon === "users" ? "👥" : link.icon === "file-text" ? "📄" : link.icon === "mail" ? "📧" : link.icon === "flask" ? "🧪" : link.icon === "trophy" ? "🏆" : link.icon === "message" ? "💬" : link.icon === "play-circle" ? "▶️" : link.icon === "scale" ? "⚖️" : link.icon === "clipboard-list" ? "📋" : link.icon === "bar-chart" ? "📈" : "•"}</span>
              <span>{link.label}</span>
            </a>
          ))}
        </div>
      </nav>

      <div class="sb-footer">
        <div class="sb-user">
          <div class="sb-avatar">{initials}</div>
          <div>
            <div class="sb-email">{user.email}</div>
            <div class="sb-role">{user.role}</div>
          </div>
        </div>
        <div class="sb-settings">
          <a href="/api/logout" class="sb-logout-btn">Sign Out</a>
        </div>
      </div>
    </aside>
  );
}
