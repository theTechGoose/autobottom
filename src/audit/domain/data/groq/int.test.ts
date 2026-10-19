/** askQuestion fallback on Groq's "output_parse_failed" 400.
 *
 *  Groq scripted via the __setGroqTestFetch seam (no network). */

import { assertEquals } from "#assert";
import { __setGroqTestFetch, askQuestion } from "./mod.ts";

Deno.test("REQ-012: an output_parse_failed 400 falls back to the next model instead of storing the error", async () => {
  const models: string[] = [];
  __setGroqTestFetch(async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    models.push(body.model);
    if (models.length === 1) {
      // Verbatim body from rrJvbO40W1Vk49iGFt7XC q[17] "Matching IDs".
      return new Response(JSON.stringify({
        error: {
          message: "Parsing failed. The model generated output that could not be parsed. Please adjust your prompt. See 'failed_generation' for more details.",
          type: "invalid_request_error",
          code: "output_parse_failed",
          failed_generation: "",
        },
      }), { status: 400, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      id: "c", object: "chat.completion", created: 0, model: body.model,
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({ thinking: "t", defense: "d", answer: "Yes" }) } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  try {
    const res = await askQuestion("Did the IDs match?", "[AGENT]: hi");
    assertEquals(res.answer, "Yes");
    assertEquals(models, ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]);
  } finally {
    __setGroqTestFetch(undefined);
  }
});
