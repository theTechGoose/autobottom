import { Module } from "@danet/core";
import { GamificationPageController } from "@gamification/entrypoints/gamification/mod.ts";
import { BadgeStoreController } from "@gamification/entrypoints/badge/mod.ts";

@Module({
  controllers: [GamificationPageController, BadgeStoreController],
  injectables: [],
})
export class GamificationModule {}
