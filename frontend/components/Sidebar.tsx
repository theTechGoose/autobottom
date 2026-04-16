/** 280px fixed sidebar — production-matching layout with SVG icons, modal triggers, flyout. */
import type { User, Role } from "../lib/auth.ts";
import { Icon } from "./Icons.tsx";
import type { ComponentChildren } from "preact";

interface SidebarProps {
  user: User;
  section: string;
}

// Sidebar item: either a link (href) or a modal trigger (data-modal)
interface SbItem {
  label: string;
  icon: (s?: number) => ComponentChildren;
  color: string;        // icon background (rgba)
  iconColor?: string;   // icon foreground (var)
  href?: string;        // navigation link
  modalId?: string;     // modal trigger
}

interface SbSection {
  label: string;
  items: SbItem[];
}

function SbLink({ item, section }: { item: SbItem; section: string }) {
  const isActive = item.href && section && item.href.includes(section);
  const iconStyle = `width:24px;height:24px;border-radius:6px;display:flex;align-items:center;justify-content:center;background:${item.color};color:${item.iconColor ?? "var(--blue)"};flex-shrink:0;`;

  if (item.href) {
    return (
      <a href={item.href} class={`sb-link ${isActive ? "active" : ""}`}>
        <div style={iconStyle}>{item.icon(15)}</div>
        <span class="sb-link-label">{item.label}</span>
        <span class="sb-link-arrow">{Icon.chevronRight(12)}</span>
      </a>
    );
  }

  return (
    <div class="sb-link" data-modal={item.modalId} style="cursor:pointer;">
      <div style={iconStyle}>{item.icon(15)}</div>
      <span class="sb-link-label">{item.label}</span>
      <span class="sb-link-arrow">{Icon.chevronRight(12)}</span>
    </div>
  );
}

// Admin sidebar sections
const ADMIN_SECTIONS: SbSection[] = [
  {
    label: "Navigation",
    items: [
      { label: "Chat", icon: Icon.messageCircle, color: "var(--cyan-bg)", iconColor: "var(--cyan)", href: "/chat" },
    ],
  },
  {
    label: "Configuration",
    items: [
      { label: "Question Lab", icon: Icon.flask, color: "var(--green-bg)", iconColor: "var(--green)", href: "/question-lab" },
      { label: "Webhook", icon: Icon.webhook, color: "var(--blue-bg)", iconColor: "var(--blue)", modalId: "webhook-modal" },
      { label: "Email Reports", icon: Icon.mail, color: "var(--blue-bg)", iconColor: "var(--blue)", modalId: "email-reports-modal" },
      { label: "Email Templates", icon: Icon.mail, color: "var(--cyan-bg)", iconColor: "var(--cyan)", modalId: "email-templates-modal" },
      { label: "Chargebacks & Omissions", icon: Icon.clipboardList, color: "var(--yellow-bg)", iconColor: "var(--yellow)", modalId: "chargebacks-modal" },
      { label: "Data Maintenance", icon: Icon.trash, color: "var(--red-bg)", iconColor: "var(--red)", modalId: "maintenance-modal" },
      { label: "Bad Words", icon: Icon.alertTriangle, color: "var(--red-bg)", iconColor: "var(--red)", modalId: "bad-words-modal" },
      { label: "Offices", icon: Icon.clipboardList, color: "var(--yellow-bg)", iconColor: "var(--yellow)", modalId: "offices-modal" },
      { label: "Users", icon: Icon.users, color: "var(--purple-bg)", iconColor: "var(--purple)", modalId: "users-modal" },
      { label: "Pipeline", icon: Icon.settings, color: "var(--yellow-bg)", iconColor: "var(--yellow)", modalId: "pipeline-modal" },
      { label: "Bonus Points", icon: Icon.trophy, color: "var(--purple-bg)", iconColor: "var(--purple)", modalId: "bonus-points-modal" },
      { label: "Gamification", icon: Icon.trophy, color: "var(--green-bg)", iconColor: "var(--green)", href: "/gamification" },
      { label: "Badge Editor", icon: Icon.shoppingBag, color: "var(--cyan-bg)", iconColor: "var(--cyan)", href: "/store" },
    ],
  },
  {
    label: "Impersonate",
    items: [
      { label: "Specific User", icon: Icon.userCog, color: "var(--yellow-bg)", iconColor: "var(--yellow)", modalId: "impersonate-modal" },
    ],
  },
];

// Role view links for the flyout
const ROLE_VIEWS = [
  { label: "Judge Dashboard", href: "/judge/dashboard", icon: Icon.scale, color: "rgba(210,153,34,0.10)", iconColor: "var(--yellow)" },
  { label: "Review Dashboard", href: "/review/dashboard", icon: Icon.playCircle, color: "var(--purple-bg)", iconColor: "var(--purple)" },
  { label: "Manager Portal", href: "/manager", icon: Icon.clipboardList, color: "var(--cyan-bg)", iconColor: "var(--cyan)" },
  { label: "Team Member Dashboard", href: "/agent", icon: Icon.barChart, color: "rgba(249,115,22,0.10)", iconColor: "#f97316" },
];

