/** Redirect endpoint for the Impersonate User modal's "Go" button.
 *
 *  The modal renders a <form method="get" action="/admin/impersonate-go"
 *  target="_blank"> wrapping the user + destination dropdowns. Clicking
 *  Go submits the form with the LIVE values at click time — no HTMX
 *  swap-race against a pre-baked anchor href. We read both params here
 *  and 302 to the chosen destination with ?as=<email> appended so the
 *  destination's middleware applies the impersonation. */

import { define } from "../../lib/define.ts";

const VALID_DESTINATIONS = new Set([
  "/admin/dashboard",
  "/admin/audits",
  "/admin/users",
  "/judge",
  "/judge/dashboard",
  "/review",
  "/review/dashboard",
  "/manager",
  "/manager/audits",
  "/agent",
  "/chat",
]);

export const handler = define.handlers({
  GET(ctx) {
    const url = new URL(ctx.req.url);
    const email = (url.searchParams.get("email") ?? "").trim();
    const destRaw = (url.searchParams.get("dest") ?? "").trim();
    if (!email) return new Response("email required", { status: 400 });
    // Whitelist destinations to keep this from being an open redirector.
    // Any path outside the impersonation menu falls back to the agent home.
    const dest = VALID_DESTINATIONS.has(destRaw) ? destRaw : "/agent";
    const target = `${dest}?as=${encodeURIComponent(email)}`;
    return new Response(null, { status: 302, headers: { Location: target } });
  },
});
