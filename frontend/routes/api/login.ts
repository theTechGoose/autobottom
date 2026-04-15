/** HTMX login handler — proxies to backend, sets session cookie, redirects. */
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
      console.log(`[LOGIN] backend response: ${res.status}`, data.error ?? `role=${data.role}`);

      if (!res.ok || data.error) {
        return new Response(`<span class="error-text">${data.error ?? "Invalid credentials"}</span>`, {
          headers: { "content-type": "text/html" },
        });
      }

      const redirect = new URL(ctx.req.url).searchParams.get("redirect") ?? roleRedirect(data.role);
      console.log(`[LOGIN] success, redirecting to ${redirect}`);
      return new Response(null, {
        status: 200,
        headers: {
          "set-cookie": data.cookie,
          "HX-Redirect": redirect,
        },
      });
    } catch (e) {
      console.error(`[LOGIN] error:`, e);
      return new Response(`<span class="error-text">Network error — is the API running?</span>`, {
        headers: { "content-type": "text/html" },
      });
    }
  },
});
