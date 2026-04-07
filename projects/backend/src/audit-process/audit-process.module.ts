import "reflect-metadata";
import { Module } from "@danet/core";

import { InitStepCoordinator } from "./domain/coordinators/init/mod.ts";
import { TranscribeStepCoordinator } from "./domain/coordinators/transcribe/mod.ts";
import { DiarizeStepCoordinator } from "./domain/coordinators/diarize/mod.ts";
import { PrepareStepCoordinator } from "./domain/coordinators/prepare/mod.ts";
import { AskBatchStepCoordinator } from "./domain/coordinators/ask-batch/mod.ts";
import { FinalizeStepCoordinator } from "./domain/coordinators/finalize/mod.ts";
import { CleanupStepCoordinator } from "./domain/coordinators/cleanup/mod.ts";

import { AuditProcessController } from "./entrypoints/audit-process/mod.ts";

@Module({
  injectables: [
    InitStepCoordinator,
    TranscribeStepCoordinator,
    DiarizeStepCoordinator,
    PrepareStepCoordinator,
    AskBatchStepCoordinator,
    FinalizeStepCoordinator,
    CleanupStepCoordinator,
  ],
  controllers: [
    AuditProcessController,
  ],
})
export class AuditProcessModule {}
