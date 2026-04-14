/** Pipeline step controller — delegates to original step implementations. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Post, Req } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { ReturnedType, Description } from "#danet/swagger-decorators";
import { StepResponse } from "@core/dto/responses.ts";
import {
  stepInit, stepTranscribe, stepTranscribeCb, stepPollTranscript,
  stepDiarizeAsync, stepPineconeAsync, stepPrepare,
  stepAskBatch, stepAskAll, stepFinalize, stepCleanup, stepBadWordCheck,
} from "@audit/mod-root.ts";

async function callStep(stepFn: (req: Request) => Promise<Response>, req: Request) {
  const response = await stepFn(req);
  try { return await response.json(); }
  catch { return { ok: true }; }
}

@SwaggerDescription("Pipeline steps — QStash callback endpoints for audit processing")
@Controller("audit/step")
export class StepController {

  @Post("init") @ReturnedType(StepResponse) @Description("Initialize audit — fetch recording, save to S3")
  async init(@Req req: Request) { return callStep(stepInit, req); }

  @Post("transcribe") @ReturnedType(StepResponse) @Description("Submit audio for transcription")
  async transcribe(@Req req: Request) { return callStep(stepTranscribe, req); }

  @Post("poll-transcript") @ReturnedType(StepResponse) @Description("Poll transcription status")
  async pollTranscript(@Req req: Request) { return callStep(stepPollTranscript, req); }

  @Post("transcribe-complete") @ReturnedType(StepResponse) @Description("Handle transcription completion callback")
  async transcribeComplete(@Req req: Request) { return callStep(stepTranscribeCb, req); }

  @Post("diarize-async") @ReturnedType(StepResponse) @Description("Speaker diarization via LLM")
  async diarizeAsync(@Req req: Request) { return callStep(stepDiarizeAsync, req); }

  @Post("pinecone-async") @ReturnedType(StepResponse) @Description("Upload transcript to vector store")
  async pineconeAsync(@Req req: Request) { return callStep(stepPineconeAsync, req); }

  @Post("prepare") @ReturnedType(StepResponse) @Description("Prepare questions for audit")
  async prepare(@Req req: Request) { return callStep(stepPrepare, req); }

  @Post("ask-batch") @ReturnedType(StepResponse) @Description("Ask a batch of audit questions via LLM")
  async askBatch(@Req req: Request) { return callStep(stepAskBatch, req); }

  @Post("ask-all") @ReturnedType(StepResponse) @Description("Ask all remaining questions")
  async askAll(@Req req: Request) { return callStep(stepAskAll, req); }

  @Post("finalize") @ReturnedType(StepResponse) @Description("Finalize audit — score, chargebacks, queue routing")
  async finalize(@Req req: Request) { return callStep(stepFinalize, req); }

  @Post("cleanup") @ReturnedType(StepResponse) @Description("Clean up temporary data after audit")
  async cleanup(@Req req: Request) { return callStep(stepCleanup, req); }

  @Post("bad-word-check") @ReturnedType(StepResponse) @Description("Scan transcript for profanity")
  async badWordCheck(@Req req: Request) { return callStep(stepBadWordCheck, req); }
}
