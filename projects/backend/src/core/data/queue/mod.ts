import "reflect-metadata";
import { Injectable } from "@danet/core";
import {
  enqueueStep,
  enqueueCleanup,
} from "./impl.ts";

@Injectable()
export class QueueService {
  enqueueStep = enqueueStep;
  enqueueCleanup = enqueueCleanup;
}
