import "reflect-metadata";
import { Injectable } from "@danet/core";
import {
  populateJudgeQueue,
  claimNextItem,
  recordDecision,
  undoDecision,
  getJudgeStats,
  getAppealStats,
  getJudgeDashboardData,
  getAppeal,
  saveAppeal,
} from "./impl.ts";

@Injectable()
export class JudgeCoordinator {
  populateJudgeQueue = populateJudgeQueue;
  claimNextItem = claimNextItem;
  recordDecision = recordDecision;
  undoDecision = undoDecision;
  getJudgeStats = getJudgeStats;
  getAppealStats = getAppealStats;
  getJudgeDashboardData = getJudgeDashboardData;
  getAppeal = getAppeal;
  saveAppeal = saveAppeal;
}

// Re-export types for consumers
export type {
  JudgeItem,
  JudgeDecision,
  AppealRecord,
  AppealStats,
  AppealHistory,
} from "./impl.ts";
