import "reflect-metadata";
import { Injectable } from "@danet/core";
import type { AuthGuard, ExecutionContext } from "@danet/core";
import { AuthCoordinator } from "../../coordinators/auth/mod.ts";

@Injectable()
export class AdminGuard implements AuthGuard {
  constructor(private auth: AuthCoordinator) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req: Request = context.req.raw;
    const authCtx = await this.auth.authenticate(req);
    if (!authCtx) return false;
    if (authCtx.role !== "admin") return false;
    context.set("authContext", authCtx);
    return true;
  }
}
