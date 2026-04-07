import "reflect-metadata";
import { Injectable } from "@danet/core";
import {
  populateReviewQueue,
  claimNextItem,
  recordDecision,
  undoDecision,
  getReviewStats,
  getReviewerDashboardData,
  backfillFromFinished,
} from "./impl.ts";

@Injectable()
export class ReviewCoordinator {
  populateReviewQueue = populateReviewQueue;
  claimNextItem = claimNextItem;
  recordDecision = recordDecision;
  undoDecision = undoDecision;
  getReviewStats = getReviewStats;
  getReviewerDashboardData = getReviewerDashboardData;
  backfillFromFinished = backfillFromFinished;
}

// Re-export types for consumers
export type {
  ReviewItem,
  ReviewDecision,
  ReviewerLeaderboardEntry,
  ReviewerDashboardData,
} from "./impl.ts";
