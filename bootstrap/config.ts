/** Application configuration — loaded from environment variables. */

export const config = {
  port: Number(Deno.env.get("PORT") ?? 3000),
  kvUrl: Deno.env.get("KV_URL"),
  selfUrl: Deno.env.get("SELF_URL") ?? "http://localhost:3000",
  defaultOrgId: Deno.env.get("CHARGEBACKS_ORG_ID") ?? Deno.env.get("DEFAULT_ORG_ID") ?? "default",
};
