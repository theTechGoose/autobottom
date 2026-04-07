import "reflect-metadata";
import { Injectable } from "@danet/core";
import { stepTranscribeCb } from "./impl.ts";

@Injectable()
export class DiarizeStepCoordinator {
  execute(req: Request): Promise<Response> {
    return stepTranscribeCb(req);
  }
}
