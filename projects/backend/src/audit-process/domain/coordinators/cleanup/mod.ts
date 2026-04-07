import "reflect-metadata";
import { Injectable } from "@danet/core";
import { stepCleanup } from "./impl.ts";

@Injectable()
export class CleanupStepCoordinator {
  execute(req: Request): Promise<Response> {
    return stepCleanup(req);
  }
}
