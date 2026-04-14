import { Module } from "@danet/core";
import { AgentApiController } from "@audit/entrypoints/agent/mod.ts";
@Module({ controllers: [AgentApiController], injectables: [] })
export class AgentModule {}
