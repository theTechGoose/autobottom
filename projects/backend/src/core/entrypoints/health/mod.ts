import "reflect-metadata";
import { Controller, Get } from "@danet/core";
import { kvFactory } from "../../data/kv/factory.ts";

@Controller("")
export class HealthController {
  /** Liveness probe — always returns 200 if the process is running. */
  @Get("health")
  check() {
    return { ok: true, ts: Date.now() };
  }

  /** Readiness probe — checks KV connectivity. Returns 503 if any dependency is down. */
  @Get("health/ready")
  async ready() {
    const deps: Record<string, "ok" | "error"> = { kv: "error" };

    try {
      const db = await kvFactory();
      await db.set(["health-check"], { ts: Date.now() });
      const entry = await db.get(["health-check"]);
      deps.kv = entry.value ? "ok" : "error";
    } catch {
      deps.kv = "error";
    }

    const allOk = Object.values(deps).every((v) => v === "ok");
    return new Response(
      JSON.stringify({ ok: allOk, ts: Date.now(), dependencies: deps }),
      {
        status: allOk ? 200 : 503,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
