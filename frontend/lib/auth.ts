/** Auth types, role-based routing, user resolution. */

export type Role = "admin" | "judge" | "manager" | "reviewer" | "user";

export interface User {
  email: string;
  orgId: string;
  role: Role;
}

export interface State {
  user?: User;
  /** When set, the real logged-in admin's email. ctx.state.user has been
   *  swapped to the impersonated user for rendering. */
  impersonatedBy?: string;
}

export const ROLE_REDIRECTS: Record<Role, string> = {
  admin: "/admin/dashboard",
  judge: "/judge",
  manager: "/manager",
  reviewer: "/review",
  user: "/agent",
};

export const PUBLIC_PATHS = ["/login", "/register", "/api/login", "/api/register"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export function roleRedirect(role: Role): string {
  return ROLE_REDIRECTS[role] ?? "/";
}
