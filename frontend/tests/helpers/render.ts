/** Test helpers for component rendering via preact-render-to-string. */
import { renderToString } from "preact-render-to-string";
import type { VNode } from "preact";
import { assert } from "@std/assert";

export function renderHTML(vnode: VNode): string {
  return renderToString(vnode);
}

export function assertContains(html: string, substring: string, msg?: string) {
  assert(html.includes(substring), msg ?? `Expected HTML to contain "${substring}" but it didn't.\nHTML: ${html.slice(0, 500)}`);
}

export function assertNotContains(html: string, substring: string, msg?: string) {
  assert(!html.includes(substring), msg ?? `Expected HTML to NOT contain "${substring}" but it did.\nHTML: ${html.slice(0, 500)}`);
}
