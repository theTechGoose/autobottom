import "reflect-metadata";
import { Module } from "@danet/core";
import { CoreModule } from "../core/core.module.ts";
import { AuthModule } from "../auth/auth.module.ts";
import { GamificationController } from "./entrypoints/gamification/mod.ts";
import { ChatController } from "./entrypoints/chat/mod.ts";
import { StoreController } from "./entrypoints/store/mod.ts";
import { SoundsController } from "./entrypoints/sounds/mod.ts";

@Module({
  imports: [CoreModule, AuthModule],
  controllers: [
    GamificationController,
    ChatController,
    StoreController,
    SoundsController,
  ],
})
export class GamificationModule {}
