/** 280px fixed sidebar — role-aware navigation with section groupings matching production. */
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

interface NavSection {
  label: string;
  links: NavLink[];
}

const ICON_MAP: Record<string, string> = {
  "chat": "💬", "flask": "🧪", "webhook": "⚡", "mail": "📧",
  "clipboard-list": "📋", "trash": "🗑️", "alert-triangle": "⚠️",
  "users": "👥", "settings": "⚙️", "trophy": "🏆", "shopping-bag": "🛍️",
  "scale": "⚖️", "play-circle": "▶️", "bar-chart": "📈",
  "layout-dashboard": "📊", "file-text": "📄", "user-cog": "👤",
  "log-out": "🚪",
};

function icon(name: string): string {
  return ICON_MAP[name] ?? "•";
}

const ADMIN_SECTIONS: NavSection[] = [
  {
    label: "Navigation",
    links: [
      { href: "/chat", label: "Chat", icon: "chat" },
    ],
  },
  {
    label: "Configuration",
    links: [
      { href: "/question-lab", label: "Question Lab", icon: "flask" },
      { href: "/admin/users", label: "Users", icon: "users" },
      { href: "/admin/audits", label: "Audits", icon: "file-text" },
      { href: "/admin/weekly-builder", label: "Weekly Builder", icon: "mail" },
      { href: "/admin/dashboard", label: "Pipeline", icon: "settings" },
      { href: "/store", label: "Badge Store", icon: "shopping-bag" },
    ],
  },
  {
    label: "Impersonate",
    links: [
      { href: "/judge/dashboard", label: "Judge Dashboard", icon: "scale" },
      { href: "/review/dashboard", label: "Review Dashboard", icon: "play-circle" },
      { href: "/manager", label: "Manager Portal", icon: "clipboard-list" },
      { href: "/agent", label: "Agent Dashboard", icon: "bar-chart" },
    ],
  },
];

const REVIEWER_SECTIONS: NavSection[] = [
  {
    label: "Navigation",
    links: [
      { href: "/review", label: "Review Queue", icon: "play-circle" },
      { href: "/review/dashboard", label: "Dashboard", icon: "layout-dashboard" },
      { href: "/store", label: "Store", icon: "trophy" },
      { href: "/chat", label: "Chat", icon: "chat" },
    ],
  },
];

const JUDGE_SECTIONS: NavSection[] = [
  {
    label: "Navigation",
    links: [
      { href: "/judge", label: "Judge Queue", icon: "scale" },
      { href: "/judge/dashboard", label: "Dashboard", icon: "layout-dashboard" },
      { href: "/store", label: "Store", icon: "trophy" },
      { href: "/chat", label: "Chat", icon: "chat" },
    ],
  },
];

const MANAGER_SECTIONS: NavSection[] = [
  {
    label: "Navigation",
    links: [
      { href: "/manager", label: "Queue", icon: "clipboard-list" },
      { href: "/store", label: "Store", icon: "trophy" },
      { href: "/chat", label: "Chat", icon: "chat" },
    ],
  },
];

const USER_SECTIONS: NavSection[] = [
  {
    label: "Navigation",
    links: [
      { href: "/agent", label: "Dashboard", icon: "bar-chart" },
      { href: "/store", label: "Store", icon: "trophy" },
      { href: "/chat", label: "Chat", icon: "chat" },
    ],
  },
];

const ROLE_SECTIONS: Record<Role, NavSection[]> = {
  admin: ADMIN_SECTIONS,
  reviewer: REVIEWER_SECTIONS,
  judge: JUDGE_SECTIONS,
  manager: MANAGER_SECTIONS,
  user: USER_SECTIONS,
};

export function Sidebar({ user, section }: SidebarProps) {
  const sections = ROLE_SECTIONS[user.role] ?? USER_SECTIONS;
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
        {sections.map((sec) => (
          <div key={sec.label} class="sb-section">
            <div class="sb-label">{sec.label}</div>
            {sec.links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                class={`sb-nav-link ${section && link.href.includes(section) ? "active" : ""}`}
              >
                <span class="sb-nav-icon">{icon(link.icon)}</span>
                <span>{link.label}</span>
                <span class="sb-nav-arrow">›</span>
              </a>
            ))}
          </div>
        ))}
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
          <a href="/api/logout" class="sb-logout-btn">🚪 Sign Out</a>
        </div>
      </div>
    </aside>
  );
}
