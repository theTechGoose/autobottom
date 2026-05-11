/** User + org management controller — wired to auth service. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body, Req } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { ReturnedType, Description, BodyType } from "#danet/swagger-decorators";
import { OkResponse, OkMessageResponse, MessageResponse, UserListResponse, EmailTemplateListResponse, DashboardDataResponse, AuditsDataResponse, ReviewStatsResponse } from "@core/dto/responses.ts";
import { CreateUserRequest, DeleteEmailRequest } from "@core/dto/requests.ts";
import { createUser, deleteUser, listUsers, authenticate } from "@core/business/auth/mod.ts";
import type { Role } from "@core/business/auth/mod.ts";

import { defaultOrgId } from "@core/business/auth/mod.ts";
const ORG = defaultOrgId;

@SwaggerDescription("Users — org and user CRUD, auth endpoints")
@Controller("admin")
export class UserController {

  @Get("users") @ReturnedType(UserListResponse)
  async listUsers() {
    // Soft-fallback: under FS wedge listUsers() throws AbortError, which
    // danet surfaces as a 500. The frontend admin/users page + impersonate
    // modal both call this endpoint; a 500 here broke the entire admin
    // dashboard because users.tsx is an SSR'd parent route and the page
    // hander threw all the way up. Returning an empty list with retry:true
    // keeps the page alive — frontend renders "No users" briefly and the
    // next poll refetches.
    try { return { users: await listUsers(ORG()) }; }
    catch (err) {
      console.warn(`⚠️ [USERS] listUsers failed — soft fallback:`, err);
      return { users: [], retry: true };
    }
  }

  @Post("users") @ReturnedType(OkResponse) @BodyType(CreateUserRequest)
  async addUser(@Body() body: { email: string; password: string; role: string; supervisor?: string }) {
    if (!body.email || !body.password || !body.role) return { error: "email, password, role required" };
    await createUser(ORG(), body.email, body.password, body.role as Role, body.supervisor);
    return { ok: true };
  }

  @Post("users/delete") @ReturnedType(OkResponse) @BodyType(DeleteEmailRequest)
  async doDeleteUser(@Body() body: { email: string }) {
    if (!body.email) return { error: "email required" };
    await deleteUser(ORG(), body.email);
    return { ok: true };
  }

  @Get("api/me") @ReturnedType(MessageResponse)
  async me(@Req req: Request) {
    try {
      const auth = await authenticate(req);
      if (!auth) return { error: "unauthorized" };
      return { email: auth.email, orgId: auth.orgId, role: auth.role };
    } catch (e) {
      console.error("[ME] authenticate error:", e);
      return { error: "unauthorized" };
    }
  }
}
