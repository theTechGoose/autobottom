/** Pipeline step controller — receives QStash callbacks for each audit step.
 *  Each method is a thin entrypoint that delegates to the actual step logic.
 *  Step implementations will be ported as business features. Stubs for now. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Post, Body } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";

@SwaggerDescription("Pipeline steps — QStash callback endpoints for audit processing")
@Controller("audit/step")
export class StepController {

  @Post("init")
  async init(@Body() body: Record<string, any>) {
    console.log(`📋 [STEP] init: findingId=${body.findingId}`);
    return { ok: true, step: "init", findingId: body.findingId };
  }

  @Post("transcribe")
  async transcribe(@Body() body: Record<string, any>) {
    console.log(`📋 [STEP] transcribe: findingId=${body.findingId}`);
    return { ok: true, step: "transcribe", findingId: body.findingId };
  }

  @Post("poll-transcript")
  async pollTranscript(@Body() body: Record<string, any>) {
    console.log(`📋 [STEP] poll-transcript: findingId=${body.findingId}`);
    return { ok: true, step: "poll-transcript", findingId: body.findingId };
  }

  @Post("transcribe-complete")
  async transcribeComplete(@Body() body: Record<string, any>) {
    console.log(`📋 [STEP] transcribe-complete: findingId=${body.findingId}`);
    return { ok: true, step: "transcribe-complete", findingId: body.findingId };
  }

  @Post("diarize-async")
  async diarizeAsync(@Body() body: Record<string, any>) {
    console.log(`📋 [STEP] diarize-async: findingId=${body.findingId}`);
    return { ok: true, step: "diarize-async", findingId: body.findingId };
  }

  @Post("pinecone-async")
  async pineconeAsync(@Body() body: Record<string, any>) {
    console.log(`📋 [STEP] pinecone-async: findingId=${body.findingId}`);
    return { ok: true, step: "pinecone-async", findingId: body.findingId };
  }

  @Post("prepare")
  async prepare(@Body() body: Record<string, any>) {
    console.log(`📋 [STEP] prepare: findingId=${body.findingId}`);
    return { ok: true, step: "prepare", findingId: body.findingId };
  }

  @Post("ask-batch")
  async askBatch(@Body() body: Record<string, any>) {
    console.log(`📋 [STEP] ask-batch: findingId=${body.findingId}`);
    return { ok: true, step: "ask-batch", findingId: body.findingId };
  }

  @Post("ask-all")
  async askAll(@Body() body: Record<string, any>) {
    console.log(`📋 [STEP] ask-all: findingId=${body.findingId}`);
    return { ok: true, step: "ask-all", findingId: body.findingId };
  }

  @Post("finalize")
  async finalize(@Body() body: Record<string, any>) {
    console.log(`📋 [STEP] finalize: findingId=${body.findingId}`);
    return { ok: true, step: "finalize", findingId: body.findingId };
  }

  @Post("cleanup")
  async cleanup(@Body() body: Record<string, any>) {
    console.log(`📋 [STEP] cleanup: findingId=${body.findingId}`);
    return { ok: true, step: "cleanup", findingId: body.findingId };
  }

  @Post("bad-word-check")
  async badWordCheck(@Body() body: Record<string, any>) {
    console.log(`📋 [STEP] bad-word-check: findingId=${body.findingId}`);
    return { ok: true, step: "bad-word-check", findingId: body.findingId };
  }
}
