/** Auth controller — login, register, logout. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { verifyUser, createSession, createUser, createOrg, sessionCookie, clearSessionCookie } from "@core/domain/business/auth/mod.ts";

@SwaggerDescription("Auth — login, register, logout")
@Controller("")
export class AuthController {

  @Post("login")
  async login(@Body() body: { email: string; password: string }) {
    if (!body.email || !body.password) return { error: "email and password required" };
    const auth = await verifyUser(body.email, body.password);
    if (!auth) return { error: "invalid credentials" };
    const token = await createSession(auth);
    return { ok: true, token, cookie: sessionCookie(token), email: auth.email, orgId: auth.orgId, role: auth.role };
  }

  @Post("register")
  async register(@Body() body: { email: string; password: string; orgName?: string; orgId?: string }) {
    if (!body.email || !body.password) return { error: "email and password required" };
    const orgId = body.orgId ?? await createOrg(body.orgName ?? "Default Org", body.email);
    await createUser(orgId, body.email, body.password, "admin");
    const auth = { email: body.email, orgId, role: "admin" as const };
    const token = await createSession(auth);
    return { ok: true, token, cookie: sessionCookie(token), orgId };
  }

  @Post("logout")
  async logout() {
    return { ok: true, cookie: clearSessionCookie() };
  }
}
