import { Module } from "@danet/core";
import { ReviewController } from "@review/entrypoints/review/mod.ts";

export { populateReviewQueue, selectOldestFinding, recordDecision, getReviewStats, getReviewedFindingIds, clearReviewQueue } from "@review/domain/business/review-queue/mod.ts";

@Module({
  controllers: [ReviewController],
  injectables: [],
})
export class ReviewModule {}
