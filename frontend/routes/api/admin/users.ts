/** HTMX handlers for user CRUD. */
import { define } from "../../../lib/define.ts";

const API_URL = () => Deno.env.get("API_URL") ?? "http://localhost:3000";

async function proxyPost(ctx: { req: Request }, path: string, body: unknown) {
  const cookie = ctx.req.headers.get("cookie") ?? "";
  return fetch(`${API_URL()}${path}`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export const handler = define.handlers({
  // Add user — called as /api/admin/users/add via HTMX form
  // But since Fresh routes this file as /api/admin/users, we use POST
  async POST(ctx) {
    const form = await ctx.req.formData();
    const email = form.get("email")?.toString() ?? "";
    const password = form.get("password")?.toString() ?? "";
    const role = form.get("role")?.toString() ?? "reviewer";
    const supervisor = form.get("supervisor")?.toString() || undefined;

    if (!email || !password) {
      return new Response(`<span class="error-text">Email and password required</span>`, {
        headers: { "content-type": "text/html" },
      });
    }

    try {
      const res = await proxyPost(ctx, "/admin/users", { email, password, role, supervisor });
      const data = await res.json();
      if (!res.ok || data.error) {
        return new Response(`<span class="error-text">${data.error ?? "Failed to create user"}</span>`, {
          headers: { "content-type": "text/html" },
        });
      }
      return new Response(null, { status: 303, headers: { location: "/admin/users", "hx-redirect": "/admin/users" } });
    } catch {
      return new Response(`<span class="error-text">Network error</span>`, {
        headers: { "content-type": "text/html" },
      });
    }
  },
});
