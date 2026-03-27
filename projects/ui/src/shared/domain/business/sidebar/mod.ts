import { Component, Input } from "@sprig/kit";

export interface SidebarLink {
  href: string;
  label: string;
  iconColor: string;
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

@Component({ template: "./mod.html" })
export class Sidebar {
  @Input({ required: true }) role!: string;
  @Input() active: string = "";

  get links(): SidebarLink[] {
    switch (this.role) {
      case "admin":
        return [...adminLinks, ...reviewLinks, ...judgeLinks, ...sharedLinks];
      case "reviewer":
        return [...reviewLinks, ...sharedLinks];
      case "judge":
        return [...judgeLinks, ...sharedLinks];
      case "manager":
        return [
          { href: "/manager", label: "Manager", iconColor: "var(--blue-bg)" },
          ...sharedLinks,
        ];
      case "user":
        return [...agentLinks, ...sharedLinks];
      default:
        return [...sharedLinks];
    }
  }
}
