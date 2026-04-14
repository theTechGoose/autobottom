/** Auth service: orgs, users, sessions, RBAC. Ported from auth/kv.ts. */

import { getKv, orgKey } from "@core/data/deno-kv/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

export type { OrgId };

// ── Types ────────────────────────────────────────────────────────────────────

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

// ── Password ─────────────────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(password);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Org CRUD ─────────────────────────────────────────────────────────────────

export async function createOrg(name: string, createdBy: string): Promise<OrgId> {
  const db = await getKv();
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
  const db = await getKv();
  const entry = await db.get<OrgRecord>(["org", orgId]);
  return entry.value ?? null;
}

export async function listOrgs(): Promise<Array<OrgRecord & { id: OrgId }>> {
  const db = await getKv();
  const orgs: Array<OrgRecord & { id: OrgId }> = [];
  for await (const entry of db.list<OrgRecord>({ prefix: ["org"] })) {
    if (entry.key[0] === "org" && entry.key.length === 2) {
      orgs.push({ ...entry.value, id: entry.key[1] as OrgId });
    }
  }
  return orgs;
}

export async function deleteOrg(orgId: OrgId): Promise<void> {
  const db = await getKv();
  const org = await getOrg(orgId);
  const ops = db.atomic().delete(["org", orgId]);
  if (org) ops.delete(["org-by-slug", org.slug]);
  await ops.commit();
}

// ── User CRUD ────────────────────────────────────────────────────────────────

export async function createUser(
  orgId: OrgId, email: string, password: string, role: Role, supervisor?: string,
): Promise<void> {
  const db = await getKv();
  const passwordHash = await hashPassword(password);
  const user: UserRecord = { passwordHash, role, supervisor: supervisor || null, createdAt: Date.now() };
  await db.atomic()
    .set([orgId, "user", email], user)
    .set(["email-index", email], { orgId })
    .commit();
}

export async function getUser(orgId: OrgId, email: string): Promise<UserRecord | null> {
  const db = await getKv();
  const entry = await db.get<UserRecord>([orgId, "user", email]);
  return entry.value ?? null;
}

export async function deleteUser(orgId: OrgId, email: string): Promise<void> {
  const db = await getKv();
  await db.atomic()
    .delete([orgId, "user", email])
    .delete(["email-index", email])
    .commit();
}

export async function verifyUser(email: string, password: string): Promise<AuthContext | null> {
  const db = await getKv();
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
  orgId: OrgId, filterRole?: Role,
): Promise<Array<{ email: string; role: Role; supervisor: string | null; createdAt: number }>> {
  const db = await getKv();
  const users: Array<{ email: string; role: Role; supervisor: string | null; createdAt: number }> = [];
  for await (const entry of db.list<UserRecord>({ prefix: [orgId, "user"] })) {
    const user = entry.value;
    if (filterRole && user.role !== filterRole) continue;
    users.push({ email: entry.key[2] as string, role: user.role, supervisor: user.supervisor ?? null, createdAt: user.createdAt });
  }
  return users;
}

export async function listUsersBySupervisor(
  orgId: OrgId, supervisor: string,
): Promise<Array<{ email: string; role: Role; createdAt: number }>> {
  const db = await getKv();
  const users: Array<{ email: string; role: Role; createdAt: number }> = [];
  for await (const entry of db.list<UserRecord>({ prefix: [orgId, "user"] })) {
    if (entry.value.supervisor === supervisor) {
      users.push({ email: entry.key[2] as string, role: entry.value.role, createdAt: entry.value.createdAt });
    }
  }
  return users;
}

// ── Sessions ─────────────────────────────────────────────────────────────────

const SESSION_TTL = 24 * 60 * 60 * 1000;

export async function createSession(auth: AuthContext): Promise<string> {
  const db = await getKv();
  const token = crypto.randomUUID();
  await db.set(["session", token], {
    email: auth.email, orgId: auth.orgId, role: auth.role, createdAt: Date.now(),
  }, { expireIn: SESSION_TTL });
  return token;
}

export async function getSession(token: string): Promise<AuthContext | null> {
  const db = await getKv();
  const entry = await db.get<{ email: string; orgId: OrgId; role: Role }>(["session", token]);
  if (!entry.value) return null;
  return { email: entry.value.email, orgId: entry.value.orgId, role: entry.value.role };
}

export async function deleteSession(token: string): Promise<void> {
  const db = await getKv();
  await db.delete(["session", token]);
}

// ── Request Auth Helpers ─────────────────────────────────────────────────────

