import { assert } from "#assert";
import { formatTimestamp } from "./mod.ts";
Deno.test("format timestamp", () => { assert(formatTimestamp(Date.now()).includes("T")); });
