/** Unified auth: orgs, users, sessions. Replaces review/judge/manager auth. */

import { Kv } from "../../data/kv/mod.ts";
import type { OrgId } from "../../data/kv/mod.ts";

async function kv(): Promise<Deno.Kv> {
  const instance = await Kv.getInstance();
  return instance.db;
}

// -- Types --

export type Role = "admin" | "judge" | "manager" | "reviewer" | "user";

export interface OrgRecord {
  name: string;
  slug: string;
  createdAt: number;
  createdBy: string;
}

export interface UserRecord {
  passwordHash: string;
  role: Role;
  supervisor?: string | null;
  createdAt: number;
}

export interface AuthContext {
  email: string;
  orgId: OrgId;
  role: Role;
}

// -- Password --

async function hashPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(password);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// -- Org CRUD --

export async function createOrg(name: string, createdBy: string): Promise<OrgId> {
  const db = await kv();
  const orgId = crypto.randomUUID();
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const org: OrgRecord = { name, slug, createdAt: Date.now(), createdBy };
  await db.atomic()
    .set(["org", orgId], org)
    .set(["org-by-slug", slug], orgId)
    .commit();

  return orgId;
}

export async function getOrg(orgId: OrgId): Promise<OrgRecord | null> {
  const db = await kv();
  const entry = await db.get<OrgRecord>(["org", orgId]);
  return entry.value ?? null;
}

export async function getOrgBySlug(slug: string): Promise<OrgId | null> {
  const db = await kv();
  const entry = await db.get<OrgId>(["org-by-slug", slug]);
  return entry.value ?? null;
}

export async function listOrgs(): Promise<Array<OrgRecord & { id: OrgId }>> {
  const db = await kv();
  const orgs: Array<OrgRecord & { id: OrgId }> = [];
  for await (const entry of db.list<OrgRecord>({ prefix: ["org"] })) {
    if (entry.key[0] === "org" && entry.key.length === 2) {
      orgs.push({ ...entry.value, id: entry.key[1] as OrgId });
    }
  }
  return orgs;
}

export async function deleteOrg(orgId: OrgId): Promise<void> {
  const db = await kv();
  const org = await getOrg(orgId);
  const ops = db.atomic().delete(["org", orgId]);
  if (org) ops.delete(["org-by-slug", org.slug]);
  await ops.commit();
}

// -- User CRUD --

export async function createUser(
  orgId: OrgId,
  email: string,
  password: string,
  role: Role,
  supervisor?: string,
): Promise<void> {
  const db = await kv();
  const passwordHash = await hashPassword(password);
  const user: UserRecord = {
    passwordHash,
    role,
    supervisor: supervisor || null,
    createdAt: Date.now(),
  };

  await db.atomic()
    .set([orgId, "user", email], user)
    .set(["email-index", email], { orgId })
    .commit();
}

export async function getUser(orgId: OrgId, email: string): Promise<UserRecord | null> {
  const db = await kv();
  const entry = await db.get<UserRecord>([orgId, "user", email]);
  return entry.value ?? null;
}

export async function deleteUser(orgId: OrgId, email: string): Promise<void> {
  const db = await kv();
  await db.atomic()
    .delete([orgId, "user", email])
    .delete(["email-index", email])
    .commit();
}

export async function verifyUser(email: string, password: string): Promise<AuthContext | null> {
  const db = await kv();

  // Look up org by email
  const indexEntry = await db.get<{ orgId: OrgId }>(["email-index", email]);
  if (!indexEntry.value) return null;

  const { orgId } = indexEntry.value;
  const userEntry = await db.get<UserRecord>([orgId, "user", email]);
  if (!userEntry.value) return null;

  const hash = await hashPassword(password);
  if (hash !== userEntry.value.passwordHash) return null;

  return { email, orgId, role: userEntry.value.role };
}

export async function listUsers(
  orgId: OrgId,
  filterRole?: Role,
): Promise<Array<{ email: string; role: Role; supervisor: string | null; createdAt: number }>> {
  const db = await kv();
  const users: Array<{ email: string; role: Role; supervisor: string | null; createdAt: number }> = [];
  for await (const entry of db.list<UserRecord>({ prefix: [orgId, "user"] })) {
    const user = entry.value;
    if (filterRole && user.role !== filterRole) continue;
    users.push({
      email: entry.key[2] as string,
      role: user.role,
      supervisor: user.supervisor ?? null,
      createdAt: user.createdAt,
    });
  }
  return users;
}

export async function listUsersBySupervisor(
  orgId: OrgId,
  supervisor: string,
): Promise<Array<{ email: string; role: Role; createdAt: number }>> {
  const db = await kv();
  const users: Array<{ email: string; role: Role; createdAt: number }> = [];
  for await (const entry of db.list<UserRecord>({ prefix: [orgId, "user"] })) {
    if (entry.value.supervisor === supervisor) {
      users.push({
        email: entry.key[2] as string,
        role: entry.value.role,
        createdAt: entry.value.createdAt,
      });
    }
  }
  return users;
}

// -- Sessions --

const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours

export async function createSession(auth: AuthContext): Promise<string> {
  const db = await kv();
  const token = crypto.randomUUID();
  await db.set(["session", token], {
    email: auth.email,
    orgId: auth.orgId,
    role: auth.role,
    createdAt: Date.now(),
  }, { expireIn: SESSION_TTL });
  return token;
}

export async function getSession(token: string): Promise<AuthContext | null> {
  const db = await kv();
  const entry = await db.get<{ email: string; orgId: OrgId; role: Role; createdAt: number }>(["session", token]);
  if (!entry.value) return null;
  return { email: entry.value.email, orgId: entry.value.orgId, role: entry.value.role };
}

export async function deleteSession(token: string): Promise<void> {
  const db = await kv();
  await db.delete(["session", token]);
}

// -- Request Auth Helpers --

export function parseCookie(req: Request, name: string = "session"): string | null {
  const cookie = req.headers.get("cookie") ?? "";
  const re = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`);
  const match = cookie.match(re);
  return match?.[1] ?? null;
}

export async function authenticate(req: Request): Promise<AuthContext | null> {
  const token = parseCookie(req, "session");
  if (!token) return null;
  return getSession(token);
}

export function sessionCookie(token: string): string {
  return `session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=86400`;
}

export function clearSessionCookie(): string {
  return `session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

/** Resolve effective auth: if admin has ?as=email, return target user's context. */
export async function resolveEffectiveAuth(req: Request): Promise<AuthContext | null> {
  const auth = await authenticate(req);
  if (!auth) return null;
  const asEmail = new URL(req.url).searchParams.get("as");
  if (auth.role === "admin" && asEmail) {
    const target = await getUser(auth.orgId, asEmail);
    if (!target) return null;
    return { email: asEmail, orgId: auth.orgId, role: target.role };
  }
  return auth;
}
