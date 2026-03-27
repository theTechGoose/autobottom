/** HTTP handlers for auth routes (register, login, logout). */

import {
  createOrg, createUser, verifyUser,
  createSession, deleteSession,
  parseCookie, sessionCookie, clearSessionCookie,
} from "../domain/coordinators/auth/mod.ts";
import { json } from "./helpers.ts";

export async function handleRegisterPost(req: Request): Promise<Response> {
  const body = await req.json();
  const { orgName, email, password } = body;
  if (!orgName || !email || !password) {
    return json({ error: "orgName, email, and password required" }, 400);
  }

  const orgId = await createOrg(orgName, email);
  await createUser(orgId, email, password, "admin");
  const token = await createSession({ email, orgId, role: "admin" });

  return json({ ok: true, orgId }, {
    status: 200,
    headers: { "Set-Cookie": sessionCookie(token) },
  } as any);
}

export async function handleLoginPost(req: Request): Promise<Response> {
  const body = await req.json();
  const { email, password } = body;
  if (!email || !password) return json({ error: "email and password required" }, 400);

  const auth = await verifyUser(email, password);
  if (!auth) return json({ error: "invalid credentials" }, 401);

  const token = await createSession(auth);

  // Determine redirect based on role
  const redirectMap: Record<string, string> = {
    admin: "/admin/dashboard",
    judge: "/judge/dashboard",
    manager: "/manager",
    reviewer: "/review/dashboard",
    user: "/agent",
  };
  const redirect = auth.email === "ai@monsterrg.com" ? "/super-admin" : (redirectMap[auth.role] ?? "/");

  return new Response(JSON.stringify({ ok: true, role: auth.role, redirect }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": sessionCookie(token),
    },
  });
}

export async function handleLogoutPost(req: Request): Promise<Response> {
  const token = parseCookie(req, "session");
  if (token) await deleteSession(token);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": clearSessionCookie(),
    },
  });
}
