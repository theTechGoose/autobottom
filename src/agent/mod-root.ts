import { Module } from "@danet/core";
import { AgentApiController } from "@agent/entrypoints/agent-controller.ts";

@Module({
  controllers: [AgentApiController],
  injectables: [],
})
export class AgentModule {}
