/** The appeal modals only render once a button is clicked, so server-rendered
 *  HTML can't show their text. This reads the island's source instead: with
 *  comments stripped, nothing left (copy, labels, placeholders, error strings)
 *  may carry an em dash. The e2e story checks the same thing on the open
 *  modals. */
import { assertEquals } from "@std/assert";

Deno.test("REQ-024: no em dash anywhere a user reads in the three modals", async () => {
  const src = await Deno.readTextFile(new URL("../../islands/AppealModal.tsx", import.meta.url));
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/^\s*\/\/.*$/, ""))
    .join("\n");
  const hits = code.split("\n").filter((l) => l.includes("—"));
  assertEquals(hits, [], "user-facing text must not contain an em dash");
});
