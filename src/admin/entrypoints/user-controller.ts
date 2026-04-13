/** User + org management controller. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";

@SwaggerDescription("Users — org and user CRUD, auth endpoints")
@Controller("admin")
export class UserController {

  @Get("users")
  async listUsers() { return { users: [] }; }

  @Post("users")
  async addUser(@Body() body: { email: string; password: string; role: string; supervisor?: string }) {
    if (!body.email || !body.password || !body.role) return { error: "email, password, role required" };
    return { ok: true };
  }

  @Post("users/delete")
  async deleteUser(@Body() body: { email: string }) { return { ok: true }; }

  @Get("api/me")
  async me() { return { message: "admin me pending port" }; }
}
