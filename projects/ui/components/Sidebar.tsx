interface SidebarLink {
  href: string;
  label: string;
  iconColor: string;
}

interface SidebarProps {
  role: string;
  active?: string;
}

const adminLinks: SidebarLink[] = [
  { href: "/admin/dashboard", label: "Dashboard", iconColor: "var(--blue-bg)" },
  { href: "/admin/users", label: "Users", iconColor: "var(--purple-bg)" },
  { href: "/admin/pipeline", label: "Pipeline", iconColor: "var(--yellow-bg)" },
];

const reviewLinks: SidebarLink[] = [
  { href: "/review", label: "Review Queue", iconColor: "var(--green-bg)" },
  { href: "/review/dashboard", label: "Dashboard", iconColor: "var(--blue-bg)" },
];

const judgeLinks: SidebarLink[] = [
  { href: "/judge", label: "Judge Queue", iconColor: "var(--purple-bg)" },
  { href: "/judge/dashboard", label: "Dashboard", iconColor: "var(--blue-bg)" },
];

const agentLinks: SidebarLink[] = [
  { href: "/agent", label: "My Dashboard", iconColor: "var(--blue-bg)" },
  { href: "/agent/store", label: "Store", iconColor: "var(--yellow-bg)" },
];

const sharedLinks: SidebarLink[] = [
  { href: "/gamification", label: "Gamification", iconColor: "var(--yellow-bg)" },
  { href: "/chat", label: "Chat", iconColor: "var(--cyan-bg)" },
];

function getLinksForRole(role: string): SidebarLink[] {
  switch (role) {
    case "admin": return [...adminLinks, ...reviewLinks, ...judgeLinks, ...sharedLinks];
    case "reviewer": return [...reviewLinks, ...sharedLinks];
    case "judge": return [...judgeLinks, ...sharedLinks];
    case "manager": return [{ href: "/manager", label: "Manager", iconColor: "var(--blue-bg)" }, ...sharedLinks];
    case "user": return [...agentLinks, ...sharedLinks];
    default: return sharedLinks;
  }
}

export function Sidebar({ role, active }: SidebarProps) {
  const links = getLinksForRole(role);

  return (
    <nav class="sidebar">
      <div class="sb-brand">
        <h1>Auto-Bot</h1>
        <div class="sb-status">
          <span class="dot" />
          <span>Online</span>
        </div>
      </div>
      <div class="sb-section">
        <div class="sb-label">Navigation</div>
        {links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            class={`sb-link${active === link.href ? " active" : ""}`}
          >
            <span class="icon" style={{ background: link.iconColor }} />
            {link.label}
          </a>
        ))}
      </div>
      <div class="sb-section" style={{ marginTop: "auto", borderTop: "1px solid var(--border)" }}>
        <a href="/logout" class="sb-link" style={{ color: "var(--text-dim)" }}>
          Sign Out
        </a>
      </div>
    </nav>
  );
}
