import "reflect-metadata";
import { Injectable } from "@danet/core";
import { stepInit } from "./impl.ts";

@Injectable()
export class InitStepCoordinator {
  execute(req: Request): Promise<Response> {
    return stepInit(req);
  }
}
