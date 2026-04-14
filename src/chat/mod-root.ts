import { Module } from "@danet/core";
import { ChatController } from "@chat/entrypoints/chat/mod.ts";

@Module({
  controllers: [ChatController],
  injectables: [],
})
export class ChatModule {}