// Other roles — simpler navigation
const REVIEWER_SECTIONS: SbSection[] = [{ label: "Navigation", items: [
  { label: "Review Queue", icon: Icon.playCircle, color: "var(--purple-bg)", iconColor: "var(--purple)", href: "/review" },
  { label: "Dashboard", icon: Icon.layoutDashboard, color: "var(--purple-bg)", iconColor: "var(--purple)", href: "/review/dashboard" },
  { label: "Store", icon: Icon.trophy, color: "var(--yellow-bg)", iconColor: "var(--yellow)", href: "/store" },
  { label: "Chat", icon: Icon.messageCircle, color: "var(--cyan-bg)", iconColor: "var(--cyan)", href: "/chat" },
]}];

const JUDGE_SECTIONS: SbSection[] = [{ label: "Navigation", items: [
  { label: "Judge Queue", icon: Icon.scale, color: "rgba(20,184,166,0.10)", iconColor: "#14b8a6", href: "/judge" },
  { label: "Dashboard", icon: Icon.layoutDashboard, color: "rgba(20,184,166,0.10)", iconColor: "#14b8a6", href: "/judge/dashboard" },
  { label: "Store", icon: Icon.trophy, color: "var(--yellow-bg)", iconColor: "var(--yellow)", href: "/store" },
  { label: "Chat", icon: Icon.messageCircle, color: "var(--cyan-bg)", iconColor: "var(--cyan)", href: "/chat" },
]}];

const MANAGER_SECTIONS: SbSection[] = [{ label: "Navigation", items: [
  { label: "Queue", icon: Icon.clipboardList, color: "var(--cyan-bg)", iconColor: "var(--cyan)", href: "/manager" },
  { label: "Store", icon: Icon.trophy, color: "var(--yellow-bg)", iconColor: "var(--yellow)", href: "/store" },
  { label: "Chat", icon: Icon.messageCircle, color: "var(--cyan-bg)", iconColor: "var(--cyan)", href: "/chat" },
]}];

const USER_SECTIONS: SbSection[] = [{ label: "Navigation", items: [
  { label: "Dashboard", icon: Icon.barChart, color: "rgba(249,115,22,0.10)", iconColor: "#f97316", href: "/agent" },
  { label: "Store", icon: Icon.trophy, color: "var(--yellow-bg)", iconColor: "var(--yellow)", href: "/store" },
  { label: "Chat", icon: Icon.messageCircle, color: "var(--cyan-bg)", iconColor: "var(--cyan)", href: "/chat" },
]}];

const ROLE_SECTION_MAP: Record<Role, SbSection[]> = {
  admin: ADMIN_SECTIONS,
  reviewer: REVIEWER_SECTIONS,
  judge: JUDGE_SECTIONS,
  manager: MANAGER_SECTIONS,
  user: USER_SECTIONS,
};

export function Sidebar({ user, section }: SidebarProps) {
  const sections = ROLE_SECTION_MAP[user.role] ?? USER_SECTIONS;
  const isAdmin = user.role === "admin";
  const initials = user.email.slice(0, 2).toUpperCase();

  return (
    <aside class="sidebar">
      <div class="sb-brand">
        <h1>Auto-Bot</h1>
        <div class="sb-status">
          <span class="dot"></span>
          <span id="refresh-countdown">Operational</span>
        </div>
      </div>

      <nav class="sb-nav">
        {sections.map((sec) => (
          <div key={sec.label} class="sb-section">
            <div class="sb-label">{sec.label}</div>
            {sec.items.map((item) => <SbLink key={item.label} item={item} section={section} />)}
          </div>
        ))}

        {/* Role Views flyout — admin only */}
        {isAdmin && (
          <div class="sb-section">
            <div class="sb-rv-wrap">
              <div class="sb-link" style="cursor:pointer;">
                <div style="width:24px;height:24px;border-radius:6px;display:flex;align-items:center;justify-content:center;background:rgba(139,92,246,0.10);flex-shrink:0;">{Icon.users(15)}</div>
                <span class="sb-link-label">Role Views</span>
                <span class="sb-link-arrow">{Icon.chevronRight(12)}</span>
              </div>
              <div class="sb-rv-flyout">
                <div class="sb-rv-panel">
                  <div class="rv-title">View as role</div>
                  {ROLE_VIEWS.map((rv) => (
                    <a key={rv.href} href={rv.href}>
                      <div class="rm-icon" style={`background:${rv.color};color:${rv.iconColor}`}>{rv.icon(15)}</div>
                      <span>{rv.label}</span>
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </nav>

      <div class="sb-footer">
        <div class="sb-user">
          <div class="sb-avatar">{initials}</div>
          <div>
            <div class="sb-email">{user.email}</div>
            <div class="sb-role">{user.role}</div>
          </div>
        </div>
        <div class="sb-settings" style="padding:6px 14px 14px;">
          <a href="/api/logout" class="sb-link" style="text-decoration:none;color:inherit;">
            <div style="width:24px;height:24px;border-radius:6px;display:flex;align-items:center;justify-content:center;background:var(--red-bg);color:var(--red);flex-shrink:0;">{Icon.logOut(15)}</div>
            <span class="sb-link-label">Logout</span>
          </a>
        </div>
      </div>
    </aside>
  );
}
