/** Pipeline step controller — delegates to original step implementations.
 *  Each step receives the raw request and returns the step's response body. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Post, Req } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import {
  stepInit, stepTranscribe, stepTranscribeCb, stepPollTranscript,
  stepDiarizeAsync, stepPineconeAsync, stepPrepare,
  stepAskBatch, stepAskAll, stepFinalize, stepCleanup, stepBadWordCheck,
} from "@audit/domain/business/pipeline-orchestrator/mod.ts";

/** Call an original step handler (which returns Response) and extract its JSON body. */
async function callStep(stepFn: (req: Request) => Promise<Response>, req: Request) {
  const response = await stepFn(req);
  try { return await response.json(); }
  catch { return { ok: true }; }
}

@SwaggerDescription("Pipeline steps — QStash callback endpoints for audit processing")
@Controller("audit/step")
export class StepController {

  @Post("init")
  async init(@Req req: Request) { return callStep(stepInit, req); }

  @Post("transcribe")
  async transcribe(@Req req: Request) { return callStep(stepTranscribe, req); }

  @Post("poll-transcript")
  async pollTranscript(@Req req: Request) { return callStep(stepPollTranscript, req); }

  @Post("transcribe-complete")
  async transcribeComplete(@Req req: Request) { return callStep(stepTranscribeCb, req); }

  @Post("diarize-async")
  async diarizeAsync(@Req req: Request) { return callStep(stepDiarizeAsync, req); }

  @Post("pinecone-async")
  async pineconeAsync(@Req req: Request) { return callStep(stepPineconeAsync, req); }

  @Post("prepare")
  async prepare(@Req req: Request) { return callStep(stepPrepare, req); }

  @Post("ask-batch")
  async askBatch(@Req req: Request) { return callStep(stepAskBatch, req); }

  @Post("ask-all")
  async askAll(@Req req: Request) { return callStep(stepAskAll, req); }

  @Post("finalize")
  async finalize(@Req req: Request) { return callStep(stepFinalize, req); }

  @Post("cleanup")
  async cleanup(@Req req: Request) { return callStep(stepCleanup, req); }

  @Post("bad-word-check")
  async badWordCheck(@Req req: Request) { return callStep(stepBadWordCheck, req); }
}
