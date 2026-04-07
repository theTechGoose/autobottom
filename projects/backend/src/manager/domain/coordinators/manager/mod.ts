import "reflect-metadata";
import { Injectable } from "@danet/core";
import {
  populateManagerQueue,
  getManagerQueue,
  getManagerFindingDetail,
  submitRemediation,
  getManagerStats,
  backfillManagerQueue,
} from "./impl.ts";

@Injectable()
export class ManagerCoordinator {
  populateManagerQueue = populateManagerQueue;
  getManagerQueue = getManagerQueue;
  getManagerFindingDetail = getManagerFindingDetail;
  submitRemediation = submitRemediation;
  getManagerStats = getManagerStats;
  backfillManagerQueue = backfillManagerQueue;
}

// Re-export types for consumers
export type {
  ManagerQueueItem,
  ManagerRemediation,
  RemediationResult,
} from "./impl.ts";
