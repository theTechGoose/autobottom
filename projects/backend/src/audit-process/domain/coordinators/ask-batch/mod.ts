import "reflect-metadata";
import { Injectable } from "@danet/core";
import { stepAskBatch } from "./impl.ts";

@Injectable()
export class AskBatchStepCoordinator {
  execute(req: Request): Promise<Response> {
    return stepAskBatch(req);
  }
}
