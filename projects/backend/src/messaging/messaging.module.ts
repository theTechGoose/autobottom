import "reflect-metadata";
import { Module } from "@danet/core";
import { CoreModule } from "../core/core.module.ts";
import { AuthModule } from "../auth/auth.module.ts";
import { MessagingController } from "./entrypoints/messaging/mod.ts";

@Module({
  imports: [CoreModule, AuthModule],
  controllers: [MessagingController],
})
export class MessagingModule {}
