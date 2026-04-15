/** HTMX register handler — proxies to backend, sets session cookie, redirects. */
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
      console.log(`[REGISTER] backend response: ${res.status}`, JSON.stringify(data).slice(0, 200));

      if (!res.ok || data.error) {
        return new Response(`<span class="error-text">${data.error ?? "Registration failed"}</span>`, {
          headers: { "content-type": "text/html" },
        });
      }

      // Return 200 with HX-Redirect — NOT 303.
      // HTMX follows 303 redirects via AJAX before reading HX-Redirect,
      // which causes the redirected page HTML to get swapped into the form.
      // A 200 with HX-Redirect tells HTMX to do window.location = url.
      console.log(`[REGISTER] success, redirecting to /admin/dashboard`);
      return new Response(null, {
        status: 200,
        headers: {
          "set-cookie": data.cookie,
          "HX-Redirect": "/admin/dashboard",
        },
      });
    } catch (e) {
      console.error(`[REGISTER] error:`, e);
      return new Response(`<span class="error-text">Network error — is the API running?</span>`, {
        headers: { "content-type": "text/html" },
      });
    }
  },
});
