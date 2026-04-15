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
  color: string;
  href?: string;        // navigation link
  modalId?: string;     // modal trigger
}

interface SbSection {
  label: string;
  items: SbItem[];
}

function SbLink({ item, section }: { item: SbItem; section: string }) {
  const isActive = item.href && section && item.href.includes(section);
  const iconStyle = `width:24px;height:24px;border-radius:6px;display:flex;align-items:center;justify-content:center;background:${item.color};flex-shrink:0;`;

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
      { label: "Chat", icon: Icon.messageCircle, color: "rgba(57,208,216,0.10)", href: "/chat" },
    ],
  },
  {
    label: "Configuration",
    items: [
      { label: "Question Lab", icon: Icon.flask, color: "rgba(63,185,80,0.12)", href: "/question-lab" },
      { label: "Webhook", icon: Icon.webhook, color: "rgba(31,111,235,0.10)", modalId: "webhook-modal" },
      { label: "Email Reports", icon: Icon.mail, color: "rgba(31,111,235,0.10)", modalId: "email-reports-modal" },
      { label: "Email Templates", icon: Icon.mail, color: "rgba(57,208,216,0.10)", modalId: "email-templates-modal" },
      { label: "Chargebacks & Omissions", icon: Icon.clipboardList, color: "rgba(210,153,34,0.10)", modalId: "chargebacks-modal" },
      { label: "Data Maintenance", icon: Icon.trash, color: "rgba(248,81,73,0.10)", modalId: "maintenance-modal" },
      { label: "Bad Words", icon: Icon.alertTriangle, color: "rgba(248,81,73,0.10)", modalId: "bad-words-modal" },
      { label: "Offices", icon: Icon.clipboardList, color: "rgba(210,153,34,0.10)", modalId: "offices-modal" },
      { label: "Users", icon: Icon.users, color: "rgba(139,92,246,0.10)", modalId: "users-modal" },
      { label: "Pipeline", icon: Icon.settings, color: "rgba(210,153,34,0.10)", modalId: "pipeline-modal" },
      { label: "Bonus Points", icon: Icon.trophy, color: "rgba(139,92,246,0.10)", modalId: "bonus-points-modal" },
      { label: "Badge Store", icon: Icon.shoppingBag, color: "rgba(57,208,216,0.10)", href: "/store" },
    ],
  },
  {
    label: "Impersonate",
    items: [
      { label: "Specific User", icon: Icon.userCog, color: "rgba(210,153,34,0.10)", modalId: "impersonate-modal" },
    ],
  },
];

// Role view links for the flyout
const ROLE_VIEWS = [
  { label: "Judge Dashboard", href: "/judge/dashboard", icon: Icon.scale, color: "rgba(210,153,34,0.10)" },
  { label: "Review Dashboard", href: "/review/dashboard", icon: Icon.playCircle, color: "rgba(139,92,246,0.10)" },
  { label: "Manager Portal", href: "/manager", icon: Icon.clipboardList, color: "rgba(57,208,216,0.10)" },
  { label: "Team Member Dashboard", href: "/agent", icon: Icon.barChart, color: "rgba(249,115,22,0.10)" },
];

// Other roles — simpler navigation
const REVIEWER_SECTIONS: SbSection[] = [{ label: "Navigation", items: [
  { label: "Review Queue", icon: Icon.playCircle, color: "rgba(139,92,246,0.10)", href: "/review" },
  { label: "Dashboard", icon: Icon.layoutDashboard, color: "rgba(139,92,246,0.10)", href: "/review/dashboard" },
  { label: "Store", icon: Icon.trophy, color: "rgba(210,153,34,0.10)", href: "/store" },
  { label: "Chat", icon: Icon.messageCircle, color: "rgba(57,208,216,0.10)", href: "/chat" },
]}];

const JUDGE_SECTIONS: SbSection[] = [{ label: "Navigation", items: [
  { label: "Judge Queue", icon: Icon.scale, color: "rgba(20,184,166,0.10)", href: "/judge" },
  { label: "Dashboard", icon: Icon.layoutDashboard, color: "rgba(20,184,166,0.10)", href: "/judge/dashboard" },
  { label: "Store", icon: Icon.trophy, color: "rgba(210,153,34,0.10)", href: "/store" },
  { label: "Chat", icon: Icon.messageCircle, color: "rgba(57,208,216,0.10)", href: "/chat" },
]}];

const MANAGER_SECTIONS: SbSection[] = [{ label: "Navigation", items: [
  { label: "Queue", icon: Icon.clipboardList, color: "rgba(57,208,216,0.10)", href: "/manager" },
  { label: "Store", icon: Icon.trophy, color: "rgba(210,153,34,0.10)", href: "/store" },
  { label: "Chat", icon: Icon.messageCircle, color: "rgba(57,208,216,0.10)", href: "/chat" },
]}];

const USER_SECTIONS: SbSection[] = [{ label: "Navigation", items: [
  { label: "Dashboard", icon: Icon.barChart, color: "rgba(249,115,22,0.10)", href: "/agent" },
  { label: "Store", icon: Icon.trophy, color: "rgba(210,153,34,0.10)", href: "/store" },
  { label: "Chat", icon: Icon.messageCircle, color: "rgba(57,208,216,0.10)", href: "/chat" },
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
          <span>Operational</span>
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
                      <div class="rm-icon" style={`background:${rv.color}`}>{rv.icon(15)}</div>
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
        <div class="sb-settings">
          <a href="/api/logout" class="sb-logout-btn">{Icon.logOut(14)} Sign Out</a>
        </div>
      </div>
    </aside>
  );
}
