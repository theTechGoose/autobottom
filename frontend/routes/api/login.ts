/** Login handler — regular form POST, sets cookie, 303 redirects (browser handles natively). */
import { define } from "../../lib/define.ts";
import { roleRedirect } from "../../lib/auth.ts";

const API_URL = () => Deno.env.get("API_URL") ?? "http://localhost:3000";

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const email = form.get("email")?.toString() ?? "";
    const password = form.get("password")?.toString() ?? "";
    console.log(`[LOGIN] attempt: ${email}`);

    if (!email || !password) {
      return new Response(null, { status: 302, headers: { location: "/login" } });
    }

    try {
      const res = await fetch(`${API_URL()}/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      console.log(`[LOGIN] backend response: ${res.status}`, data.error ?? `role=${data.role}`);

      if (!res.ok || data.error) {
        console.log(`[LOGIN] failed: ${data.error}`);
        return new Response(null, { status: 302, headers: { location: "/login" } });
      }

      const redirect = new URL(ctx.req.url).searchParams.get("redirect") ?? roleRedirect(data.role);
      console.log(`[LOGIN] success, cookie set, redirecting to ${redirect}`);
      return new Response(null, {
        status: 303,
        headers: {
          location: redirect,
          "set-cookie": data.cookie,
        },
      });
    } catch (e) {
      console.error(`[LOGIN] error:`, e);
      return new Response(null, { status: 302, headers: { location: "/login" } });
    }
  },
});
