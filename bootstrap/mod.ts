/**
 * Deno Deploy entrypoint shim.
 *
 * This file exists to give the project a `bootstrap/mod.ts` entrypoint that
 * matches the refactor branch's layout, so both branches can deploy against
 * the same Deno Deploy project settings.
 *
 * It does nothing except import `main.ts` for its side effects (starting the
 * HTTP server, registering the cron, initializing OTel, etc.). All real code
 * still lives in main.ts with its existing relative imports intact — moving
 * the file would have required rewriting 47+ import paths.
 */
import "../main.ts";
