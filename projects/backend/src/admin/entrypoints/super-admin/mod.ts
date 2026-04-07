import "reflect-metadata";
import { Controller, Get, Post, Req } from "@danet/core";
import { routeSuperAdmin } from "../../../entrypoints/super-admin.ts";

/**
 * Super-admin controller.
 *
 * The original entrypoint uses a single routeSuperAdmin() function that
 * does its own path-based dispatch. Individual handler functions are private.
 * Each decorated method delegates to routeSuperAdmin which internally routes
 * based on the request URL and method.
 */
@Controller("super-admin/api")
export class SuperAdminController {

  @Get("orgs")
  listOrgs(@Req() req: Request): Promise<Response> {
    return routeSuperAdmin(req);
  }

  @Post("org")
  createOrg(@Req() req: Request): Promise<Response> {
    return routeSuperAdmin(req);
  }

  @Post("org/delete")
  deleteOrg(@Req() req: Request): Promise<Response> {
    return routeSuperAdmin(req);
  }

  @Post("org/seed")
  seedOrg(@Req() req: Request): Promise<Response> {
    return routeSuperAdmin(req);
  }

  @Post("org/seed-sounds")
  seedSounds(@Req() req: Request): Promise<Response> {
    return routeSuperAdmin(req);
  }

  @Post("org/wipe")
  wipeOrg(@Req() req: Request): Promise<Response> {
    return routeSuperAdmin(req);
  }

  @Post("org/impersonate")
  impersonate(@Req() req: Request): Promise<Response> {
    return routeSuperAdmin(req);
  }
}
