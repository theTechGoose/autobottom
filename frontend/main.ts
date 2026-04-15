import { App, staticFiles } from "@fresh/core";
import type { State } from "./lib/auth.ts";

const app = new App<State>();
app.use(staticFiles());
app.fsRoutes();

const port = Number(Deno.env.get("PORT") ?? 8000);
await app.listen({ port });
