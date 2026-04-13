import { Module } from "@danet/core";
import { ChatController } from "@chat/entrypoints/chat-controller.ts";

@Module({
  controllers: [ChatController],
  injectables: [],
})
export class ChatModule {}
