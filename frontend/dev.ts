import { App, staticFiles } from "@fresh/core";
import type { State } from "./lib/auth.ts";

const app = new App<State>();
app.use(staticFiles());
app.fsRoutes();

await app.listen({ port: 8000 });
