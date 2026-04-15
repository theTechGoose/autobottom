import { App, staticFiles } from "@fresh/core";
import type { State } from "./lib/auth.ts";

export const app = new App<State>();
app.use(staticFiles());
app.fsRoutes();

// Only start standalone server when run directly (not when imported by _fresh/server.js or main.ts)
if (import.meta.main) {
  const port = Number(Deno.env.get("PORT") ?? 8000);
  await app.listen({ port });
}
