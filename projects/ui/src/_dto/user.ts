export interface User {
  username?: string;
  email?: string;
  role: string;
  supervisor?: string;
}

export const ROLE_COLORS: Record<string, string> = {
  admin: "blue",
  judge: "purple",
  manager: "yellow",
  reviewer: "green",
  user: "cyan",
};

export const ROLE_INITIALS: Record<string, string> = {
  admin: "A",
  judge: "J",
  manager: "M",
  reviewer: "R",
  user: "U",
};

export const ROLE_REDIRECTS: Record<string, string> = {
  admin: "/admin/dashboard",
  judge: "/judge/dashboard",
  manager: "/manager",
  reviewer: "/review/dashboard",
  user: "/agent",
};
