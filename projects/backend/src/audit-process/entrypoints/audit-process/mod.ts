import "reflect-metadata";
import { Controller, Post, Req } from "@danet/core";

import { InitStepCoordinator } from "../../domain/coordinators/init/mod.ts";
import { TranscribeStepCoordinator } from "../../domain/coordinators/transcribe/mod.ts";
import { DiarizeStepCoordinator } from "../../domain/coordinators/diarize/mod.ts";
import { PrepareStepCoordinator } from "../../domain/coordinators/prepare/mod.ts";
import { AskBatchStepCoordinator } from "../../domain/coordinators/ask-batch/mod.ts";
import { FinalizeStepCoordinator } from "../../domain/coordinators/finalize/mod.ts";
import { CleanupStepCoordinator } from "../../domain/coordinators/cleanup/mod.ts";

// Danet's @Req() decorator type is incompatible with experimentalDecorators; cast to ParameterDecorator.
const ReqParam: () => ParameterDecorator = Req as any;

@Controller("audit-process")
export class AuditProcessController {
  constructor(
    private init: InitStepCoordinator,
    private transcribe: TranscribeStepCoordinator,
    private diarize: DiarizeStepCoordinator,
    private prepare: PrepareStepCoordinator,
    private askBatch: AskBatchStepCoordinator,
    private finalize: FinalizeStepCoordinator,
    private cleanup: CleanupStepCoordinator,
  ) {}

  @Post("init")
  stepInit(@ReqParam() req: Request): Promise<Response> {
    return this.init.execute(req);
  }

  @Post("transcribe")
  stepTranscribe(@ReqParam() req: Request): Promise<Response> {
    return this.transcribe.execute(req);
  }

  @Post("transcribe-complete")
  stepDiarize(@ReqParam() req: Request): Promise<Response> {
    return this.diarize.execute(req);
  }

  @Post("prepare")
  stepPrepare(@ReqParam() req: Request): Promise<Response> {
    return this.prepare.execute(req);
  }

  @Post("ask-batch")
  stepAskBatch(@ReqParam() req: Request): Promise<Response> {
    return this.askBatch.execute(req);
  }

  @Post("finalize")
  stepFinalize(@ReqParam() req: Request): Promise<Response> {
    return this.finalize.execute(req);
  }

  @Post("cleanup")
  stepCleanup(@ReqParam() req: Request): Promise<Response> {
    return this.cleanup.execute(req);
  }
}
