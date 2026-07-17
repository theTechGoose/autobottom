/** Auth types, role-based routing, user resolution. */

export type Role = "admin" | "super-manager" | "operations-manager" | "judge" | "manager" | "reviewer" | "user";

export interface User {
  email: string;
  orgId: string;
  role: Role;
}

export interface GameStateLite {
  totalXp?: number;
  level?: number;
  dayStreak?: number;
  equippedTitle?: string | null;
  equippedNameColor?: string | null;
  equippedFrame?: string | null;
  equippedFlair?: string | null;
}

export interface State {
  user?: User;
  /** When set, the real logged-in admin's email. ctx.state.user has been
   *  swapped to the impersonated user for rendering. */
  impersonatedBy?: string;
  /** Prefetched (cached) game-state for the current user. Populated by the
   *  middleware on page renders so the Sidebar/Layout can render equipped
   *  cosmetics without an extra fetch per page. Undefined on /api/ paths
   *  (sidebar isn't rendered there) and when the prefetch fails. */
  gameState?: GameStateLite;
}

export const ROLE_REDIRECTS: Record<Role, string> = {
  admin: "/admin/dashboard",
  // Super-manager has no remediation queue — land on the all-departments
  // Audit History, not the queue at /manager.
  "super-manager": "/manager/audits",
  // Operations manager oversees several department managers. Interim landing:
  // the manager queue, scoped to all their departments. Swap to the dedicated
  // /operations portal when that UI ships.
  "operations-manager": "/manager",
  judge: "/judge",
  manager: "/manager",
  reviewer: "/review/dashboard",
  user: "/agent",
};

// Audit report + appeal flow is intentionally public. Recipients of the
// terminate email click "View Full Report" / "File Appeal" without
// logging in — these are personal audit results delivered to the agent
// being audited, not gated content. Treating these as protected meant
// the email link bounced everyone to /login, blocking the appeal flow
// entirely. The report URL itself contains the (random, unguessable)
// findingId as the auth token.
export const PUBLIC_PATHS = [
  "/login", "/register", "/api/login", "/api/register",
  "/audit/report",
  "/api/audit/appeal", // covers /api/audit/appeal, /api/audit/appeal/different-recording, /api/audit/appeal/upload-recording (via prefix match)
];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export function roleRedirect(role: Role): string {
  return ROLE_REDIRECTS[role] ?? "/";
}
