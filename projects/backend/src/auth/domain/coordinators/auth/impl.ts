/** Unified auth: orgs, users, sessions. Replaces review/judge/manager auth. */

import type { OrgId } from "../../../../core/data/kv/org.ts";
import { kvFactory } from "../../../../core/data/kv/factory.ts";

async function kv(): Promise<Deno.Kv> {
  return await kvFactory();
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

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashPasswordPbkdf2(password: string, salt: Uint8Array): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    key,
    256,
  );
  return toHex(bits);
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await hashPasswordPbkdf2(password, salt);
  return `${toHex(salt.buffer)}:${hash}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored.includes(":")) {
    // Legacy SHA-256 format
    const data = new TextEncoder().encode(password);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return toHex(hash) === stored;
  }
  const [saltHex, hashHex] = stored.split(":");
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  const computed = await hashPasswordPbkdf2(password, salt);
  return computed === hashHex;
}

export function validatePassword(password: string): string | null {
  if (password.length < 8) return "Password must be at least 8 characters";
  if (!/[A-Z]/.test(password)) return "Password must contain at least one uppercase letter";
  if (!/[a-z]/.test(password)) return "Password must contain at least one lowercase letter";
  if (!/[0-9]/.test(password)) return "Password must contain at least one digit";
  return null;
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
  const passwordError = validatePassword(password);
  if (passwordError) throw new Error(passwordError);
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

export type VerifyResult =
  | { ok: true; auth: AuthContext }
  | { ok: false; locked: boolean };

const LOCKOUT_MAX = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes

interface LoginAttempts {
  count: number;
  lockedUntil: number | null;
}

export async function verifyUser(email: string, password: string): Promise<VerifyResult> {
  const db = await kv();

  // Check lockout
  const attemptsEntry = await db.get<LoginAttempts>(["login-attempts", email]);
  if (attemptsEntry.value?.lockedUntil && attemptsEntry.value.lockedUntil > Date.now()) {
    return { ok: false, locked: true };
  }

  // Look up org by email
  const indexEntry = await db.get<{ orgId: OrgId }>(["email-index", email]);
  if (!indexEntry.value) return { ok: false, locked: false };

  const { orgId } = indexEntry.value;
  const userEntry = await db.get<UserRecord>([orgId, "user", email]);
  if (!userEntry.value) return { ok: false, locked: false };

  const valid = await verifyPassword(password, userEntry.value.passwordHash);
  if (!valid) {
    // Increment failed attempts
    const current = attemptsEntry.value ?? { count: 0, lockedUntil: null };
    const newCount = current.count + 1;
    const locked = newCount >= LOCKOUT_MAX;
    await db.set(["login-attempts", email], {
      count: newCount,
      lockedUntil: locked ? Date.now() + LOCKOUT_DURATION : null,
    }, { expireIn: LOCKOUT_DURATION });
    return { ok: false, locked: false };
  }

  // Successful login — clear attempts
  await db.delete(["login-attempts", email]);

  // Re-hash legacy SHA-256 passwords to PBKDF2 on successful login
  if (!userEntry.value.passwordHash.includes(":")) {
    const newHash = await hashPassword(password);
    await db.set([orgId, "user", email], { ...userEntry.value, passwordHash: newHash });
  }

  return { ok: true, auth: { email, orgId, role: userEntry.value.role } };
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

const REFRESH_THRESHOLD = 60 * 60 * 1000; // 1 hour

/** Re-set session TTL if more than 1 hour has elapsed since creation. Returns true if refreshed. */
export async function refreshSession(token: string): Promise<boolean> {
  const db = await kv();
  const entry = await db.get<{ email: string; orgId: OrgId; role: Role; createdAt: number }>(["session", token]);
  if (!entry.value) return false;
  if (Date.now() - entry.value.createdAt < REFRESH_THRESHOLD) return false;
  await db.set(["session", token], {
    ...entry.value,
    createdAt: Date.now(),
  }, { expireIn: SESSION_TTL });
  return true;
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
  return await getSession(token);
}

const isSecure = () => (Deno.env.get("SELF_URL") ?? "").startsWith("https://");

export function sessionCookie(token: string): string {
  const secure = isSecure() ? " Secure;" : "";
  return `session=${token}; HttpOnly;${secure} Path=/; SameSite=Lax; Max-Age=86400`;
}

export function clearSessionCookie(): string {
  const secure = isSecure() ? " Secure;" : "";
  return `session=; HttpOnly;${secure} Path=/; SameSite=Lax; Max-Age=0`;
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
