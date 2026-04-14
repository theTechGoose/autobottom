/** Auth controller — login, register, logout. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { ReturnedType, BodyType, Description } from "#danet/swagger-decorators";
import { LoginResponse, RegisterResponse, LogoutResponse } from "@core/dto/responses.ts";
import { GenericBodyRequest } from "@core/dto/requests.ts";
import { verifyUser, createSession, createUser, createOrg, sessionCookie, clearSessionCookie } from "@core/business/auth/mod.ts";

@SwaggerDescription("Auth — login, register, logout")
@Controller("")
export class AuthController {

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
