import { Module } from "@danet/core";
import { GamificationPageController } from "@gamification/entrypoints/gamification-controller.ts";
import { BadgeStoreController } from "@gamification/entrypoints/badge-controller.ts";

@Module({
  controllers: [GamificationPageController, BadgeStoreController],
  injectables: [],
})
export class GamificationModule {}
