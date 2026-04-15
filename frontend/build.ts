/** Build step — generates _fresh/ directory with pre-scanned routes. */
import { App, staticFiles } from "@fresh/core";
import { Builder } from "@fresh/core/dev";
import type { State } from "./lib/auth.ts";

const app = new App<State>();
app.use(staticFiles());
app.fsRoutes();

const builder = new Builder();
await builder.build(app);
console.log("Build complete");
