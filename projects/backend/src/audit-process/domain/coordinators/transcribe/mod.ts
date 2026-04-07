import "reflect-metadata";
import { Injectable } from "@danet/core";
import { stepTranscribe } from "./impl.ts";

@Injectable()
export class TranscribeStepCoordinator {
  execute(req: Request): Promise<Response> {
    return stepTranscribe(req);
  }
}
