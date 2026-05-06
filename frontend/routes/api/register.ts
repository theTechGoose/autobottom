/** Register handler — regular form POST, sets cookie, 303 redirects (browser handles natively). */
import { define } from "../../lib/define.ts";

const API_URL = () => Deno.env.get("API_URL") ?? "http://localhost:3000";

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const orgName = form.get("orgName")?.toString() ?? "";
    const email = form.get("email")?.toString() ?? "";
    const password = form.get("password")?.toString() ?? "";
    console.log(`[REGISTER] attempt: ${email} org=${orgName}`);

    if (!email || !password || !orgName) {
      return new Response(null, { status: 302, headers: { location: "/register" } });
    }

    try {
      const res = await fetch(`${API_URL()}/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgName, email, password }),
      });
      const data = await res.json();
      console.log(`[REGISTER] backend response: ${res.status}`, JSON.stringify(data).slice(0, 200));

      if (!res.ok || data.error) {
        console.log(`[REGISTER] failed: ${data.error}`);
        return new Response(null, { status: 302, headers: { location: "/register" } });
      }

      console.log(`[REGISTER] success, cookie set, redirecting to /admin/dashboard`);
      return new Response(null, {
        status: 303,
        headers: {
          location: "/admin/dashboard",
          "set-cookie": data.cookie,
        },
      });
    } catch (e) {
      console.error(`[REGISTER] error:`, e);
      return new Response(null, { status: 302, headers: { location: "/register" } });
    }
  },
});
