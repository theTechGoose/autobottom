import "reflect-metadata";
import { Injectable } from "@danet/core";
import type { AuthGuard, ExecutionContext } from "@danet/core";
import { AuthCoordinator } from "../../coordinators/auth/mod.ts";

@Injectable()
export class SessionGuard implements AuthGuard {
  constructor(private auth: AuthCoordinator) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req: Request = context.req.raw;
    const authCtx = await this.auth.resolveEffectiveAuth(req);
    if (!authCtx) return false;
    context.set("authContext", authCtx);

    const token = this.auth.parseCookie(req, "session");
    if (token) {
      const refreshed = await this.auth.refreshSession(token);
      if (refreshed) {
        context.res.headers.set("Set-Cookie", this.auth.sessionCookie(token));
      }
    }

    return true;
  }
}
