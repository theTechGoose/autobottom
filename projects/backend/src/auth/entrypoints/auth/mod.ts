import "reflect-metadata";
import { Controller, Post, Body, Header } from "@danet/core";
import { z } from "zod";
import { AuthCoordinator } from "../../domain/coordinators/auth/mod.ts";
import { validate, ValidationError } from "../../../core/business/validate/mod.ts";

const RegisterSchema = z.object({
  orgName: z.string().min(1),
  email: z.string().email(),
  password: z.string(),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

@Controller("")
export class AuthController {
  constructor(private auth: AuthCoordinator) {}

  @Post("register")
  async register(
    @Body() body: unknown,
  ): Promise<Response> {
    let parsed;
    try {
      parsed = validate(RegisterSchema, body);
    } catch (e) {
      if (e instanceof ValidationError) {
        return new Response(
          JSON.stringify({ error: e.message }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
      throw e;
    }
    const { orgName, email, password } = parsed;

    const passwordError = this.auth.validatePassword(password);
    if (passwordError) {
      return new Response(
        JSON.stringify({ error: passwordError }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const orgId = await this.auth.createOrg(orgName, email);
    await this.auth.createUser(orgId, email, password, "admin");
    const token = await this.auth.createSession({ email, orgId, role: "admin" });

    return new Response(JSON.stringify({ ok: true, orgId }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": this.auth.sessionCookie(token),
      },
    });
  }

  @Post("login")
  async login(
    @Body() body: unknown,
  ): Promise<Response> {
    let parsed;
    try {
      parsed = validate(LoginSchema, body);
    } catch (e) {
      if (e instanceof ValidationError) {
        return new Response(
          JSON.stringify({ error: e.message }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
      throw e;
    }
    const { email, password } = parsed;

    const result = await this.auth.verifyUser(email, password);
    if (!result.ok) {
      if (result.locked) {
        return new Response(
          JSON.stringify({ error: "account locked, try again later" }),
          { status: 429, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ error: "invalid credentials" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    const authCtx = result.auth;
    const token = await this.auth.createSession(authCtx);

    // Determine redirect based on role
    const redirectMap: Record<string, string> = {
      admin: "/admin/dashboard",
      judge: "/judge/dashboard",
      manager: "/manager",
      reviewer: "/review/dashboard",
      user: "/agent",
    };
    const redirect = authCtx.email === "ai@monsterrg.com"
      ? "/super-admin"
      : (redirectMap[authCtx.role] ?? "/");

    return new Response(
      JSON.stringify({ ok: true, role: authCtx.role, redirect }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": this.auth.sessionCookie(token),
        },
      },
    );
  }

  @Post("logout")
  async logout(
    @Header("cookie") cookieHeader: string | null,
  ): Promise<Response> {
    if (cookieHeader) {
      const re = /(?:^|;\s*)session=([^;]+)/;
      const match = cookieHeader.match(re);
      const token = match?.[1] ?? null;
      if (token) await this.auth.deleteSession(token);
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": this.auth.clearSessionCookie(),
      },
    });
  }
}
