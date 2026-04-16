/** Pipeline step controller — NEUTRALIZED.
 *
 *  Historical note: this controller used `@Req` to grab the raw Request and
 *  delegate to the step business logic. That pattern crashes when reached via
 *  `router.fetch()` (our unified entrypoint in main.ts) because danet's @Req
 *  decorator returns `undefined` in that path. See repo-root plan for full
 *  investigation.
 *
 *  All step callbacks from QStash are now dispatched DIRECTLY in main.ts
 *  (see STEP_HANDLERS map there) BEFORE the request reaches danet. These
 *  stub methods exist only so the controller still registers with danet —
 *  nothing should ever actually hit them. If something does, we return a
 *  clear error instead of the cryptic @Req crash.
 */
import "npm:reflect-metadata@0.1.13";
import { Controller, Post } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { ReturnedType, Description } from "#danet/swagger-decorators";
import { StepResponse } from "@core/dto/responses.ts";

const MOVED_NOTE = "step callbacks are dispatched directly from main.ts; this controller is a no-op stub";

function movedStub() {
  return { ok: false, moved: true, note: MOVED_NOTE };
}

@SwaggerDescription("Pipeline steps — handled directly in main.ts, this controller is a no-op stub")
@Controller("audit/step")
export class StepController {
  @Post("init") @ReturnedType(StepResponse) @Description("moved to main.ts direct dispatch")
  init() { return movedStub(); }

  @Post("transcribe") @ReturnedType(StepResponse) @Description("moved to main.ts direct dispatch")
  transcribe() { return movedStub(); }

  @Post("poll-transcript") @ReturnedType(StepResponse) @Description("moved to main.ts direct dispatch")
  pollTranscript() { return movedStub(); }

  @Post("transcribe-complete") @ReturnedType(StepResponse) @Description("moved to main.ts direct dispatch")
  transcribeComplete() { return movedStub(); }

  @Post("diarize-async") @ReturnedType(StepResponse) @Description("moved to main.ts direct dispatch")
  diarizeAsync() { return movedStub(); }

  @Post("pinecone-async") @ReturnedType(StepResponse) @Description("moved to main.ts direct dispatch")
  pineconeAsync() { return movedStub(); }

  @Post("prepare") @ReturnedType(StepResponse) @Description("moved to main.ts direct dispatch")
  prepare() { return movedStub(); }

  @Post("ask-batch") @ReturnedType(StepResponse) @Description("moved to main.ts direct dispatch")
  askBatch() { return movedStub(); }

  @Post("ask-all") @ReturnedType(StepResponse) @Description("moved to main.ts direct dispatch")
  askAll() { return movedStub(); }

  @Post("finalize") @ReturnedType(StepResponse) @Description("moved to main.ts direct dispatch")
  finalize() { return movedStub(); }

  @Post("cleanup") @ReturnedType(StepResponse) @Description("moved to main.ts direct dispatch")
  cleanup() { return movedStub(); }

  @Post("bad-word-check") @ReturnedType(StepResponse) @Description("moved to main.ts direct dispatch")
  badWordCheck() { return movedStub(); }
}
