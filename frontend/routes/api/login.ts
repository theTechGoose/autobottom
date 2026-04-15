/** HTMX login handler — proxies to backend, sets session cookie, redirects. */
import { define } from "../../lib/define.ts";
import type { State } from "../../lib/auth.ts";
import { roleRedirect } from "../../lib/auth.ts";

const API_URL = () => Deno.env.get("API_URL") ?? "http://localhost:3000";

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const email = form.get("email")?.toString() ?? "";
    const password = form.get("password")?.toString() ?? "";

    if (!email || !password) {
      return new Response(`<span class="error-text">Email and password required</span>`, {
        headers: { "content-type": "text/html" },
      });
    }

    try {
      const res = await fetch(`${API_URL()}/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        return new Response(`<span class="error-text">${data.error ?? "Invalid credentials"}</span>`, {
          headers: { "content-type": "text/html" },
        });
      }

      const redirect = new URL(ctx.req.url).searchParams.get("redirect") ?? roleRedirect(data.role);
      return new Response(null, {
        status: 303,
        headers: {
          location: redirect,
          "set-cookie": data.cookie,
          "HX-Redirect": redirect,
        },
      });
    } catch {
      return new Response(`<span class="error-text">Network error — is the API running?</span>`, {
        headers: { "content-type": "text/html" },
      });
    }
  },
});
