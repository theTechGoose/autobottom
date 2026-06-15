import { assert } from "#assert";
import { isTransientPrepareError } from "./mod.ts";

Deno.test("prepare — step function exists", async () => {
  const mod = await import("./mod.ts");
  assert(typeof Object.values(mod)[0] === "function");
});

Deno.test("isTransientPrepareError — abort/timeout/network messages classify transient", () => {
  // These are recoverable: QStash retry / the watchdog re-drives the step.
  assert(isTransientPrepareError("The signal has been aborted"));
  assert(isTransientPrepareError("AbortError: The signal has been aborted"));
  assert(isTransientPrepareError("QB question fetch timed out after 90s (dest=123)"));
  assert(isTransientPrepareError("OpenAI embed timed out after 30s"));
  assert(isTransientPrepareError("http2 error: stream reset"));
  assert(isTransientPrepareError("deadline exceeded"));
  assert(isTransientPrepareError("error sending request: client error (Connect)"));
});

Deno.test("isTransientPrepareError — data/config faults classify NOT transient", () => {
  // These are genuine fatals — a re-drive won't help; needs investigation.
  // (Note: a literal "finding not found" never reaches the 500 catch — it's a
  // 404 returned before the failure paths — so the fatal cases use messages
  // that are actually thrown downstream.)
  assert(!isTransientPrepareError("questions config missing for destination"));
  assert(!isTransientPrepareError("undefined is not a function"));
  assert(!isTransientPrepareError("Cannot read properties of null"));
});

Deno.test("isTransientPrepareError — \\b anchors require the full token 'aborted'", () => {
  // A bare "abort" must NOT match — only the full word "aborted".
  assert(!isTransientPrepareError("user requested abort"));
});
