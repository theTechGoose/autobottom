import "reflect-metadata";
import { Injectable } from "@danet/core";
import { stepPrepare } from "./impl.ts";

@Injectable()
export class PrepareStepCoordinator {
  execute(req: Request): Promise<Response> {
    return stepPrepare(req);
  }
}
