/** HTMX register handler — proxies to backend, sets session cookie, redirects. */
import { define } from "../../lib/define.ts";
import type { State } from "../../lib/auth.ts";

const API_URL = () => Deno.env.get("API_URL") ?? "http://localhost:3000";

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const orgName = form.get("orgName")?.toString() ?? "";
    const email = form.get("email")?.toString() ?? "";
    const password = form.get("password")?.toString() ?? "";

    if (!email || !password || !orgName) {
      return new Response(`<span class="error-text">All fields required</span>`, {
        headers: { "content-type": "text/html" },
      });
    }

    try {
      const res = await fetch(`${API_URL()}/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgName, email, password }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        return new Response(`<span class="error-text">${data.error ?? "Registration failed"}</span>`, {
          headers: { "content-type": "text/html" },
        });
      }

      return new Response(null, {
        status: 303,
        headers: {
          location: "/admin/dashboard",
          "set-cookie": data.cookie,
          "hx-redirect": "/admin/dashboard",
        },
      });
    } catch {
      return new Response(`<span class="error-text">Network error — is the API running?</span>`, {
        headers: { "content-type": "text/html" },
      });
    }
  },
});
