/** Auth service: orgs, users, sessions, RBAC. Firestore-backed. */

import { getStored, setStored, deleteStored, listStoredWithKeys } from "@core/data/firestore/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

export type { OrgId };

// Globals (org/slug/email indices/sessions) use empty-string org ("") since
// they're not per-tenant.
const GLOBAL = "" as OrgId;

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
  const orgId = crypto.randomUUID();
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const org: OrgRecord = { name, slug, createdAt: Date.now(), createdBy };
  await setStored("org", GLOBAL, [orgId], org);
  await setStored("org-by-slug", GLOBAL, [slug], { orgId });
  return orgId;
}

export async function getOrg(orgId: OrgId): Promise<OrgRecord | null> {
  return await getStored<OrgRecord>("org", GLOBAL, orgId);
}

export async function listOrgs(): Promise<Array<OrgRecord & { id: OrgId }>> {
  const rows = await listStoredWithKeys<OrgRecord>("org", GLOBAL);
  return rows.map(({ key, value }) => ({ ...value, id: String(key[0] ?? "") as OrgId }));
}

export async function deleteOrg(orgId: OrgId): Promise<void> {
  const org = await getOrg(orgId);
  await deleteStored("org", GLOBAL, orgId);
  if (org) await deleteStored("org-by-slug", GLOBAL, org.slug);
}

// ── User CRUD ────────────────────────────────────────────────────────────────

export async function createUser(
  orgId: OrgId, email: string, password: string, role: Role, supervisor?: string,
): Promise<void> {
  const passwordHash = await hashPassword(password);
  const user: UserRecord = { passwordHash, role, supervisor: supervisor || null, createdAt: Date.now() };
  await setStored("user", orgId, [email], user);
  await setStored("email-index", GLOBAL, [email], { orgId });
}

export async function getUser(orgId: OrgId, email: string): Promise<UserRecord | null> {
  return await getStored<UserRecord>("user", orgId, email);
}

export async function deleteUser(orgId: OrgId, email: string): Promise<void> {
  await deleteStored("user", orgId, email);
  await deleteStored("email-index", GLOBAL, email);
}

export async function verifyUser(email: string, password: string): Promise<AuthContext | null> {
  const indexEntry = await getStored<{ orgId: OrgId }>("email-index", GLOBAL, email);
  if (!indexEntry) return null;
  const { orgId } = indexEntry;
  const user = await getUser(orgId, email);
  if (!user) return null;
  const hash = await hashPassword(password);
  if (hash !== user.passwordHash) return null;
  return { email, orgId, role: user.role };
}

export async function listUsers(
  orgId: OrgId, filterRole?: Role,
): Promise<Array<{ email: string; role: Role; supervisor: string | null; createdAt: number }>> {
  const rows = await listStoredWithKeys<UserRecord>("user", orgId);
  const users: Array<{ email: string; role: Role; supervisor: string | null; createdAt: number }> = [];
  for (const { key, value: user } of rows) {
    if (filterRole && user.role !== filterRole) continue;
    users.push({ email: String(key[0] ?? ""), role: user.role, supervisor: user.supervisor ?? null, createdAt: user.createdAt });
  }
  return users;
}

export async function listUsersBySupervisor(
  orgId: OrgId, supervisor: string,
): Promise<Array<{ email: string; role: Role; createdAt: number }>> {
  const rows = await listStoredWithKeys<UserRecord>("user", orgId);
  const users: Array<{ email: string; role: Role; createdAt: number }> = [];
  for (const { key, value } of rows) {
    if (value.supervisor === supervisor) {
      users.push({ email: String(key[0] ?? ""), role: value.role, createdAt: value.createdAt });
    }
  }
  return users;
}

// ── Sessions ─────────────────────────────────────────────────────────────────

const SESSION_TTL = 24 * 60 * 60 * 1000;

export async function createSession(auth: AuthContext): Promise<string> {
  const token = crypto.randomUUID();
  await setStored("session", GLOBAL, [token], {
    email: auth.email, orgId: auth.orgId, role: auth.role, createdAt: Date.now(),
  }, { expireInMs: SESSION_TTL });
  return token;
}

/** In-memory session cache. Every Fresh request re-runs auth middleware,
 *  which would otherwise hit Firestore on every page/HTMX request. Caching
 *  for 30s drops Firestore session reads ~99% under typical browse load
 *  and stops HTTP/2 connection-pool exhaustion that was 503ing the
 *  dashboard. Logout still works because deleteSession evicts the cache. */
const SESSION_CACHE_TTL_MS = 30_000;
const _sessionCache = new Map<string, { auth: AuthContext; expiresAt: number }>();

export async function getSession(token: string): Promise<AuthContext | null> {
  const cached = _sessionCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.auth;
  if (cached) _sessionCache.delete(token);

  const v = await getStored<{ email: string; orgId: OrgId; role: Role }>("session", GLOBAL, token);
  if (!v) return null;
  const auth: AuthContext = { email: v.email, orgId: v.orgId, role: v.role };
  _sessionCache.set(token, { auth, expiresAt: Date.now() + SESSION_CACHE_TTL_MS });
  return auth;
}

export async function deleteSession(token: string): Promise<void> {
  _sessionCache.delete(token);
  await deleteStored("session", GLOBAL, token);
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