export function parseCookie(req: Request, name = "session"): string | null {
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

// ── Role checking ────────────────────────────────────────────────────────────

const ROLE_HIERARCHY: Record<Role, number> = {
  user: 0,
  reviewer: 1,
  manager: 2,
  judge: 3,
  admin: 4,
};

export function hasRole(auth: AuthContext, minRole: Role): boolean {
  return ROLE_HIERARCHY[auth.role] >= ROLE_HIERARCHY[minRole];
}

export function requireRole(auth: AuthContext | null, minRole: Role): AuthContext {
  if (!auth) throw new Error("Unauthorized");
  if (!hasRole(auth, minRole)) throw new Error(`Forbidden: requires ${minRole}`);
  return auth;
}
/** Auth guard for danet controllers — extracts orgId from session cookie.
 *  Use @UseGuard(AuthGuard) on controllers or methods that need auth.
 *  Access auth context via getAuthFromContext(context) in the controller. */

import { Injectable } from "@danet/core";

// Store auth context keyed by request ID so controllers can retrieve it
const authContextMap = new Map<string, AuthContext>();

@Injectable()
export class AuthGuard {
  async canActivate(context: any): Promise<boolean> {
    const req = context.req?.raw as Request | undefined;
    if (!req) return false;

    const auth = await authenticate(req);
    if (!auth) return false;

    // Store auth in context for controller access
    const requestId = context.get?.("_id") ?? crypto.randomUUID();
    authContextMap.set(requestId, auth);

    // Clean up after 60s to prevent memory leaks
    setTimeout(() => authContextMap.delete(requestId), 60_000);

    return true;
  }
}

/** Retrieve the authenticated user's context from within a controller method.
 *  Call this with the @Context() injected execution context. */
export function getAuthFromContext(context: any): AuthContext | null {
  const requestId = context?.get?.("_id") ?? context?._id;
  if (!requestId) return null;
  return authContextMap.get(requestId) ?? null;
}

/** Helper for controllers that don't use the guard — parses auth from raw request.
 *  Returns orgId or throws. Used as: `const orgId = await resolveOrgId(req)` */
export async function resolveOrgId(req: Request): Promise<string> {
  const auth = await authenticate(req);
  if (!auth) throw new Error("Unauthorized");
  return auth.orgId;
}
/** Org resolver — extracts orgId from session cookie, falls back to env default.
 *  Used by all controllers for per-request org context. */


/** Default orgId from environment — used when no session cookie present (QStash callbacks, etc). */
export function defaultOrgId(): string {
  return Deno.env.get("CHARGEBACKS_ORG_ID") ?? Deno.env.get("DEFAULT_ORG_ID") ?? "default";
}

/** Resolve orgId from request — extracts from session cookie, falls back to env default. */
export async function resolveOrg(req: Request): Promise<string> {
  const auth = await authenticate(req);
  return auth?.orgId ?? defaultOrgId();
}
/** Auth controller — login, register, logout. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { ReturnedType, BodyType, Description } from "#danet/swagger-decorators";
import { LoginResponse, RegisterResponse, LogoutResponse, HealthResponse } from "@core/dto/responses.ts";
import { GenericBodyRequest } from "@core/dto/requests.ts";

@SwaggerDescription("Auth — login, register, logout")
@Controller("")
export class AuthController {

  @Get("/") @ReturnedType(HealthResponse) @Description("Health check — confirms the API is running")
  health() { return { status: "ok", service: "autobottom", version: "2.0.0" }; }

  @Post("login") @ReturnedType(LoginResponse) @Description("Authenticate and get session token")
  async login(@Body() body: { email: string; password: string }) {
    if (!body.email || !body.password) return { error: "email and password required" };
    const auth = await verifyUser(body.email, body.password);
    if (!auth) return { error: "invalid credentials" };
    const token = await createSession(auth);
    return { ok: true, token, cookie: sessionCookie(token), email: auth.email, orgId: auth.orgId, role: auth.role };
  }

  @Post("register") @ReturnedType(RegisterResponse) @Description("Register new org and admin user")
  async register(@Body() body: { email: string; password: string; orgName?: string; orgId?: string }) {
    if (!body.email || !body.password) return { error: "email and password required" };
    const orgId = body.orgId ?? await createOrg(body.orgName ?? "Default Org", body.email);
    await createUser(orgId, body.email, body.password, "admin");
    const auth = { email: body.email, orgId, role: "admin" as const };
    const token = await createSession(auth);
    return { ok: true, token, cookie: sessionCookie(token), orgId };
  }

  @Post("logout") @ReturnedType(LogoutResponse) @Description("Clear session cookie")
  async logout() {
    return { ok: true, cookie: clearSessionCookie() };
  }
}
