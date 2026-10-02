/** The login / register pages' "Create organization" / "Sign in" links were
 *  15px tall — under the 24×24 minimum a person can reliably hit. */
import { assert } from "@std/assert";

const css = await Deno.readTextFile(new URL("../../static/styles.css", import.meta.url));

function rule(selector: string): string {
  const m = css.match(new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
  return m?.[2] ?? "";
}

Deno.test("REQ-006: the auth-page links are at least a 24px hit target", () => {
  const body = rule(".auth-link a");
  assert(/display:\s*inline-block/.test(body), `.auth-link a must be inline-block to take a height — got: ${body}`);
  const h = Number(body.match(/min-height:\s*(\d+)px/)?.[1] ?? 0);
  assert(h >= 24, `.auth-link a min-height must be >= 24px — got: ${body}`);
});
