/** Logout — clears session cookie, redirects to login. */
import { define } from "../../lib/define.ts";
import type { State } from "../../lib/auth.ts";

export const handler = define.handlers({
  GET() {
    return new Response(null, {
      status: 302,
      headers: {
        location: "/login",
        "set-cookie": "session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax",
      },
    });
  },
});
