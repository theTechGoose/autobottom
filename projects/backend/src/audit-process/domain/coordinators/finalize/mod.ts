import "reflect-metadata";
import { Injectable } from "@danet/core";
import { stepFinalize } from "./impl.ts";

@Injectable()
export class FinalizeStepCoordinator {
  execute(req: Request): Promise<Response> {
    return stepFinalize(req);
  }
}
