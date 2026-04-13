/** User + org management controller — wired to auth service. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { createUser, deleteUser, listUsers } from "@core/domain/business/auth/mod.ts";
import type { Role } from "@core/domain/business/auth/mod.ts";

const ORG = () => "default";

@SwaggerDescription("Users — org and user CRUD, auth endpoints")
@Controller("admin")
export class UserController {

  @Get("users")
  async listUsers() { return { users: await listUsers(ORG()) }; }

  @Post("users")
  async addUser(@Body() body: { email: string; password: string; role: string; supervisor?: string }) {
    if (!body.email || !body.password || !body.role) return { error: "email, password, role required" };
    await createUser(ORG(), body.email, body.password, body.role as Role, body.supervisor);
    return { ok: true };
  }

  @Post("users/delete")
  async doDeleteUser(@Body() body: { email: string }) {
    if (!body.email) return { error: "email required" };
    await deleteUser(ORG(), body.email);
    return { ok: true };
  }

  @Get("api/me")
  async me() { return { message: "admin me — requires auth context injection" }; }
}
